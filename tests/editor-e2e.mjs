import { chromium } from "playwright";
import fs from "node:fs/promises";

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function databaseSnapshot(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("research-notebook", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const read = (store) => new Promise((resolve, reject) => {
      const request = db.transaction(store).objectStore(store).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const result = {
      templates: await read("templates"),
      records: await read("records"),
      drafts: await read("drafts"),
      settings: await read("settings")
    };
    db.close();
    return result;
  });
}

async function openHiddenAction(page, action, key) {
  await page.locator(`[data-action="${action}"][data-key="${key}"]`).evaluate((element) => element.click());
}

async function confirm(page, label) {
  const dialog = page.getByRole("alertdialog");
  await dialog.waitFor();
  await dialog.getByRole("button", { name: label, exact: true }).click();
}

const noRecordContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "zh-CN" });
const noRecordPage = await noRecordContext.newPage();
await noRecordPage.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle" });
assert(await noRecordPage.locator("#update-skip").count() === 1 && await noRecordPage.locator("#update-later").count() === 1, "更新提示缺少跳过或此次不更新操作");
await noRecordPage.evaluate(() => {
  document.querySelector("#update-title").textContent = "发现新版本 V1.2.1";
  document.querySelector("#update-summary").textContent = "本次更新：改进问卷编辑体验，并修复已知问题。";
  document.querySelector("#update-dialog").hidden = false;
  document.body.classList.add("dialog-open");
});
await noRecordPage.screenshot({ path: "test-results/mobile-update-dialog.png" });
await noRecordPage.evaluate(() => {
  document.querySelector("#update-dialog").hidden = true;
  document.body.classList.remove("dialog-open");
});
await noRecordPage.getByRole("button", { name: "佩戴耳厚数据采集", exact: false }).first().click();
await noRecordPage.getByRole("heading", { name: "问卷管理", exact: true }).waitFor();
assert(await noRecordPage.locator('[data-template-row="ear-anthropometry-survey@1.1"] .swipe-action').count() === 2, "问卷左滑区域应只有复制和删除两个操作");
assert(await noRecordPage.locator("[data-template-row]").count() === 1, "新安装不应再内置V1.0问卷");
await openHiddenAction(noRecordPage, "duplicate-template", "ear-anthropometry-survey@1.1");
const initialCopyData = await databaseSnapshot(noRecordPage);
const emptySource = initialCopyData.templates.find((item) => item.title === "佩戴耳厚数据采集（副本）");
assert(emptySource, "没有生成用于无记录编辑测试的问卷副本");

await noRecordPage.locator(`[data-action="open-template"][data-key="${emptySource.key}"]`).click();
await noRecordPage.getByRole("heading", { name: "问卷概览", exact: true }).waitFor();
await noRecordPage.getByRole("button", { name: "选择此问卷", exact: true }).click();
await noRecordPage.getByText("当前问卷 / CURRENT", { exact: true }).waitFor();
assert(await noRecordPage.locator(".form-screen").count() === 0, "选择问卷后错误地进入了填写页面");
await noRecordPage.locator('[data-action="templates"]').first().click();
await noRecordPage.locator(`[data-action="open-template"][data-key="${emptySource.key}"]`).click();
await noRecordPage.screenshot({ path: "test-results/mobile-questionnaire-editor.png", fullPage: true });
await noRecordPage.locator('[data-action="open-editor-meta"]').click();
await noRecordPage.locator("[data-editor-template-title]").fill("无记录问卷修改测试");
await noRecordPage.locator("[data-editor-template-description]").fill("这是新的背景信息，会显示在首页。");
await noRecordPage.getByRole("button", { name: "完成", exact: true }).click();
await noRecordPage.locator('[data-action="open-question-type-picker"]').click();
await noRecordPage.getByRole("dialog", { name: "选择问题类型" }).waitFor();
await noRecordPage.screenshot({ path: "test-results/mobile-question-type-picker.png", fullPage: true });
await noRecordPage.getByRole("button", { name: /数字/ }).first().click();
await noRecordPage.locator("[data-field-label]").fill("新增数字题");
await noRecordPage.locator("[data-field-unit]").fill("mm");
await noRecordPage.screenshot({ path: "test-results/mobile-question-editor.png", fullPage: true });
await noRecordPage.getByRole("button", { name: "完成", exact: true }).click();
await noRecordPage.locator('[data-editor-field-id="name"]').click();
await noRecordPage.locator('[data-action="open-question-type-picker"][data-mode="change"]').click();
await noRecordPage.getByRole("dialog", { name: "选择问题类型" }).waitFor();
await noRecordPage.getByRole("button", { name: /长文字/ }).click();
await confirm(noRecordPage, "更换题型");
await noRecordPage.locator(".editor-type-label strong", { hasText: "长文字" }).waitFor();
await noRecordPage.getByRole("button", { name: "完成", exact: true }).click();

await noRecordPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await noRecordPage.locator('[data-editor-field-id="gender"]').click();
await noRecordPage.waitForFunction(() => window.scrollY === 0);
assert(await noRecordPage.getByRole("dialog", { name: "选择问题类型" }).count() === 0, "重新进入问题时仍残留上次的题型弹窗");
await noRecordPage.locator("[data-field-label]").fill("临时性别题");
await noRecordPage.getByRole("button", { name: "返回", exact: true }).click();
const questionLeaveDialog = noRecordPage.getByRole("alertdialog");
await questionLeaveDialog.getByRole("button", { name: "继续编辑", exact: true }).click();
assert(await noRecordPage.locator("[data-field-label]").inputValue() === "临时性别题", "继续编辑没有保留当前输入");
await noRecordPage.getByRole("button", { name: "返回", exact: true }).click();
await confirm(noRecordPage, "放弃更改");
await noRecordPage.getByRole("heading", { name: "问卷概览", exact: true }).waitFor();
assert(await noRecordPage.getByText("临时性别题", { exact: true }).count() === 0, "放弃问题编辑后修改仍然生效");

const beforeOrder = await noRecordPage.locator("[data-editor-field-id]").evaluateAll((items) => items.map((item) => item.dataset.editorFieldId));
const firstCard = noRecordPage.locator("[data-editor-field-id]").first();
const thirdCard = noRecordPage.locator("[data-editor-field-id]").nth(2);
const firstBox = await firstCard.evaluate((element) => element.getBoundingClientRect().toJSON());
const thirdBox = await thirdCard.evaluate((element) => element.getBoundingClientRect().toJSON());
await firstCard.dispatchEvent("pointerdown", { pointerId: 31, pointerType: "touch", clientX: firstBox.x + 70, clientY: firstBox.y + 30 });
await noRecordPage.waitForTimeout(470);
await firstCard.dispatchEvent("pointermove", { pointerId: 31, pointerType: "touch", clientX: thirdBox.x + 70, clientY: thirdBox.bottom - 4 });
await firstCard.dispatchEvent("pointerup", { pointerId: 31, pointerType: "touch", clientX: thirdBox.x + 70, clientY: thirdBox.bottom - 4 });
const afterOrder = await noRecordPage.locator("[data-editor-field-id]").evaluateAll((items) => items.map((item) => item.dataset.editorFieldId));
assert(JSON.stringify(beforeOrder) !== JSON.stringify(afterOrder), "长按拖动没有改变问题顺序");

await noRecordPage.getByRole("button", { name: "返回", exact: true }).click();
const overviewLeaveDialog = noRecordPage.getByRole("alertdialog");
assert(await overviewLeaveDialog.getByRole("button", { name: "放弃更改", exact: true }).isVisible(), "问卷概览返回提示缺少放弃更改");
await overviewLeaveDialog.getByRole("button", { name: "继续编辑", exact: true }).click();
await noRecordPage.getByRole("button", { name: "保存问卷", exact: true }).waitFor();

await noRecordPage.getByRole("button", { name: "保存问卷", exact: true }).click();
await noRecordPage.locator("#toast", { hasText: "问卷已保存为" }).waitFor();
await noRecordPage.getByRole("heading", { name: "问卷概览", exact: true }).waitFor();
const noRecordData = await databaseSnapshot(noRecordPage);
assert(!noRecordData.templates.some((item) => item.key === emptySource.key), "无记录问卷编辑后仍保留旧的空模板");
const replaced = noRecordData.templates.find((item) => item.title === "无记录问卷修改测试");
assert(replaced?.id === emptySource.id && replaced.version === "1.1", "无记录问卷没有在同一身份下更新版本");
assert(replaced.fields.some((field) => field.label === "新增数字题" && field.type === "number"), "新增数字题没有按数字题型保存");
assert(replaced.fields.some((field) => field.id === "name" && field.type === "longText"), "已有问题的题型修改没有保存");
assert(noRecordData.settings.find((item) => item.key === "currentTemplateKey")?.value === replaced.key, "修改后的版本没有成为当前问卷");
await noRecordContext.close();

const recordedContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "zh-CN" });
const recordedPage = await recordedContext.newPage();
await recordedPage.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle" });
await recordedPage.evaluate(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("research-notebook", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise((resolve, reject) => {
    const transaction = db.transaction("records", "readwrite");
    transaction.objectStore("records").put({
      id: "existing-record",
      recordNumber: "R-EXISTING",
      templateKey: "ear-anthropometry-survey@1.1",
      answers: { preferenceReason: "旧版本答案" },
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z"
    });
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
});
await recordedPage.reload({ waitUntil: "networkidle" });
await recordedPage.locator('[data-action="templates"]').first().click();
await recordedPage.locator('[data-action="open-template"][data-key="ear-anthropometry-survey@1.1"]').click();
await recordedPage.getByRole("heading", { name: "问卷概览", exact: true }).waitFor();
const reasonCard = recordedPage.locator('[data-editor-field-id="preferenceReason"]');
await reasonCard.click();
await recordedPage.getByRole("button", { name: "删除该问题", exact: true }).click();
await confirm(recordedPage, "删除问题");
await recordedPage.getByRole("button", { name: "保存问卷", exact: true }).click();
await recordedPage.locator("#toast", { hasText: "问卷已保存为" }).waitFor();
await recordedPage.getByRole("heading", { name: "问卷概览", exact: true }).waitFor();
const recordedData = await databaseSnapshot(recordedPage);
const oldVersion = recordedData.templates.find((item) => item.key === "ear-anthropometry-survey@1.1");
const newVersion = recordedData.templates.find((item) => item.key === "ear-anthropometry-survey@1.2");
assert(oldVersion?.fields.some((field) => field.id === "preferenceReason"), "有记录问卷的旧版本问题被修改");
assert(!newVersion?.fields.some((field) => field.id === "preferenceReason"), "新版本没有删除指定问题");
assert(recordedData.records.some((item) => item.id === "existing-record" && item.templateKey === oldVersion.key && item.answers.preferenceReason === "旧版本答案"), "旧记录或旧答案被迁移或修改");
assert(!recordedData.records.some((item) => item.templateKey === newVersion.key), "旧记录被错误迁移到了新版本");

await recordedPage.locator('[data-action="leave-template-overview"]').click();
await openHiddenAction(recordedPage, "duplicate-template", "ear-anthropometry-survey@1.2");
await recordedPage.getByRole("heading", { name: "问卷管理", exact: true }).waitFor();
const copyRow = recordedPage.locator('[data-action="open-template"]').filter({ hasText: "副本" }).first();
assert(await copyRow.count() === 1, "复制后没有在问卷管理页面生成副本");
await copyRow.click();
await recordedPage.getByRole("heading", { name: "问卷概览", exact: true }).waitFor();
assert(await recordedPage.getByText(/副本/, { exact: false }).count() > 0, "复制后的问卷不能从管理页进入概览");
const copiedData = await databaseSnapshot(recordedPage);
const copied = copiedData.templates.find((item) => item.title === "佩戴耳厚数据采集（副本）");
assert(copied && copied.id !== oldVersion.id && copied.version === "1.0", "复制问卷没有生成独立身份和V1.0版本");
assert(!copiedData.records.some((item) => item.templateKey === copied.key), "复制问卷错误地复制了记录");
assert(copied.analysis?.fields?.length === 2, "复制问卷没有保留简易分析设置");

await recordedPage.locator('[data-action="leave-template-overview"]').click();
await recordedPage.locator('[data-action="open-template"][data-key="ear-anthropometry-survey@1.1"]').click();
await recordedPage.getByRole("button", { name: "选择此问卷", exact: true }).click();
await recordedPage.getByText("1 份", { exact: true }).waitFor();
const oldCsvDownloadPromise = recordedPage.waitForEvent("download");
await recordedPage.locator('[data-action="export-csv"]').click();
const oldCsvDownload = await oldCsvDownloadPromise;
await oldCsvDownload.saveAs("test-results/editor-old-version.csv");
const oldCsv = await fs.readFile("test-results/editor-old-version.csv", "utf8");
assert(oldCsv.includes("偏好原因") && oldCsv.includes("旧版本答案"), "旧版本CSV没有保留旧问题和旧答案");
assert(!oldCsv.includes("偏好原因（已删除）"), "旧版本CSV错误地把采集时有效的问题标成已删除");

await recordedContext.close();

console.log(JSON.stringify({ passed: true, scenarios: ["empty-template-replace", "recorded-template-versioning", "copy-without-records", "long-press-reorder"] }, null, 2));
await browser.close();
