import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "zh-CN" });
const page = await context.newPage();

try {
  await page.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    const template = {
      schemaVersion: 1,
      id: "layout-feature-test",
      version: "1.0",
      key: "layout-feature-test@1.0",
      title: "同页填写测试",
      recordLabelField: "participantName",
      fields: [
        { id: "participantName", type: "shortText", label: "姓名", required: true, page: "profile" },
        { id: "age", type: "number", label: "年龄", integer: true, page: "profile" },
        { id: "comments", type: "longText", label: "备注" }
      ]
    };
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("research-notebook", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(["templates", "records", "drafts", "settings"], "readwrite");
      for (const name of ["templates", "records", "drafts", "settings"]) transaction.objectStore(name).clear();
      transaction.objectStore("templates").put(template);
      transaction.objectStore("settings").put({ key: "currentTemplateKey", value: template.key });
      transaction.objectStore("settings").put({ key: "defaultTemplateSeeded", value: true });
      transaction.objectStore("settings").put({ key: "builtInTemplateSeedRevision", value: 4 });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  });

  await page.reload({ waitUntil: "networkidle" });
  await page.locator('[data-action="start-form"]').click();
  assert.equal(await page.locator(".form-counter").textContent(), "1/2", "同页题目没有按页面计数");
  assert.equal(await page.locator(".form-page-question").count(), 2, "同一个page的两道题没有同时显示");
  await page.locator('[data-question-index="0"] [data-field-input]').fill("张三");
  await page.locator('[data-question-index="1"] [data-field-input]').fill("28");
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await page.locator(".form-counter", { hasText: "2/2" }).waitFor();
  assert.equal(await page.locator(".form-counter").textContent(), "2/2");
  await page.getByRole("button", { name: "保存记录", exact: true }).click();
  await page.locator('[data-action="records"]').click();
  await page.getByText("张三", { exact: true }).waitFor();
  assert.equal(await page.getByText("张三", { exact: true }).count(), 1, `recordLabelField没有用于样本列表名称：\n${await page.locator("body").innerText()}`);

  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("research-notebook", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const transaction = db.transaction("templates", "readwrite");
      const request = transaction.objectStore("templates").get("layout-feature-test@1.0");
      request.onsuccess = () => {
        const template = request.result;
        delete template.recordLabelField;
        transaction.objectStore("templates").put(template);
      };
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.locator('[data-action="records"]').click();
  await page.getByText("张三", { exact: true }).waitFor();

  console.log(JSON.stringify({ passed: true, scenarios: ["multi-question-page", "page-navigation", "record-label-field", "participant-name-fallback"] }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
