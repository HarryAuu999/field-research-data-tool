import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";

await fs.mkdir("test-results", { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "zh-CN" });
const page = await context.newPage();

try {
  await page.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle" });
  assert.equal(await page.locator('[data-action="export-xlsx"]').textContent(), "导出数据");
  const homeHeader = await page.locator(".app-header").evaluate((element) => element.getBoundingClientRect().toJSON());
  await page.locator('[data-action="templates"]').first().click();
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
        templateKey: "ear-anthropometry-survey@1.1",
        answers: { name: { value: "界面测试样本", anonymous: false }, gender: { value: "male", otherText: "" }, age: "21" },
        createdAt: "2026-09-14T00:00:00.000Z",
        updatedAt: "2026-09-14T00:00:00.000Z"
      });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.locator('[data-action="records"]').click();
  const listStyle = await page.locator(".record-list").evaluate((element) => {
    const style = getComputedStyle(element);
    return { borderTopWidth: style.borderTopWidth, borderRadius: style.borderRadius, backgroundColor: style.backgroundColor };
  });
  assert.equal(listStyle.borderTopWidth, "0px", "样本列表不应增加大外框");
  assert.equal(listStyle.borderRadius, "0px", "样本列表不应成为圆角卡片");
  assert.equal(listStyle.backgroundColor, "rgba(0, 0, 0, 0)", "样本列表不应增加整块卡片背景");
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

  console.log(JSON.stringify({ passed: true, scenarios: ["header-size", "back-icon", "compact-record-list", "record-swipe-delete"] }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
