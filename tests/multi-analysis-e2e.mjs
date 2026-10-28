import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const base = JSON.parse(readFileSync(new URL("../examples/ear-image-range-test.json", import.meta.url), "utf8"));
const angleExample = JSON.parse(readFileSync(new URL("../examples/ear-image-angle-test.json", import.meta.url), "utf8"));
const test = structuredClone(base);
test.id = "combined-analysis-e2e";
test.version = "1.0";
test.title = "多类型分析验收";
test.fields = [
  { id: "name", type: "shortText", label: "姓名" },
  { id: "thickness", type: "number", label: "耳厚", unit: "mm" },
  { id: "comfort", type: "rating", label: "舒适度", min: 1, max: 5 },
  { id: "preference", type: "singleChoice", label: "偏好", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] },
  { id: "issues", type: "multiChoice", label: "原因", options: [{ id: "x", label: "X" }, { id: "y", label: "Y" }] },
  base.fields.find((field) => field.id === "contactSide"),
  base.fields.find((field) => field.id === "painSection"),
  angleExample.fields[0]
];
delete test.analysis;
test.analyses = [
  { type: "descriptiveDistribution", aggregation: "participantMean", fields: [{ id: "thickness" }] },
  { type: "categoricalFrequency", fields: [{ id: "comfort" }, { id: "preference" }, { id: "issues" }] },
  { type: "imageRangeHeatmap", fields: [{ id: "contactSide" }, { id: "painSection" }] },
  angleExample.analyses[0]
];
const records = [
  {
    id: "analysis-sample-1",
    templateKey: "combined-analysis-e2e@1.0",
    createdAt: "2026-10-15T08:00:00.000Z",
    updatedAt: "2026-10-15T08:00:00.000Z",
    answers: {
      name: "P001", thickness: "5.1", comfort: 4, preference: { value: "a" }, wearAngle: 0,
      issues: { values: ["x", "y"] },
      contactSide: { version: 1, strokes: [{ id: "stroke1", annotationType: "contact", level: 1, brushSize: 0.027, points: [[0.5, 0.5], [0.52, 0.52]] }] },
      painSection: { version: 1, strokes: [{ id: "stroke2", annotationType: "pain", level: 1, brushSize: 0.027, points: [[0.4, 0.4], [0.42, 0.42]] }] }
    }
  },
  {
    id: "analysis-sample-2",
    templateKey: "combined-analysis-e2e@1.0",
    createdAt: "2026-10-15T08:01:00.000Z",
    updatedAt: "2026-10-15T08:01:00.000Z",
    answers: { name: "P002", thickness: "6.3", comfort: 5, preference: { value: "a" }, issues: { values: ["x"] }, wearAngle: 30 }
  }
];

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.AUNOTE_CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
});
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(process.env.AUNOTE_TEST_URL || "http://127.0.0.1:4173/", { waitUntil: "networkidle" });
  await page.evaluate(async ({ template, records }) => {
    const db = await import("./js/db.js?v=1.4.7");
    const { validateTemplate } = await import("./js/questionnaire-schema.js?v=1.4.7");
    const valid = validateTemplate(template);
    await db.putTemplate(valid);
    for (const record of records) await db.putRecord(record);
    await db.setSetting("currentTemplateKey", valid.key);
  }, { template: test, records });
  await page.reload({ waitUntil: "networkidle" });
  await page.locator('[data-action="analysis"]').click();
  await page.getByText("数值统计与分布").waitFor();
  await page.getByText("评分与选项分布").waitFor();
  await page.getByText("图片区域热力图").waitFor();
  assert.equal(await page.locator("[data-analysis-chart]").count(), 1);
  assert.equal(await page.locator(".analysis-module").count(), 4);
  await page.locator(".image-angle-chart").waitFor();
  assert.match(await page.locator(".image-angle-statistics").textContent(), /平均数\s*15°/);
  assert.equal(await page.locator("[data-angle-bin]").evaluateAll((bars) => bars.reduce((sum, bar) => sum + Number(bar.dataset.count), 0)), 2);
  assert.equal(await page.locator(".frequency-row").count(), 9);
  const frequencyCards = await page.locator(".analysis-module").nth(1).locator(".analysis-chart-card").allTextContents();
  assert.match(frequencyCards[0], /4\s*1 人 · 50%/);
  assert.match(frequencyCards[0], /5\s*1 人 · 50%/);
  assert.match(frequencyCards[1], /A\s*2 人 · 100%/);
  assert.match(frequencyCards[2], /X\s*2 人 · 100%/);
  assert.match(frequencyCards[2], /Y\s*1 人 · 50%/);
  assert.equal(await page.locator("[data-heatmap-overlay]").count(), 1);
  await page.locator("[data-heatmap-field]").selectOption("painSection");
  await page.waitForFunction(() => document.querySelector("[data-heatmap-image]")?.getAttribute("src")?.includes("ear-side-section"));
  await page.locator("[data-heatmap-field]").selectOption("contactSide");
  await page.waitForFunction(() => document.querySelector("[data-heatmap-overlay]")?.width > 0);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `${width}px 手机视口发生横向溢出：${overflow}px`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/multi-analysis-mobile.png", fullPage: true });
  assert.deepEqual(pageErrors, [], "多类型分析页面发生运行错误");

  // Legacy templates must still open their original single heatmap view.
  await page.evaluate(async ({ template, records }) => {
    const db = await import("./js/db.js?v=1.4.7");
    const { validateTemplate } = await import("./js/questionnaire-schema.js?v=1.4.7");
    const valid = validateTemplate(template);
    await db.putTemplate(valid);
    await db.putRecord({
      id: "legacy-heatmap-sample", templateKey: valid.key,
      createdAt: "2026-10-15T08:02:00.000Z", updatedAt: "2026-10-15T08:02:00.000Z",
      answers: { name: "P003", contactSide: records[0].answers.contactSide }
    });
    await db.setSetting("currentTemplateKey", valid.key);
  }, { template: base, records });
  await page.reload({ waitUntil: "networkidle" });
  await page.locator('[data-action="analysis"]').click();
  await page.locator("[data-heatmap-overlay]").waitFor();
  assert.equal(await page.locator("[data-heatmap-overlay]").count(), 1);
  assert.deepEqual(pageErrors, [], "旧问卷单类型热力图页面发生运行错误");
  console.log(JSON.stringify({ passed: true, modules: 4, legacy: true }));
  await context.close();
} finally {
  await browser.close();
}
