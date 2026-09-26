import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import JSZip from "jszip";
import { appVersion } from "./version-consistency.mjs";

const outputDir = path.resolve("test-results");
await fs.mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.AUNOTE_CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
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
  const { PREVIOUS_DEFAULT_TEMPLATE } = await import("./js/default-template.js");
  const latest = structuredClone(PREVIOUS_DEFAULT_TEMPLATE);
  const legacy = structuredClone(PREVIOUS_DEFAULT_TEMPLATE);
  legacy.version = "1.0";
  legacy.fields = legacy.fields.map((field) => ["horizontalThickness", "tiltedThickness"].includes(field.id)
    ? { ...field, type: "number", repeatCount: undefined, minEntries: undefined }
    : field);
  latest.fields.find((field) => field.id === "openEarPreference").options = latest.fields
    .find((field) => field.id === "openEarPreference")
    .options.filter((option) => option.id !== "noPreference");
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
    transaction.objectStore("drafts").put({ templateKey: latest.key, answers: { name: { value: "未完成草稿", anonymous: false } } });
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
await migrationPage.getByText("耳部人体数据采集", { exact: true }).waitFor();
await migrationPage.getByText("由研究人员完成的左耳最小接触厚度、佩戴习惯与主观体验记录。", { exact: true }).waitFor();
await migrationPage.locator('[data-action="templates"]').click();
await migrationPage.locator('[data-template-row="ear-anthropometry-survey@1.0"]').waitFor();
assert(await migrationPage.locator('[data-template-row="ear-anthropometry-survey@1.1"]').getByText("1份记录", { exact: false }).isVisible(), "升级后V1.1记录没有保留");
const preservedQuestionnaire = await migrationPage.evaluate(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("research-notebook", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const template = await new Promise((resolve, reject) => {
    const request = db.transaction("templates").objectStore("templates").get("ear-anthropometry-survey@1.1");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return { title: template.title, fields: template.fields.map((field) => field.id), options: template.fields.find((field) => field.id === "openEarPreference").options };
});
assert(preservedQuestionnaire.title === "耳部人体数据采集" && preservedQuestionnaire.fields.includes("sensitivity") && preservedQuestionnaire.fields.includes("painLocations") && !preservedQuestionnaire.options.some((option) => option.id === "noPreference"), "更新不得修改用户已有的V1.1问卷");
await migrationPage.evaluate(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("research-notebook", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const template = await new Promise((resolve) => {
    const request = db.transaction("templates").objectStore("templates").get("ear-hook-annotation-acceptance@1.0");
    request.onsuccess = () => resolve(request.result);
  });
  delete template.analysis;
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(["templates", "settings"], "readwrite");
    transaction.objectStore("templates").put(template);
    transaction.objectStore("settings").put({ key: "builtInTemplateSeedRevision", value: 5 });
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
});
await migrationPage.reload({ waitUntil: "networkidle" });
const upgradedAnnotation = await migrationPage.evaluate(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("research-notebook", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const transaction = db.transaction(["templates", "records"]);
  const read = (store, key) => new Promise((resolve) => {
    const request = transaction.objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result);
  });
  const [template, record] = await Promise.all([
    read("templates", "ear-hook-annotation-acceptance@1.0"),
    read("records", "legacy-record")
  ]);
  db.close();
  return { analysis: template.analysis?.type, record: record?.recordNumber };
});
assert(!upgradedAnnotation.analysis && upgradedAnnotation.record === "R-LEGACY", "更新不得补写用户已有问卷或修改历史记录");
await migrationPage.evaluate(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("research-notebook", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const template = await new Promise((resolve) => {
    const request = db.transaction("templates").objectStore("templates").get("ear-hook-annotation-acceptance@1.0");
    request.onsuccess = () => resolve(request.result);
  });
  template.fields[1].label = "用户修改过的接触题";
  delete template.analysis;
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(["templates", "settings"], "readwrite");
    transaction.objectStore("templates").put(template);
    transaction.objectStore("settings").put({ key: "builtInTemplateSeedRevision", value: 5 });
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
});
await migrationPage.reload({ waitUntil: "networkidle" });
const customizedAnnotation = await migrationPage.evaluate(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("research-notebook", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const template = await new Promise((resolve) => {
    const request = db.transaction("templates").objectStore("templates").get("ear-hook-annotation-acceptance@1.0");
    request.onsuccess = () => resolve(request.result);
  });
  db.close();
  return { label: template.fields[1].label, analysis: template.analysis };
});
assert(customizedAnnotation.label === "用户修改过的接触题" && !customizedAnnotation.analysis, "用户改过的验收问卷不得被自动补写分析配置");
await migrationContext.close();

const analysisContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: "zh-CN"
});
const analysisPage = await analysisContext.newPage();
await analysisPage.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle" });
await analysisPage.evaluate(async () => {
  const horizontal = [2.72, 2.88, 3.02, 3.14, 3.2, 3.29, 3.34, 3.41, 3.49, 3.55, 3.59, 3.62, 3.66, 3.71, 3.76, 3.82, 3.91, 4.01, 4.08, 4.15, 4.22, 4.31, 4.39, 4.52, 4.66, 4.82, 5.01, 5.32, 5.76];
  const tilted = [3.08, 3.22, 3.35, 3.49, 3.58, 3.64, 3.72, 3.81, 3.96, 4.08, 4.19, 4.31, 4.43, 4.51, 4.58, 4.66, 4.75, 4.83, 4.92, 5.03, 5.12, 5.21, 5.34, 5.47, 5.63, 5.79, 6.02, 6.28, 6.66];
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("research-notebook", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const template = await new Promise((resolve, reject) => {
    const request = db.transaction("templates").objectStore("templates").get("ear-anthropometry-survey@1.2");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  template.analysis = {
    type: "descriptiveDistribution",
    aggregation: "participantMean",
    statistics: ["count", "mean", "median", "mode", "min", "max", "sd", "q1", "q3"],
    percentiles: [20, 50, 80],
    fields: [
      { id: "horizontalThickness", label: "水平位置耳厚分布", theme: "blue" },
      { id: "tiltedThickness", label: "倾斜位置耳厚分布", theme: "orange" }
    ]
  };
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(["templates", "records"], "readwrite");
    transaction.objectStore("templates").put(template);
    horizontal.forEach((value, index) => transaction.objectStore("records").put({
      id: `analysis-${index}`,
      recordNumber: `A-${index + 1}`,
      templateKey: "ear-anthropometry-survey@1.2",
      answers: {
        horizontalThickness: [String(value - 0.02), String(value), String(value + 0.02)],
        tiltedThickness: [String(tilted[index] - 0.02), String(tilted[index]), String(tilted[index] + 0.02)]
      },
      createdAt: new Date(2026, 7, 1, 9, index).toISOString(),
      updatedAt: new Date(2026, 7, 1, 9, index).toISOString()
    }));
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
});
await analysisPage.reload({ waitUntil: "networkidle" });
const homeSecondaryBackgrounds = await analysisPage.evaluate(() => ["analysis", "export-xlsx"].map((action) => {
  const button = document.querySelector(`[data-action="${action}"]`);
  return button ? getComputedStyle(button).backgroundColor : null;
}));
assert(homeSecondaryBackgrounds.every((color) => color === "rgb(255, 255, 255)"), "主页简易分析或导出Excel按钮不是白底");
await analysisPage.getByRole("button", { name: "简易分析", exact: true }).click();
await analysisPage.getByRole("heading", { name: "简易分析", exact: true }).waitFor();
assert(await analysisPage.getByText("KDE 分布曲线", { exact: true }).count() === 2, "29份模拟记录没有绘制KDE分布曲线");
assert(await analysisPage.getByText("正态分布参考", { exact: true }).count() === 2, "29份模拟记录没有绘制正态分布参考");
assert(await analysisPage.getByText("样本数", { exact: true }).count() === 2, "描述性统计缺少样本数");
assert(await analysisPage.getByText("平均数", { exact: true }).count() === 2, "描述性统计缺少平均数");
assert(await analysisPage.getByText("中位数", { exact: true }).count() === 2, "描述性统计缺少中位数");
assert(await analysisPage.getByText("众数", { exact: true }).count() === 2, "描述性统计缺少众数");
assert(await analysisPage.getByText("无明显众数", { exact: true }).count() === 2, "无明显众数规则没有反映在分析页");
assert(await analysisPage.getByText("更多统计", { exact: true }).count() === 2, "手机分析页缺少可展开统计");
assert(await analysisPage.locator("svg[data-analysis-chart]").count() === 2, "简易分析没有使用SVG图表");
assert(await analysisPage.locator("canvas[data-analysis-chart]").count() === 0, "简易分析仍然包含Canvas位图");
assert(await analysisPage.locator('[data-chart-series="normal-reference"]').count() === 2, "简易分析SVG缺少正态分布参考曲线");
const automaticBins = await analysisPage.locator("svg[data-analysis-chart]").evaluateAll((charts) => charts.map((chart) => ({
  mode: chart.dataset.binMode,
  width: Number(chart.dataset.binWidth)
})));
assert(automaticBins.every((item) => item.mode === "automatic"), "内置问卷的简易分析没有使用自动分箱");
assert(automaticBins[0].width === 0.5 && automaticBins[1].width === 1, `自动分箱没有仅按数据分别计算：${JSON.stringify(automaticBins)}`);
const chartThemes = await analysisPage.locator("[data-chart-theme]").evaluateAll((cards) => cards.map((card) => ({
  name: card.dataset.chartTheme,
  color: getComputedStyle(card).getPropertyValue("--chart-color").trim()
})));
assert(chartThemes.length === 2 && chartThemes[0].name === "blue" && chartThemes[1].name === "orange", "两张分析图没有分别使用蓝色和橙色主题");
assert(chartThemes[0].color !== chartThemes[1].color, "两张分析图的主题色仍然相同");
await analysisPage.screenshot({ path: path.join(outputDir, "mobile-analysis.png"), fullPage: true });
await analysisPage.setViewportSize({ width: 844, height: 390 });
await analysisPage.screenshot({ path: path.join(outputDir, "mobile-analysis-landscape.png") });
const landscapeOverflow = await analysisPage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
assert(!landscapeOverflow, "横屏简易分析页面出现横向溢出");
await analysisContext.close();

await page.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle" });
await page.getByText("佩戴耳厚数据采集", { exact: true }).waitFor();
await page.getByText("由研究人员完成的左耳最小接触厚度、佩戴习惯与主观体验记录。", { exact: true }).waitFor();
assert(await page.getByText("0 份", { exact: true }).isVisible(), "首页初始记录数不是0");
assert(await page.getByRole("button", { name: "数据备份/恢复", exact: true }).isVisible(), "主页缺少数据备份/恢复入口");
assert(await page.getByRole("button", { name: "检查更新", exact: true }).isVisible(), "主页缺少检查更新入口");
await page.evaluate(() => navigator.serviceWorker?.ready);
await clickAction("check-update");
await page.getByText(`当前已是最新版本 V${appVersion}`, { exact: true }).waitFor();

await clickAction("start-form");
await page.locator("[data-field-input]").fill("测试参与者A");
await nextTo("性别");

await choose('[data-action="select-single"][data-option="male"]');
await nextTo("年龄");

assert(await page.locator("[data-field-input]").getAttribute("inputmode") === "numeric", "整数题没有调用数字键盘");
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
assert(await page.getByRole("button", { name: "无偏好", exact: true }).isVisible(), "开放式耳机偏好缺少无偏好选项");
await choose('[data-action="select-single"][data-option="clip"]');
await nextTo("偏好原因");

await page.locator("[data-field-input]").fill("不影响眼镜腿，取下更方便");
await clickAction("next-question");

await page.getByText("1 份", { exact: true }).waitFor();
assert(await page.getByRole("button", { name: "简易分析", exact: true }).isVisible(), "支持分析的问卷没有显示简易分析入口");
const beforeAnalysisDatabase = await page.evaluate(async () => {
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
  const result = { templates: await read("templates"), records: await read("records") };
  db.close();
  return JSON.stringify(result);
});
await clickAction("analysis");
await page.getByRole("heading", { name: "简易分析", exact: true }).waitFor();
assert(await page.locator("[data-analysis-chart]").count() === 2, "简易分析没有生成水平与倾斜两张分布图");
assert(await page.getByText("样本数", { exact: true }).count() === 2, "旧distribution配置没有获得描述性统计摘要");
assert(await page.locator("svg[data-analysis-chart]").count() === 2, "已保存记录的简易分析没有使用SVG图表");
const firstChart = page.locator('[data-analysis-chart="0"]');
assert(await firstChart.evaluate((element) => getComputedStyle(element).touchAction) === "pan-y", "图表没有保留系统纵向滚动能力");
const pointerResult = await firstChart.evaluate((element) => {
  const event = new PointerEvent("pointermove", { pointerId: 1, pointerType: "touch", isPrimary: true, clientX: 210, clientY: 180, bubbles: true, cancelable: true });
  element.dispatchEvent(event);
  return { defaultPrevented: event.defaultPrevented, captured: element.hasPointerCapture?.(1) || false };
});
assert(!pointerResult.defaultPrevented, "P值查看错误地阻止了系统页面滚动");
assert(!pointerResult.captured, "P值查看错误地锁定了触摸指针");
assert(await page.locator(".chart-cursor").first().isVisible(), "移动图表后没有显示P值指示线");
assert(await page.locator(".chart-tooltip").first().isVisible(), "移动图表后没有显示P值提示");
assert((await page.locator(".chart-tooltip").first().textContent()).includes("P"), "P值提示内容无效");
assert((await firstChart.getAttribute("aria-label")).includes("P20"), "静态图表缺少P20参考值");
assert((await firstChart.getAttribute("aria-label")).includes("P50"), "静态图表缺少P50参考值");
assert((await firstChart.getAttribute("aria-label")).includes("P80"), "静态图表缺少P80参考值");
const portraitChartWidth = await firstChart.evaluate((element) => element.getBoundingClientRect().width);
await page.setViewportSize({ width: 844, height: 390 });
const landscapeChartWidth = await firstChart.evaluate((element) => element.getBoundingClientRect().width);
assert(landscapeChartWidth > portraitChartWidth, "横屏后分析图表没有使用更宽空间");
await assertNoHorizontalOverflow("横屏简易分析页");
await page.setViewportSize({ width: 390, height: 844 });
await clickAction("home");
const afterAnalysisDatabase = await page.evaluate(async () => {
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
  const result = { templates: await read("templates"), records: await read("records") };
  db.close();
  return JSON.stringify(result);
});
assert(afterAnalysisDatabase === beforeAnalysisDatabase, "打开简易分析后问卷模板或已保存记录发生变化");
await clickAction("records");
await page.getByText("测试参与者A", { exact: true }).click();
await page.getByRole("heading", { name: "记录详情", exact: true }).waitFor();
await page.screenshot({ path: path.join(outputDir, "mobile-record-detail.png"), fullPage: true });
assert(await page.getByText(/第1次：5\.2345 mm；平均值：5\.2345 mm/).isVisible(), "单次测量原始值未按输入保留");
assert(await page.getByRole("button", { name: "编辑记录", exact: true }).count() === 0, "记录详情仍显示多余的编辑记录按钮");

await page.getByRole("button", { name: "编辑左耳水平佩戴位置厚度", exact: true }).click();
await waitQuestion("左耳水平佩戴位置厚度");
assert(await page.getByRole("heading", { name: "修改记录", exact: true }).isVisible(), "点击详情项没有进入修改记录");
await page.locator("[data-repeat-input]").first().fill("5.3345");
await clickAction("leave-form");
await page.getByRole("heading", { name: "记录详情", exact: true }).waitFor();
assert(await page.getByText(/第1次：5\.3345 mm；平均值：5\.3345 mm/).isVisible(), "返回记录详情时没有保存当前问题的修改");
const editReturnState = await page.evaluate(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("research-notebook", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const drafts = await new Promise((resolve, reject) => {
    const request = db.transaction("drafts").objectStore("drafts").getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return drafts;
});
assert(editReturnState.length === 0, "修改已有样本被错误保存为问卷草稿");
await clickAction("records");
await page.getByRole("heading", { name: "已记录样本", exact: true }).waitFor();
await page.getByText("测试参与者A", { exact: true }).click();
await page.getByRole("heading", { name: "记录详情", exact: true }).waitFor();
await page.getByRole("button", { name: "编辑左耳水平佩戴位置厚度", exact: true }).click();
await waitQuestion("左耳水平佩戴位置厚度");
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
  "偏好原因"
]) await nextTo(title);
await clickAction("next-question");
await page.getByRole("heading", { name: "记录详情", exact: true }).waitFor();
await clickAction("records");
await page.getByRole("heading", { name: "已记录样本", exact: true }).waitFor();
await clickAction("home");
await page.getByText("1 份", { exact: true }).waitFor();

const downloadPromise = page.waitForEvent("download");
await clickAction("export-xlsx");
const download = await downloadPromise;
const xlsxPath = path.join(outputDir, "exported.xlsx");
await download.saveAs(xlsxPath);
const workbook = await JSZip.loadAsync(await fs.readFile(xlsxPath));
const responses = await workbook.file("xl/worksheets/sheet1.xml").async("string");
const annotations = await workbook.file("xl/worksheets/sheet2.xml").async("string");
assert(!responses.includes("一般疼痛位置") && !responses.includes("耳朵对耳机佩戴不适的敏感程度"), "新版内置问卷仍导出了已删除的Q10/Q11");
assert(responses.includes("左耳水平佩戴位置厚度－第1次（mm）"), "Responses缺少重复测量原始值列");
assert(responses.includes("左耳水平佩戴位置厚度－平均值（mm）"), "Responses缺少重复测量平均值列");
assert(responses.includes("左耳水平佩戴位置厚度－最大差值（mm）"), "Responses缺少重复测量最大差值列");
assert(responses.includes("5.3345") && responses.includes("6.12345") && responses.includes("6.22345"), "Responses没有保留修改后的厚度原始值");
assert(responses.includes("6.17345") && responses.includes("0.1"), "Responses没有正确导出平均值或最大差值");
assert(annotations.includes("normalizedX"), "Annotations工作表不存在");

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
await page.locator('[data-action="open-template"][data-key="fixture-template@1.0"]').waitFor();
const importedTemplate = page.locator('[data-template-row="fixture-template@1.0"]');
assert(await importedTemplate.getByText("模板导入测试", { exact: false }).isVisible(), "导入模板名称不正确");
assert(await importedTemplate.getByText("0份记录", { exact: false }).isVisible(), "导入模板记录数不正确");

await page.locator('[data-action="open-template"][data-key="ear-anthropometry-survey@1.2"]').click();
await page.getByRole("heading", { name: "问卷概览", exact: true }).waitFor();
assert(await page.getByText("支持简易分析", { exact: true }).isVisible(), "问卷概览没有显示简易分析能力");
assert(await page.getByRole("button", { name: "选择此问卷", exact: true }).isVisible(), "问卷概览底部缺少选择此问卷按钮");
await page.waitForTimeout(2700);
await page.screenshot({ path: path.join(outputDir, "mobile-template-overview.png") });
await clickAction("select-template");
await page.locator(".hero-title", { hasText: "佩戴耳厚数据采集" }).waitFor();
await clickAction("start-form");
await page.getByRole("heading", { name: "填写问卷", exact: true }).waitFor();
await clickAction("leave-form");
await page.locator(".hero-title", { hasText: "佩戴耳厚数据采集" }).waitFor();

await clickAction("backup");
const backupDownloadPromise = page.waitForEvent("download");
await clickAction("export-backup");
const backupDownload = await backupDownloadPromise;
const backupPath = path.join(outputDir, "complete-backup.json");
await backupDownload.saveAs(backupPath);
const backup = JSON.parse(await fs.readFile(backupPath, "utf8"));
assert(backup.format === "research-notebook-backup", "完整备份格式标识不正确");
assert(["ear-anthropometry-survey@1.2", "fixture-template@1.0", "ear-hook-annotation-acceptance@1.0"].every((key) => backup.data.templates.some((template) => template.key === key)), "完整备份没有包含内置问卷、导入问卷和图片标注示例");
assert(backup.data.records.length === 1, "完整备份没有包含已保存记录");

await clickAction("home");
await clickAction("templates");
const fixtureSwipeContent = page.locator('[data-template-row="fixture-template@1.0"] .swipe-content');
await fixtureSwipeContent.dispatchEvent("pointerdown", { pointerId: 7, pointerType: "touch", clientX: 300, clientY: 100 });
await fixtureSwipeContent.dispatchEvent("pointermove", { pointerId: 7, pointerType: "touch", clientX: 240, clientY: 102 });
const swipeTransform = await fixtureSwipeContent.evaluate((element) => getComputedStyle(element).transform);
assert(swipeTransform !== "none", "问卷左滑时条目没有跟随手指移动");
await fixtureSwipeContent.dispatchEvent("pointerup", { pointerId: 7, pointerType: "touch", clientX: 220, clientY: 102 });
await page.locator('[data-template-row="fixture-template@1.0"].revealed').waitFor();
await page.waitForTimeout(2700);
await page.screenshot({ path: path.join(outputDir, "mobile-template-swipe-revealed.png"), fullPage: true });
await page.locator('[data-action="delete-template"][data-key="fixture-template@1.0"]').click();
await confirmCustomDialog("删除问卷");
await page.locator('[data-action="open-template"][data-key="fixture-template@1.0"]').waitFor({ state: "detached" });
await page.getByRole("heading", { name: "问卷管理", exact: true }).waitFor();

await clickAction("home");
await clickAction("records");
await page.getByRole("heading", { name: "已记录样本", exact: true }).waitFor();
if (!(await page.getByText("测试参与者A-修改", { exact: true }).count())) {
  throw new Error(`删除测试问卷后找不到原记录，当前页面：\n${await page.locator("body").innerText()}`);
}
const recordSwipeContent = page.locator('[data-record-row] .swipe-content');
await recordSwipeContent.dispatchEvent("pointerdown", { pointerId: 9, pointerType: "touch", clientX: 300, clientY: 100 });
await recordSwipeContent.dispatchEvent("pointermove", { pointerId: 9, pointerType: "touch", clientX: 220, clientY: 101 });
await recordSwipeContent.dispatchEvent("pointerup", { pointerId: 9, pointerType: "touch", clientX: 220, clientY: 101 });
const recordDeleteButton = page.locator('[data-action="delete-record-by-id"]');
await recordDeleteButton.waitFor();
assert(await page.locator('[data-record-row]').getAttribute("class").then((value) => value.includes("revealed")), "样本左滑后没有显示删除操作");
assert(await page.locator('[data-record-row] [data-action="duplicate-template"]').count() === 0, "样本左滑错误显示复制操作");
await page.waitForTimeout(220);
const recordSwipeGeometry = await page.locator('[data-record-row]').evaluate((row) => {
  const content = row.querySelector(".swipe-content").getBoundingClientRect();
  const remove = row.querySelector(".swipe-delete").getBoundingClientRect();
  return { contentRight: content.right, deleteLeft: remove.left };
});
assert(recordSwipeGeometry.deleteLeft >= recordSwipeGeometry.contentRight, "样本垃圾桶没有显示在内容框外侧");
await recordDeleteButton.click();
await confirmCustomDialog("删除样本");
await page.getByText("还没有已记录样本", { exact: true }).waitFor();

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
await page.locator('[data-action="open-template"][data-key="fixture-template@1.0"]').waitFor();

for (const example of [
  { file: "examples/basic-questionnaire.json", key: "basic-product-feedback@1.0" },
  { file: "examples/full-feature-questionnaire.json", key: "full-feature-example@1.0" }
]) {
  let message = "";
  const handler = async (dialog) => {
    message = dialog.message();
    await dialog.accept();
  };
  page.once("dialog", handler);
  await page.locator("#template-file-input").setInputFiles(path.resolve(example.file));
  await page.waitForTimeout(400);
  page.off("dialog", handler);
  if (message) throw new Error(`示例问卷导入失败：${message}`);
  await page.locator(`[data-action="open-template"][data-key="${example.key}"]`).waitFor();
}

const wrappedTemplate = {
  questionnaire: {
    schemaVersion: "1",
    id: "wrapped-ai-template",
    version: "1.0",
    title: "AI包装格式兼容测试",
    fields: [{ id: "note", type: "shortText", label: "记录" }]
  }
};
await page.locator("#template-file-input").setInputFiles({
  name: "wrapped-ai-template.json",
  mimeType: "application/json",
  buffer: Buffer.from(JSON.stringify(wrappedTemplate))
});
await page.locator('[data-action="open-template"][data-key="wrapped-ai-template@1.0"]').waitFor();

let invalidImportMessage = "";
page.once("dialog", async (dialog) => {
  invalidImportMessage = dialog.message();
  await dialog.accept();
});
await page.locator("#template-file-input").setInputFiles({
  name: "wrong-structure.json",
  mimeType: "application/json",
  buffer: Buffer.from(JSON.stringify({ title: "错误结构", fields: [] }))
});
await page.waitForTimeout(300);
assert(invalidImportMessage.includes("实际读取：未找到") && invalidImportMessage.includes("顶层字段：title、fields"), "导入失败没有显示实际文件结构诊断");
const expectedDiagnosticIndex = errors.findIndex((message) => message.includes("实际读取：未找到") && message.includes("顶层字段：title、fields"));
if (expectedDiagnosticIndex >= 0) errors.splice(expectedDiagnosticIndex, 1);

if (errors.length) throw new Error(`浏览器错误：\n${errors.join("\n")}`);
console.log(JSON.stringify({ passed: true, xlsxPath, backupPath, screenshots: ["mobile-repeated-measurement.png", "mobile-record-detail.png", "mobile-template-management.png", "mobile-pain-question.png", "mobile-home-offline.png"] }, null, 2));
await browser.close();
