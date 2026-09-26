import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import JSZip from "jszip";

const browser = await chromium.launch({ headless: true, executablePath: process.env.AUNOTE_CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

async function strokes(questionId) {
  return page.evaluate(async (id) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("research-notebook", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const draft = await new Promise((resolve) => {
      const request = db.transaction("drafts").objectStore("drafts").get("ear-hook-annotation-acceptance@1.0");
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
    return draft?.answers?.[id]?.strokes || [];
  }, questionId);
}

async function touchStroke() {
  const box = await page.locator(".annotation-canvas").boundingBox();
  const x = Math.round(box.x + box.width * 0.5);
  const y = Math.round(box.y + box.height * 0.5);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
  for (let n = 1; n <= 5; n += 1) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + n * 6, y: y + n * 5, id: 1 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

try {
  await page.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle" });
  await page.locator('[data-action="templates"]').click();
  await page.locator('[data-action="open-template"][data-key="ear-hook-annotation-acceptance@1.0"]').click();
  await page.locator('[data-action="select-template"]').click();
  await page.locator('[data-action="start-form"]').click();
  assert.equal(await page.locator(".form-counter").textContent(), "1/7");
  await page.locator('[data-field-input]').fill("张三");
  await page.locator('[data-action="next-question"]').click();
  await page.locator(".form-counter", { hasText: "2/7" }).waitFor();
  await page.locator(".annotation-canvas").waitFor();
  const sideViewBox = (await page.locator(".annotation-canvas").getAttribute("viewBox")).split(" ").map(Number);
  assert(Math.abs(sideViewBox[2] / 1149 - 0.73) < 0.001 && Math.abs(sideViewBox[3] / 1368 - 0.78) < 0.001, "侧面耳图没有完整放大到画布内");
  const fullWidthCanvas = await page.locator(".annotation-canvas").boundingBox();
  assert(fullWidthCanvas.x <= 1 && fullWidthCanvas.x + fullWidthCanvas.width >= 389, "标注图片左右仍有页面留白");
  assert.equal(await page.locator("[data-annotation-brush]").evaluate((el) => getComputedStyle(el).borderRadius), "999px", "画笔滑块未使用胶囊跑道");
  await fs.mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/image-range-mobile.png" });
  await page.setViewportSize({ width: 320, height: 568 });
  const compactLayout = await page.evaluate(() => ({
    bottom: document.querySelector(".form-navigation").getBoundingClientRect().bottom,
    canvasHeight: document.querySelector(".annotation-canvas").getBoundingClientRect().height,
    viewport: window.innerHeight
  }));
  assert(compactLayout.bottom <= compactLayout.viewport + 1 && compactLayout.canvasHeight > 100, "小屏标注页不能一屏操作");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator(".form-counter").textContent(), "2/7");
  assert.equal(await page.locator(".question-number").textContent(), "Q2.");
  assert.equal(await page.locator(".annotation-canvas").evaluate((el) => getComputedStyle(el).touchAction), "none");
  assert.equal(await page.locator("[data-annotation-brush]").inputValue(), "0.027");
  await page.locator("[data-annotation-brush]").fill("0.04");
  const beforeScroll = await page.evaluate(() => window.scrollY);
  await touchStroke();
  assert.equal(await page.evaluate(() => window.scrollY), beforeScroll, "触控绘制导致页面滚动");
  assert.equal((await strokes("contactSide")).length, 1, "触控笔画没有写入草稿");
  assert.equal((await strokes("contactSide"))[0].brushSize, 0.04, "画笔滑块没有随笔画保存");
  assert((await strokes("contactSide"))[0].points.length > 1, "触控笔画没有连续点");
  assert((await strokes("contactSide"))[0].points.length <= 3, "直线笔画没有按固定容差简化");
  await page.locator("[data-annotation-undo]").click();
  await page.locator('[data-action="next-question"]').click();
  await page.locator(".form-counter", { hasText: "3/7" }).waitFor();
  const sectionViewBox = (await page.locator(".annotation-canvas").getAttribute("viewBox")).split(" ").map(Number);
  assert(Math.abs(sectionViewBox[2] / 4788 - 0.73) < 0.001 && Math.abs(sectionViewBox[3] / 5700 - 0.78) < 0.001, "截面耳图没有完整放大到画布内");
  await page.screenshot({ path: "test-results/image-range-section-mobile.png" });
  assert.equal((await strokes("contactSide")).length, 0, "撤销没有保存");
  await touchStroke();
  await page.locator('[data-action="next-question"]').click();
  await page.locator(".form-counter", { hasText: "4/7" }).waitFor();
  await page.locator('[data-action="next-question"]').click();
  await page.locator(".form-counter", { hasText: "5/7" }).waitFor();
  assert.equal(await page.locator(".question-number").textContent(), "Q3.");
  await page.screenshot({ path: "test-results/image-range-pain-mobile.png" });
  await page.setViewportSize({ width: 320, height: 568 });
  const compactPainLayout = await page.evaluate(() => ({
    bottom: document.querySelector(".form-navigation").getBoundingClientRect().bottom,
    canvasHeight: document.querySelector(".annotation-canvas").getBoundingClientRect().height,
    viewport: window.innerHeight
  }));
  assert(compactPainLayout.bottom <= compactPainLayout.viewport + 1 && compactPainLayout.canvasHeight > 100, "小屏双等级标注页不能一屏操作");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-annotation-level="2"]').click();
  await touchStroke();
  assert.equal((await strokes("painSide"))[0].level, 2, "Level 2没有独立保存");
  await page.locator('[data-annotation-level="1"]').click();
  await touchStroke();
  assert.deepEqual((await strokes("painSide")).map((item) => item.level), [2, 1]);
  await page.locator('[data-action="next-question"]').click();
  await page.locator(".form-counter", { hasText: "6/7" }).waitFor();
  await page.locator('[data-action="previous-question"]').click();
  await page.locator(".form-counter", { hasText: "5/7" }).waitFor();
  const restoredPaths = await page.locator(".annotation-canvas").evaluate((el) => (el.innerHTML.match(/<path /g) || []).length);
  assert.equal(restoredPaths, 3, `返回页面没有恢复两级绘制 ${JSON.stringify(await strokes("painSide"))}`);
  await page.locator('[data-action="next-question"]').click();
  await page.locator(".form-counter", { hasText: "6/7" }).waitFor();
  await page.locator('[data-action="next-question"]').click();
  await page.locator(".form-counter", { hasText: "7/7" }).waitFor();
  await page.locator('[data-action="next-question"]').click();
  await page.locator('[data-action="records"]').click();
  await page.locator('[data-action="open-record"]').first().click();
  await page.getByRole("heading", { name: "记录详情" }).waitFor();
  await page.locator('[data-action="edit-record-at"][data-field-index="4"]').click();
  assert.equal(await page.locator(".annotation-canvas").evaluate((el) => (el.innerHTML.match(/<path /g) || []).length), 3, "已有样本重新打开未恢复笔画");
  await page.locator('[data-action="leave-form"]').click();
  await page.locator('[data-action="records"]').click();
  await page.locator('[data-action="home"]').click();
  await page.locator('[data-action="analysis"]').click();
  await page.locator("[data-heatmap-overlay]").waitFor();
  await page.locator("[data-heatmap-field]").selectOption("contactSection");
  assert.match(await page.locator("[data-heatmap-count]").textContent(), /1 份已标注样本/);
  await page.locator("[data-heatmap-field]").selectOption("painSide");
  await page.locator('[data-heatmap-level="2"]').click();
  assert.match(await page.locator("[data-heatmap-count]").textContent(), /1 份标注了较为疼痛/);
  assert.equal(await page.locator("[data-heatmap-overlay]").evaluate((el) => el.width > 0 && el.height > 0), true);
  const participantOverlap = await page.evaluate(async () => {
    const { countImageRangeParticipants, paintHeatmap } = await import("./js/image-range-heatmap.js");
    const field = { id: "area", image: { width: 100, height: 100 }, levels: [{ id: 1 }] };
    const stroke = { level: 1, brushSize: 0.1, points: [[0.5, 0.5]] };
    const records = [
      { answers: { area: { strokes: [stroke, stroke] } } },
      { answers: { area: { strokes: [stroke] } } }
    ];
    const result = countImageRangeParticipants(field, records, 1, 100);
    const before = result.counts.slice();
    paintHeatmap(document.createElement("canvas"), result, 2);
    return { max: result.maxCount, samples: result.participantCount, unchanged: before.every((value, index) => value === result.counts[index]) };
  });
  assert.deepEqual(participantOverlap, { max: 2, samples: 2, unchanged: true }, "热力图不能把同一人重复涂画计为多人，也不能修改原始人数");
  await page.screenshot({ path: "test-results/image-range-heatmap-mobile.png" });
  await page.locator('[data-action="home"]').click();
  const downloadPromise = page.waitForEvent("download");
  await page.locator('[data-action="export-xlsx"]').click();
  const download = await downloadPromise;
  assert(download.suggestedFilename().endsWith(".xlsx"));
  const filePath = "test-results/image-range.xlsx";
  await fs.mkdir("test-results", { recursive: true });
  await download.saveAs(filePath);
  const workbook = await JSZip.loadAsync(await fs.readFile(filePath));
  const annotationXml = await workbook.file("xl/worksheets/sheet2.xml").async("string");
  assert(annotationXml.includes("painSide") && annotationXml.includes("contactSection"), "标注数据未完整导出");
  assert(annotationXml.includes("normalizedX") && annotationXml.includes("brushSize"), "标注数据列不完整");
  const desktop = await browser.newContext({ viewport: { width: 1000, height: 760 } });
  const desktopPage = await desktop.newPage();
  await desktopPage.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle" });
  await desktopPage.locator('[data-action="templates"]').click();
  await desktopPage.locator('[data-action="open-template"][data-key="ear-hook-annotation-acceptance@1.0"]').click();
  await desktopPage.locator('[data-action="select-template"]').click();
  await desktopPage.locator('[data-action="start-form"]').click();
  await desktopPage.locator('[data-field-input]').fill("桌面测试");
  await desktopPage.locator('[data-action="next-question"]').click();
  const box = await desktopPage.locator(".annotation-canvas").boundingBox();
  const startX = box.x + box.width * 0.5;
  const startY = box.y + box.height * 0.5;
  for (let n = 0; n < 2; n += 1) {
    await desktopPage.mouse.move(startX, startY);
    await desktopPage.mouse.down();
    await desktopPage.mouse.move(startX + 50, startY + 20, { steps: 8 });
    await desktopPage.mouse.up();
  }
  assert.equal(await desktopPage.locator(".annotation-canvas").evaluate((el) => (el.innerHTML.match(/<path /g) || []).length), 2, "鼠标不能连续绘制多笔");
  assert.equal(await desktopPage.locator(".annotation-canvas rect[mask]").count(), 1, "同级重复绘制产生了叠加强度层");
  await desktopPage.locator("[data-annotation-clear]").click();
  await desktopPage.locator("#confirm-submit").click();
  assert.equal(await desktopPage.locator(".annotation-canvas").evaluate((el) => (el.innerHTML.match(/<path /g) || []).length), 0, "清除本页失败");
  for (let i = 0; i < 3; i += 1) await desktopPage.locator('[data-action="next-question"]').click();
  await desktopPage.locator(".form-counter", { hasText: "5/7" }).waitFor();
  const painBox = await desktopPage.locator(".annotation-canvas").boundingBox();
  const painX = painBox.x + painBox.width * 0.5;
  const painY = painBox.y + painBox.height * 0.5;
  await desktopPage.locator('[data-annotation-level="2"]').click();
  await desktopPage.mouse.move(painX, painY);
  await desktopPage.mouse.down();
  await desktopPage.mouse.up();
  await desktopPage.locator('[data-annotation-level="1"]').click();
  await desktopPage.mouse.move(painX + 20, painY + 20);
  await desktopPage.mouse.down();
  await desktopPage.mouse.up();
  await desktopPage.locator("[data-annotation-clear]").click();
  await desktopPage.locator("#confirm-submit").click();
  assert.equal(await desktopPage.locator(".annotation-canvas path").count(), 0, "清除所有标记必须同时清除两个疼痛等级");
  await desktop.close();
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(JSON.stringify({ passed: true, scenarios: ["touch-stroke", "mouse-stroke", "no-scroll", "brush-slider", "fixed-simplification", "undo", "clear-all-levels", "independent-views", "two-levels", "page-restoration", "participant-count-heatmap", "xlsx"] }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
