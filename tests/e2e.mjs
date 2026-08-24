import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const outputDir = path.resolve("test-results");
await fs.mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  acceptDownloads: true,
  locale: "zh-CN",
  timezoneId: "Asia/Shanghai"
});
const page = await context.newPage();
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("requestfailed", (request) => errors.push(`requestfailed: ${request.url()} ${request.failure()?.errorText || ""}`));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function clickAction(action) {
  await page.locator(`[data-action="${action}"]`).click();
}

async function waitQuestion(title) {
  await page.locator(".question-title", { hasText: title }).waitFor();
}

async function nextTo(title) {
  await clickAction("next-question");
  await waitQuestion(title);
}

async function choose(selector) {
  const option = page.locator(selector);
  await option.click();
  await page.locator(`${selector}.selected`).waitFor();
}

async function confirmCustomDialog(expectedLabel) {
  const dialog = page.getByRole("alertdialog");
  await dialog.waitFor();
  await dialog.getByRole("button", { name: expectedLabel, exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
}

async function assertNoHorizontalOverflow(label) {
  const result = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth
  }));
  assert(result.documentWidth <= result.viewport && result.bodyWidth <= result.viewport, `${label}出现横向溢出：${JSON.stringify(result)}`);
}

const migrationContext = await browser.newContext({ locale: "zh-CN" });
const migrationPage = await migrationContext.newPage();
await migrationPage.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle" });
await migrationPage.evaluate(async () => {
  const { BUILT_IN_TEMPLATES } = await import("./js/default-template.js");
  const legacy = structuredClone(BUILT_IN_TEMPLATES[0]);
  const latest = structuredClone(BUILT_IN_TEMPLATES[1]);
  legacy.title = "耳部人体数据采集";
  latest.title = "耳部人体数据采集";
  legacy.key = `${legacy.id}@${legacy.version}`;
  latest.key = `${latest.id}@${latest.version}`;
  legacy.importedAt = new Date().toISOString();
  latest.importedAt = new Date().toISOString();
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("research-notebook", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(["templates", "records", "drafts", "settings"], "readwrite");
    for (const name of ["templates", "records", "drafts", "settings"]) transaction.objectStore(name).clear();
    transaction.objectStore("templates").put(legacy);
    transaction.objectStore("templates").put(latest);
    transaction.objectStore("records").put({
      id: "legacy-record",
      recordNumber: "R-LEGACY",
      templateKey: latest.key,
      answers: { name: { value: "旧版记录", anonymous: false } },
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z"
    });
    transaction.objectStore("settings").put({ key: "defaultTemplateSeeded", value: true });
    transaction.objectStore("settings").put({ key: "builtInTemplateSeedRevision", value: 2 });
    transaction.objectStore("settings").put({ key: "currentTemplateKey", value: latest.key });
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  db.close();
});
await migrationPage.reload({ waitUntil: "networkidle" });
await migrationPage.getByText("佩戴耳厚数据采集", { exact: true }).waitFor();
await migrationPage.getByText("问卷版本 V1.1", { exact: true }).waitFor();
await migrationPage.locator('[data-action="templates"]').click();
assert(await migrationPage.locator('[data-template-row="ear-anthropometry-survey@1.0"]').getByText("佩戴耳厚数据采集", { exact: false }).isVisible(), "升级后V1.0名称没有更新");
assert(await migrationPage.locator('[data-template-row="ear-anthropometry-survey@1.1"]').getByText("1份记录", { exact: false }).isVisible(), "升级后V1.1记录没有保留");
await migrationContext.close();

await page.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle" });
await page.getByText("佩戴耳厚数据采集", { exact: true }).waitFor();
await page.getByText("问卷版本 V1.1", { exact: true }).waitFor();
assert(await page.getByText("0 份", { exact: true }).isVisible(), "首页初始记录数不是0");
assert(await page.getByRole("button", { name: "数据备份/恢复", exact: true }).isVisible(), "主页缺少数据备份/恢复入口");
assert(await page.getByRole("button", { name: "检查更新", exact: true }).isVisible(), "主页缺少检查更新入口");
await page.evaluate(() => navigator.serviceWorker?.ready);
await clickAction("check-update");
await page.getByText("当前已是最新版本 V1.0.0-beta.7", { exact: true }).waitFor();

await clickAction("start-form");
await page.locator("[data-field-input]").fill("测试参与者A");
await nextTo("性别");

await choose('[data-action="select-single"][data-option="male"]');
await nextTo("年龄");

await page.locator("[data-field-input]").fill("29");
await nextTo("左耳水平佩戴位置厚度");
await page.locator('[data-repeat-input="0"]').fill("5.2345");
assert(await page.getByText("平均值：5.2345 mm", { exact: true }).isVisible(), "单次测量没有显示正确平均值");
assert(!(await page.getByText(/最大差值/).count()), "单次测量不应显示最大差值");
await nextTo("左耳倾斜佩戴位置厚度");
await page.locator('[data-repeat-input="0"]').fill("6.12345");
await page.locator('[data-repeat-input="1"]').fill("6.12345");
assert(await page.getByText("最大差值：0 mm", { exact: true }).isVisible(), "相同的两次测量没有显示0最大差值");
await page.locator('[data-repeat-input="1"]').fill("6.22345");
assert(await page.getByText("平均值：6.17345 mm", { exact: true }).isVisible(), "两次测量平均值计算不正确");
assert(await page.getByText("最大差值：0.1 mm", { exact: true }).isVisible(), "两次测量最大差值计算不正确");
await page.setViewportSize({ width: 320, height: 667 });
await assertNoHorizontalOverflow("320px重复测量页");
await page.setViewportSize({ width: 430, height: 932 });
await assertNoHorizontalOverflow("430px重复测量页");
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: path.join(outputDir, "mobile-repeated-measurement.png"), fullPage: true });
await nextTo("耳夹佩戴习惯");

await choose('[data-action="select-single"][data-option="tilt45"]');
await nextTo("耳型大小评价");
await choose('[data-action="select-single"][data-option="medium"]');
await nextTo("开放式耳机偏好");
await choose('[data-action="select-single"][data-option="clip"]');
await nextTo("偏好原因");

await page.locator("[data-field-input]").fill("不影响眼镜腿，取下更方便");
await nextTo("耳朵对耳机佩戴不适的敏感程度");
await choose('[data-action="select-rating"][data-value="4"]');
await nextTo("一般疼痛位置");

await choose('[data-action="toggle-multi"][data-option="point1"]');
await choose('[data-action="toggle-multi"][data-option="point2Back"]');
await page.setViewportSize({ width: 320, height: 667 });
await assertNoHorizontalOverflow("320px疼痛位置页");
await page.setViewportSize({ width: 430, height: 932 });
await assertNoHorizontalOverflow("430px疼痛位置页");
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: path.join(outputDir, "mobile-pain-question.png"), fullPage: true });
await clickAction("next-question");

await page.getByText("1 份", { exact: true }).waitFor();
await clickAction("records");
await page.getByText("测试参与者A", { exact: true }).click();
await page.getByRole("heading", { name: "记录详情", exact: true }).waitFor();
await page.screenshot({ path: path.join(outputDir, "mobile-record-detail.png"), fullPage: true });
assert(await page.getByText(/第1次：5\.2345 mm；平均值：5\.2345 mm/).isVisible(), "单次测量原始值未按输入保留");
assert(await page.getByRole("button", { name: "编辑记录", exact: true }).isVisible(), "原有编辑记录按钮消失");

await page.getByRole("button", { name: "编辑左耳水平佩戴位置厚度", exact: true }).click();
await waitQuestion("左耳水平佩戴位置厚度");
assert(await page.getByRole("heading", { name: "修改记录", exact: true }).isVisible(), "点击详情项没有进入修改记录");
await clickAction("previous-question");
await waitQuestion("年龄");
await clickAction("previous-question");
await waitQuestion("性别");
await clickAction("previous-question");
await waitQuestion("姓名");
await page.locator("[data-field-input]").fill("测试参与者A-修改");
for (const title of [
  "性别",
  "年龄",
  "左耳水平佩戴位置厚度",
  "左耳倾斜佩戴位置厚度",
  "耳夹佩戴习惯",
  "耳型大小评价",
  "开放式耳机偏好",
  "偏好原因",
  "耳朵对耳机佩戴不适的敏感程度",
  "一般疼痛位置"
]) await nextTo(title);
await clickAction("next-question");
await page.getByText("1 份", { exact: true }).waitFor();

const downloadPromise = page.waitForEvent("download");
await clickAction("export-csv");
const download = await downloadPromise;
const csvPath = path.join(outputDir, "exported.csv");
await download.saveAs(csvPath);
const csv = await fs.readFile(csvPath, "utf8");
assert(csv.charCodeAt(0) === 0xfeff, "CSV缺少UTF-8 BOM");
assert(csv.includes("一般疼痛位置"), "CSV缺少疼痛位置题目列");
assert(!csv.includes(",点位1,"), "CSV仍然把一个多选题拆成多个点位列");
assert(csv.includes("点位1；点位2背面"), "CSV多选答案没有合并在一个单元格");
assert(csv.includes("左耳水平佩戴位置厚度－第1次（mm）"), "CSV缺少重复测量原始值列");
assert(csv.includes("左耳水平佩戴位置厚度－平均值（mm）"), "CSV缺少重复测量平均值列");
assert(csv.includes("左耳水平佩戴位置厚度－最大差值（mm）"), "CSV缺少重复测量最大差值列");
assert(csv.includes("5.2345") && csv.includes("6.12345") && csv.includes("6.22345"), "CSV没有保留厚度原始值");
assert(csv.includes("6.17345") && csv.includes("0.1"), "CSV没有正确导出平均值或最大差值");

await clickAction("start-form");
await page.locator("[data-anonymous]").check();
await clickAction("leave-form");
await page.getByRole("button", { name: "继续填写" }).waitFor();
await page.getByRole("button", { name: "废弃草稿" }).waitFor();

await page.reload({ waitUntil: "networkidle" });
assert(await page.getByRole("button", { name: "继续填写" }).isVisible(), "刷新后草稿没有保留");
await clickAction("discard-draft");
await confirmCustomDialog("废弃草稿");
await page.getByRole("button", { name: "开始填写" }).waitFor();

await page.evaluate(() => navigator.serviceWorker?.ready);
await context.setOffline(true);
await page.reload({ waitUntil: "domcontentloaded" });
await page.getByText("佩戴耳厚数据采集", { exact: true }).waitFor();
await page.screenshot({ path: path.join(outputDir, "mobile-home-offline.png"), fullPage: true });
await context.setOffline(false);

await clickAction("templates");
await page.getByRole("heading", { name: "问卷管理", exact: true }).waitFor();
await page.screenshot({ path: path.join(outputDir, "mobile-template-management.png"), fullPage: true });
let importDialogMessage = "";
const importDialogHandler = async (dialog) => {
  importDialogMessage = dialog.message();
  await dialog.accept();
};
page.once("dialog", importDialogHandler);
await page.locator("#template-file-input").setInputFiles(path.resolve("tests", "fixture-template.json"));
await page.waitForTimeout(500);
page.off("dialog", importDialogHandler);
if (importDialogMessage) throw new Error(importDialogMessage);
await page.locator('[data-action="select-template"][data-key="fixture-template@1.0"]').waitFor();
const importedTemplate = page.locator('[data-template-row="fixture-template@1.0"]');
assert(await importedTemplate.getByText("模板导入测试", { exact: false }).isVisible(), "导入模板名称不正确");
assert(await importedTemplate.getByText("0份记录", { exact: false }).isVisible(), "导入模板记录数不正确");

await page.locator('[data-action="select-template"][data-key="ear-anthropometry-survey@1.1"]').click();
await page.locator(".hero-title", { hasText: "佩戴耳厚数据采集" }).waitFor();

await clickAction("backup");
const backupDownloadPromise = page.waitForEvent("download");
await clickAction("export-backup");
const backupDownload = await backupDownloadPromise;
const backupPath = path.join(outputDir, "complete-backup.json");
await backupDownload.saveAs(backupPath);
const backup = JSON.parse(await fs.readFile(backupPath, "utf8"));
assert(backup.format === "research-notebook-backup", "完整备份格式标识不正确");
assert(backup.data.templates.length === 3, "完整备份没有包含V1.0、V1.1和导入问卷模板");
assert(backup.data.records.length === 1, "完整备份没有包含已保存记录");

await clickAction("home");
await clickAction("templates");
await page.locator('[data-template-row="fixture-template@1.0"]').evaluate((row) => row.classList.add("revealed"));
await page.locator('[data-action="delete-template"][data-key="fixture-template@1.0"]').click();
await confirmCustomDialog("删除问卷");
await page.locator('[data-action="select-template"][data-key="fixture-template@1.0"]').waitFor({ state: "detached" });
await page.getByRole("heading", { name: "问卷管理", exact: true }).waitFor();

await clickAction("home");
await clickAction("records");
await page.getByRole("heading", { name: "已保存记录", exact: true }).waitFor();
if (!(await page.getByText("测试参与者A-修改", { exact: true }).count())) {
  throw new Error(`删除测试问卷后找不到原记录，当前页面：\n${await page.locator("body").innerText()}`);
}
await page.getByText("测试参与者A-修改", { exact: true }).click();
await page.getByRole("heading", { name: "记录详情", exact: true }).waitFor();
await clickAction("delete-record");
await confirmCustomDialog("删除记录");
await page.getByText("还没有已完成记录", { exact: true }).waitFor();

await clickAction("home");
await clickAction("backup");
const safetyDownloadPromise = page.waitForEvent("download");
await page.locator("#backup-file-input").setInputFiles(backupPath);
page.once("dialog", (dialog) => dialog.accept());
await confirmCustomDialog("继续恢复");
const safetyDownload = await safetyDownloadPromise;
await safetyDownload.saveAs(path.join(outputDir, "pre-restore-safety-backup.json"));
await page.getByText("1 份", { exact: true }).waitFor();
await clickAction("templates");
await page.locator('[data-action="select-template"][data-key="fixture-template@1.0"]').waitFor();

if (errors.length) throw new Error(`浏览器错误：\n${errors.join("\n")}`);
console.log(JSON.stringify({ passed: true, csvPath, backupPath, screenshots: ["mobile-repeated-measurement.png", "mobile-record-detail.png", "mobile-template-management.png", "mobile-pain-question.png", "mobile-home-offline.png"] }, null, 2));
await browser.close();
