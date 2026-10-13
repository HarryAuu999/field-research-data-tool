import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";

const template = await fs.readFile("tools/heatmap-report-template.html", "utf8");
assert.equal(template.includes("__HEATMAP_DATA__"), true);
const svg = (color) => `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="${color}"/></svg>`).toString("base64")}`;
const data = {
  title: "模拟热力图",
  sample_total: 2,
  fields: [{ id: "test", label: "测试图片", participants: 1, stroke_count: 1, max_count: 1, width: 4, height: 4, image: svg("white"), count_mask: svg("rgb(1,0,0)") }]
};
const browser = await chromium.launch({ headless: true, executablePath: process.env.AUNOTE_CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" });
try {
  const page = await browser.newPage();
  await page.setContent(template.replace("__HEATMAP_DATA__", JSON.stringify(data)));
  await page.waitForFunction(() => document.querySelector("#feather-value")?.textContent?.includes("%"));
  assert.equal(await page.locator("h1").textContent(), "模拟热力图");
  assert.equal(await page.locator(".palette-node").count(), 5);
  assert.equal(await page.locator(".palette-node input[type=color]").first().inputValue(), "#acd0f1");
  assert.equal(await page.locator(".palette-node input[type=color]").last().inputValue(), "#e13737");
  assert.equal(await page.evaluate(() => !!(document.querySelector("#maps").compareDocumentPosition(document.querySelector(".palette-editor")) & Node.DOCUMENT_POSITION_FOLLOWING)), true, "RGB 调色应在热力图下方");
  const rgba = await page.locator(".card canvas").evaluate((canvas) => [...canvas.getContext("2d").getImageData(2, 2, 1, 1).data]);
  assert(rgba.slice(0, 3).every((channel, index) => Math.abs(channel - [37, 203, 117][index]) <= 1), "50% 人数应使用绿色节点");
  assert(rgba[3] > 0);
  await page.locator(".palette-node input[type=color]").nth(2).fill("#ff0000");
  await page.waitForFunction(() => document.querySelector(".card canvas").getContext("2d").getImageData(2, 2, 1, 1).data[0] === 255);
  console.log(JSON.stringify({ passed: true, scenarios: ["generic-data", "palette-below-maps", "continuous-color", "rgb-edit"] }));
} finally {
  await browser.close();
}
