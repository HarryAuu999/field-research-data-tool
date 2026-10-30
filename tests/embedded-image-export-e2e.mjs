import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import JSZip from "jszip";

// Synthetic image deliberately exceeds Excel's single-cell text capacity.
// No participant data or product images belong in regression fixtures.
const image = { src: `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><!--${"fixture".repeat(10000)}--><rect width="100" height="100" fill="white"/></svg>`).toString("base64")}`, width: 100, height: 100, alt: "合成测试底图" };
const template = {
  schemaVersion: 1, id: "embedded-export-regression", version: "1.0", title: "内嵌图片导出回归",
  fields: [
    { id: "name", type: "shortText", label: "样本代号" },
    { id: "score", type: "number", label: "评分" },
    { id: "repeat", type: "repeatedNumber", label: "重复测量", repeatCount: 3, minEntries: 1 },
    { id: "area", type: "imageRange", label: "内嵌图标注", view: "custom", annotationType: "pain", brushSize: 0.04,
      levels: [{ id: 1, label: "一般" }, { id: 2, label: "较强" }], image },
    { id: "builtIn", type: "imageRange", label: "内置图标注", view: "side", annotationType: "contact", brushSize: 0.04,
      levels: [{ id: 1, label: "接触" }], image: { src: "./assets/ear-side.png", width: 1149, height: 1368 } },
    { id: "angle", type: "imageAngle", label: "角度", image,
      angle: { center: [0.5, 0.5], zeroDegrees: 180, rotation: "counterclockwise", min: -20, max: 90, step: 1, radius: 0.3 } }
  ]
};
const records = Array.from({ length: 8 }, (_, i) => ({
  id: `synthetic-export-${i}`, templateKey: `${template.id}@${template.version}`, recordNumber: `DEMO-${i}`,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  answers: { name: `展示样本${i}`, score: "3.5", repeat: ["3", "3.5", "4"], angle: i === 0 ? 0 : i === 1 ? -10 : 30,
    area: { version: 1, strokes: [{ id: `stroke-${i}`, annotationType: "pain", level: i % 2 + 1, brushSize: 0.04,
      points: Array.from({ length: i === 7 ? 66 : 65 }, (_, j) => [j / 100, 0.4]) }] },
    builtIn: { version: 1, strokes: [{ id: `built-${i}`, annotationType: "contact", level: 1, brushSize: 0.03, points: [[0.5, 0.5]] }] }
  }
}));

const base = process.env.AUNOTE_TEST_URL || "http://127.0.0.1:4198/";
const browser = await chromium.launch({ headless: true, executablePath: process.env.AUNOTE_CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" });
try {
  async function verifyExport(input, samples, privateCheck = false) {
    const context = await browser.newContext({ acceptDownloads: true, serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(base);
      await page.locator(".hero-title").waitFor();
      await page.evaluate(async ({ input, samples }) => {
        const db = await import("./js/db.js?v=1.4.12");
        const { validateTemplate } = await import("./js/questionnaire-schema.js?v=1.4.12");
        const valid = validateTemplate(input);
        await db.putTemplate(valid);
        for (const record of samples) await db.putRecord(record);
        await db.setSetting("currentTemplateKey", valid.key);
      }, { input, samples });
      await page.reload();
      await page.locator('[data-action="export-xlsx"]').waitFor();
      const before = await page.evaluate(async (key) => {
        const db = await import("./js/db.js?v=1.4.12");
        return { template: await db.getTemplate(key), records: await db.getRecords(key) };
      }, `${input.id}@${input.version}`);
      const downloaded = page.waitForEvent("download");
      await page.locator('[data-action="export-xlsx"]').click();
      const download = await downloaded;
      const buffer = await fs.readFile(await download.path());
      assert.ok(buffer.length < 1024 * 1024, "导出不应随内嵌图片大小乘以标注点数膨胀");
      const workbook = await JSZip.loadAsync(buffer);
      const xml = await workbook.file("xl/worksheets/sheet2.xml").async("string");
      const rangeFields = input.fields.filter((field) => field.type === "imageRange");
      const pointCount = samples.reduce((n, record) => n + rangeFields.reduce((m, field) => m + (record.answers[field.id]?.strokes || []).reduce((sum, stroke) => sum + stroke.points.length, 0), 0), 0);
      assert.equal((xml.match(/<row r=/g) || []).length, pointCount + 1, "每个原始点均导出");
      assert.ok(xml.includes("嵌入图片（见问卷JSON）"));
      const allXml = (await Promise.all(Object.keys(workbook.files).filter((name) => name.endsWith(".xml")).map((name) => workbook.file(name).async("string")))).join("");
      assert.ok(!allXml.includes("data:image/"), "任何worksheet均不得保存图片编码");
      assert.ok(workbook.file("xl/worksheets/sheet3.xml"), "角度元数据保留");
      const responseXml = await workbook.file("xl/worksheets/sheet1.xml").async("string");
      assert.equal((responseXml.match(/<row r=/g) || []).length, samples.length + 1);
      if (!privateCheck) {
        assert.ok(xml.includes("./assets/ear-side.png"), "内置底图路径不变");
        assert.ok(xml.includes("<v>0.04</v>") && xml.includes("<v>0.4</v>"), "画笔及坐标精度保留");
        assert.ok(responseXml.includes("<v>-10</v>") && responseXml.includes("<v>0</v>"), "角度零值及负值保留");
        assert.ok(responseXml.includes("重复测量－平均值"));
      }
      const after = await page.evaluate(async (key) => {
        const db = await import("./js/db.js?v=1.4.12");
        return { template: await db.getTemplate(key), records: await db.getRecords(key) };
      }, `${input.id}@${input.version}`);
      assert.deepEqual(after, before, "导出不得修改问卷内嵌图片或原始样本");
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ passed: true, case: privateCheck ? "user-backup-in-isolated-context" : "synthetic-embedded-and-built-in", records: samples.length, annotationPoints: pointCount, xlsxBytes: buffer.length }));
    } finally {
      await context.close();
    }
  }
  await verifyExport(template, records);
  // Optional private investigation: read only the caller-supplied local file.
  // Never copy it or its exported contents into tracked fixtures or screenshots.
  if (process.env.AUNOTE_PRIVATE_BACKUP) {
    const backup = JSON.parse((await fs.readFile(process.env.AUNOTE_PRIVATE_BACKUP, "utf8")).replace(/^\uFEFF/, ""));
    const input = backup.data.templates.find((item) => item.key === process.env.AUNOTE_PRIVATE_TEMPLATE_KEY);
    assert.ok(input, "指定问卷不存在");
    await verifyExport(input, backup.data.records.filter((record) => record.templateKey === input.key), true);
  }
} finally {
  await browser.close();
}
