import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";

await fs.mkdir("test-results", { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.AUNOTE_CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "zh-CN" });
const page = await context.newPage();

try {
  await page.goto(process.env.AUNOTE_TEST_URL || "http://127.0.0.1:4173/", { waitUntil: "networkidle" });
  assert.equal(await page.locator('.home-summary .hero-title').textContent(), '佩戴耳厚数据采集', '主页首要信息应是问卷名称');
  assert.equal(await page.locator('.home-summary .eyebrow').count(), 0, '主页不应再显示重复的当前问卷标签');
  assert.equal(await page.locator('[data-action="export-xlsx"]').textContent(), "导出数据");
  assert.equal(await page.locator('[data-action="export-xlsx"] .home-action-icon path').getAttribute("d"), "M12 3v13m0 0 5-5m-5 5-5-5M4 16v4h16v-4");
  const backupWeight = await page.locator('[data-action="backup"]').evaluate((element) => Number(getComputedStyle(element).fontWeight));
  assert.ok(backupWeight < 600, "底部文字入口不应加粗");
  const homeHeader = await page.locator(".app-header").evaluate((element) => element.getBoundingClientRect().toJSON());
  await page.locator('[data-action="templates"]').first().click();
  const currentTemplateRow = page.locator('.template-screen .swipe-row.is-current');
  await currentTemplateRow.waitFor();
  assert.equal(await currentTemplateRow.count(), 1, "问卷管理应仅有一个当前问卷");
  assert.equal(await currentTemplateRow.locator('.current-chip').count(), 0, "当前问卷不应显示文字标签");
  assert.equal(await currentTemplateRow.locator('.swipe-content').getAttribute('aria-current'), 'true');
  const currentBorderColor = await currentTemplateRow.locator('.swipe-content').evaluate((element) => getComputedStyle(element).borderColor);
  const accentColor = await page.locator('html').evaluate((element) => getComputedStyle(element).getPropertyValue('--accent').trim());
  assert.equal(currentBorderColor, `rgb(${accentColor.slice(1).match(/.{2}/g).map((hex) => parseInt(hex, 16)).join(', ')})`, "当前问卷应使用重点色描边");
  const subpageHeader = await page.locator(".nav-top-bar").evaluate((element) => element.getBoundingClientRect().toJSON());
  assert.ok(Math.abs(homeHeader.width - subpageHeader.width) <= 1, "返回页顶部栏与主页顶部栏宽度不一致");
  assert.ok(Math.abs(homeHeader.height - subpageHeader.height) <= 1, "返回页顶部栏与主页顶部栏高度不一致");
  const backIcon = await page.locator(".back-button img").evaluate((element) => element.getBoundingClientRect().toJSON());
  assert.ok(backIcon.width >= 24 && backIcon.height >= 24, "返回图标没有放大到24px");

  await page.locator('[data-action="home"]').click();
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("research-notebook", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const transaction = db.transaction("records", "readwrite");
      transaction.objectStore("records").put({
        id: "ui-smoke-record",
        recordNumber: "R-UI-SMOKE",
        templateKey: "ear-anthropometry-survey@1.2",
        answers: { name: { value: "界面测试样本", anonymous: false }, gender: { value: "male", otherText: "" }, age: "21" },
        createdAt: "2026-09-14T00:00:00.000Z",
        updatedAt: "2026-09-14T00:00:00.000Z"
      });
      transaction.objectStore("records").put({
        id: "ui-smoke-record-two",
        recordNumber: "R-UI-SMOKE-2",
        templateKey: "ear-anthropometry-survey@1.2",
        answers: { name: { value: "第二份测试样本", anonymous: false }, gender: { value: "female", otherText: "" }, age: "24" },
        createdAt: "2026-09-15T00:00:00.000Z",
        updatedAt: "2026-09-15T00:00:00.000Z"
      });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  });
  await page.reload({ waitUntil: "networkidle" });
  const sampleHeadingStyle = await page.locator('.count-link > span:first-child').evaluate((element) => {
    const style = getComputedStyle(element);
    return { color: style.color, fontWeight: Number(style.fontWeight) };
  });
  assert.equal(sampleHeadingStyle.color, "rgb(25, 33, 42)", "首页已记录样本标题应使用正文黑色");
  assert.equal(sampleHeadingStyle.fontWeight, 400, "首页已记录样本标题应使用普通字重");
  assert.equal(await page.locator('[data-action="analysis"] .home-action-icon path').getAttribute("d"), "M4 19V5M4 19h16M8 15l4-5 3 2 5-6");
  await page.screenshot({ path: "test-results/mobile-home.png", fullPage: true });
  await page.locator('[data-action="records"]').click();
  await page.waitForFunction(() => !document.documentElement.dataset.pageTransition);
  assert.equal(await page.locator('.records-heading').textContent(), '共 2 份记录');
  const listStyle = await page.locator(".record-list").evaluate((element) => {
    const style = getComputedStyle(element);
    return { borderTopWidth: style.borderTopWidth, borderRadius: style.borderRadius, backgroundColor: style.backgroundColor };
  });
  assert.equal(listStyle.borderTopWidth, "1px", "样本分组缺少外边框");
  assert.equal(listStyle.borderRadius, "13px", "样本分组外框应为圆角矩形");
  assert.equal(listStyle.backgroundColor, "rgb(255, 255, 255)", "样本分组应使用白色背景");
  assert.equal(await page.locator('.record-swipe-row').count(), 2, "测试样本未作为分组行显示");
  const hintGap = await page.locator('.records-content .swipe-hint').evaluate((element) => Number.parseFloat(getComputedStyle(element).marginTop));
  assert.ok(hintGap >= 18, "左滑提示与样本分组距离太近");
  const row = page.locator('[data-record-row="ui-smoke-record"]');
  const content = row.locator(".swipe-content");
  const compactStyle = await content.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      borderRadius: style.borderRadius,
      borderTopWidth: style.borderTopWidth,
      borderRightWidth: style.borderRightWidth,
      borderBottomWidth: style.borderBottomWidth,
      borderLeftWidth: style.borderLeftWidth
    };
  });
  assert.equal(compactStyle.borderRadius, "0px", "样本被错误渲染成独立大卡片");
  assert.equal(compactStyle.borderTopWidth, "0px", "样本顶部出现了额外外框");
  assert.equal(compactStyle.borderLeftWidth, "0px", "样本行不应增加外框");
  await page.screenshot({ path: "test-results/mobile-record-list.png", fullPage: true });

  await content.dispatchEvent("pointerdown", { pointerId: 11, pointerType: "touch", clientX: 300, clientY: 100 });
  await content.dispatchEvent("pointermove", { pointerId: 11, pointerType: "touch", clientX: 220, clientY: 101 });
  await content.dispatchEvent("pointerup", { pointerId: 11, pointerType: "touch", clientX: 220, clientY: 101 });
  await page.waitForTimeout(220);
  const geometry = await row.evaluate((element) => {
    const card = element.querySelector(".swipe-content").getBoundingClientRect();
    const remove = element.querySelector(".swipe-delete").getBoundingClientRect();
    return { cardRight: card.right, deleteLeft: remove.left };
  });
  assert.ok(geometry.deleteLeft >= geometry.cardRight, "垃圾桶没有显示在样本内容行外侧");
  assert.equal(await row.locator('[data-action="duplicate-template"]').count(), 0, "样本错误显示复制按钮");
  await page.screenshot({ path: "test-results/mobile-record-swipe.png", fullPage: true });

  console.log(JSON.stringify({ passed: true, scenarios: ["header-size", "back-icon", "home-actions", "grouped-record-list", "record-swipe-delete"] }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
