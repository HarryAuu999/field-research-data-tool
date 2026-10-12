import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.AUNOTE_CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "zh-CN" });
const page = await context.newPage();

try {
  await page.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle" });
  assert.equal(await page.locator(".hero .eyebrow").textContent(), "当前问卷");
  assert.equal(await page.locator(".home-footer .text-button").first().evaluate((button) => getComputedStyle(button).fontSize), "13px");

  await page.locator('[data-action="templates"]').first().click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.pageTransition), undefined, "主页功能入口不应使用父子转场");

  await page.locator('[data-action="open-template"]').first().click();
  await page.waitForFunction(() => document.documentElement.dataset.pageTransition === "forward");
  await page.locator(".overview-question-list").waitFor();
  await page.waitForFunction(() => !document.documentElement.dataset.pageTransition);

  await page.locator('[data-action="leave-template-overview"]').click();
  await page.waitForFunction(() => document.documentElement.dataset.pageTransition === "back");
  await page.locator(".template-list").waitFor();
  await page.waitForFunction(() => !document.documentElement.dataset.pageTransition);

  await page.locator('[data-action="home"]').click();
  await page.locator('[data-action="start-form"]').click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.pageTransition), undefined, "填写入口不应使用父子转场");
  console.log(JSON.stringify({ passed: true, scenarios: ["home-direct", "parent-push", "child-pop", "form-direct"] }));
} finally {
  await context.close();
  await browser.close();
}
