import assert from "node:assert/strict";
import { chromium } from "playwright";

// All fixtures run in fresh, non-persistent browser contexts on localhost.
const base = process.env.AUNOTE_TEST_URL || "http://127.0.0.1:4173/";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.AUNOTE_CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
});
const failures = [];
const passed = [];
async function check(name, test) {
  const context = await browser.newContext({ acceptDownloads: true, serviceWorkers: "block" });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on("dialog", (dialog) => dialog.accept());
    await page.goto(base);
    await page.locator(".home-screen").waitFor();
    await test(page);
    passed.push(name);
  } catch (error) {
    failures.push({ name, error: error.message });
  } finally {
    await context.close();
  }
}
async function snapshot(page) {
  return page.evaluate(async () => (await import("./js/db.js")).exportDatabaseState());
}
async function prepareRestore(page, shareMode) {
  await page.evaluate(async () => {
    const db = await import("./js/db.js");
    const templates = await db.getTemplates();
    await db.putRecord({ id: "synthetic-safety-record", templateKey: templates[0].key,
      answers: {}, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
  });
  const before = await snapshot(page);
  const payload = { format: "research-notebook-backup", backupVersion: 1, data: { ...before, records: [] } };
  await page.evaluate((mode) => {
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => mode !== "download" });
    Object.defineProperty(navigator, "share", { configurable: true, value: async () => {
      if (mode === "cancel") throw new DOMException("Cancelled", "AbortError");
      if (mode === "error") throw new DOMException("Share unavailable", "NotAllowedError");
    } });
  }, shareMode);
  await page.locator('[data-action="backup"]').click();
  await page.locator("#backup-file-input").setInputFiles({
    name: "synthetic-backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(payload))
  });
  await page.locator("#confirm-submit").click();
  return { before, payload };
}

try {
  await check("cancelled safety share preserves every store", async (page) => {
    const { before } = await prepareRestore(page, "cancel");
    await page.waitForFunction(() => document.querySelector("#toast")?.textContent.includes("取消恢复")
      || !!document.querySelector(".home-screen"));
    assert.deepEqual(await snapshot(page), before, "取消分享后不得替换数据库");
    assert.equal(await page.getByRole("heading", { name: "完整备份与恢复" }).count(), 1);
  });

  await check("download awaits acknowledgement; cancelling preserves data", async (page) => {
    const download = page.waitForEvent("download");
    const { before } = await prepareRestore(page, "download");
    assert.equal(await (await download).failure(), null);
    await page.getByRole("heading", { name: "确认安全备份已保存？" }).waitFor();
    assert.deepEqual(await snapshot(page), before, "确认保存之前不得替换数据库");
    await page.locator("#confirm-cancel").click();
    await page.getByText("已取消恢复，现有数据未更改", { exact: true }).waitFor();
    assert.deepEqual(await snapshot(page), before);
  });

  for (const mode of ["success", "download", "error"]) {
    await check(mode + " restores only after safety acknowledgement", async (page) => {
      const download = mode !== "success" ? page.waitForEvent("download") : null;
      const { before, payload } = await prepareRestore(page, mode);
      if (download) assert.equal(await (await download).failure(), null);
      await page.getByRole("heading", { name: "确认安全备份已保存？" }).waitFor();
      assert.deepEqual(await snapshot(page), before);
      await page.getByRole("button", { name: "已保存，继续恢复", exact: true }).click();
      await page.locator(".home-screen").waitFor();
      assert.deepEqual(await snapshot(page), payload.data, "确认后恢复全部备份数据");
    });
  }

  await check("failed record completion rolls back both writes; retry saves once", async (page) => {
    await page.evaluate(async () => {
      const db = await import("./js/db.js");
      const { validateTemplate } = await import("./js/questionnaire-schema.js");
      const template = validateTemplate({ schemaVersion: 1, id: "atomic-save-fixture", version: "1.0",
        title: "合成保存测试", fields: [{ id: "note", type: "shortText", label: "合成答案", required: true }] });
      await db.putTemplate(template);
      await db.setSetting("currentTemplateKey", template.key);
    });
    await page.reload();
    await page.locator('[data-action="start-form"]').click();
    await page.locator("[data-field-input]").fill("仅供回归测试");
    await page.waitForFunction(async () => {
      const db = await import("./js/db.js");
      return (await db.getDraft("atomic-save-fixture@1.0"))?.answers.note === "仅供回归测试";
    });
    const before = await snapshot(page);
    await page.evaluate(() => {
      const original = IDBObjectStore.prototype.delete;
      IDBObjectStore.prototype.delete = function (key) {
        const request = original.call(this, key);
        if (this.name === "drafts" && key === "atomic-save-fixture@1.0") {
          IDBObjectStore.prototype.delete = original;
          window.__forcedSaveAbort = true;
          this.transaction.abort();
        }
        return request;
      };
    });
    await page.locator('[data-action="next-question"]').click();
    await page.waitForFunction(() => document.querySelector("#toast")?.textContent !== "记录已保存" && !document.querySelector("#toast")?.hidden).catch(async (error) => { throw new Error(error.message + " BODY: " + await page.locator("body").innerText()); });
    assert.equal(await page.evaluate(() => window.__forcedSaveAbort), true);
    const failed = await snapshot(page);
    assert.deepEqual(failed.records, before.records, "删除草稿失败时，正式记录也必须回滚");
    assert.deepEqual(failed.templates, before.templates);
    assert.deepEqual(failed.settings, before.settings);
    assert.equal(failed.drafts.length, 1);
    assert.deepEqual(failed.drafts[0].answers, before.drafts[0].answers, "失败后保留完整答案以供重试");
    await page.reload();
    await page.locator('[data-action="continue-draft"]').click();
    assert.equal(await page.locator("[data-field-input]").inputValue(), "仅供回归测试");
    await page.locator('[data-action="next-question"]').click();
    await page.locator(".home-screen").waitFor();
    const after = await snapshot(page);
    assert.equal(after.records.length, 1);
    assert.equal(after.records[0].answers.note, "仅供回归测试");
    assert.equal(after.drafts.length, 0);
    await page.reload();
    assert.equal(await page.locator('[data-action="continue-draft"]').count(), 0);
    assert.equal((await snapshot(page)).records.length, 1);
  });
} finally {
  await browser.close();
}
console.log(JSON.stringify({ passed, failures }, null, 2));
assert.equal(failures.length, 0, "数据安全专项回归失败");
