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

await page.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle" });
await page.getByText("耳部人体数据采集", { exact: true }).waitFor();
assert(await page.getByText("0 份", { exact: true }).isVisible(), "首页初始记录数不是0");

await clickAction("start-form");
await page.locator("[data-field-input]").fill("测试参与者A");
await nextTo("性别");

await choose('[data-action="select-single"][data-option="male"]');
await nextTo("年龄");

await page.locator("[data-field-input]").fill("29");
await nextTo("左耳水平佩戴位置厚度");
await page.locator("[data-field-input]").fill("5.2345");
await nextTo("左耳倾斜佩戴位置厚度");
await page.locator("[data-field-input]").fill("6.12345");
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
assert(await page.getByText("5.2345", { exact: true }).isVisible(), "小数值未按原输入保留");

await clickAction("edit-record");
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
assert(csv.includes("5.2345") && csv.includes("6.12345"), "CSV没有保留厚度小数");

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
await page.getByText("耳部人体数据采集", { exact: true }).waitFor();
await page.screenshot({ path: path.join(outputDir, "mobile-home-offline.png"), fullPage: true });
await context.setOffline(false);

await clickAction("templates");
await page.getByRole("heading", { name: "问卷管理", exact: true }).waitFor();
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

await page.locator('[data-action="select-template"][data-key="ear-anthropometry-survey@1.0"]').click();
await page.locator(".hero-title", { hasText: "耳部人体数据采集" }).waitFor();

await clickAction("backup");
const backupDownloadPromise = page.waitForEvent("download");
await clickAction("export-backup");
const backupDownload = await backupDownloadPromise;
const backupPath = path.join(outputDir, "complete-backup.json");
await backupDownload.saveAs(backupPath);
const backup = JSON.parse(await fs.readFile(backupPath, "utf8"));
assert(backup.format === "research-notebook-backup", "完整备份格式标识不正确");
assert(backup.data.templates.length === 2, "完整备份没有包含两份问卷模板");
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
console.log(JSON.stringify({ passed: true, csvPath, backupPath, screenshots: ["mobile-pain-question.png", "mobile-home-offline.png"] }, null, 2));
await browser.close();
