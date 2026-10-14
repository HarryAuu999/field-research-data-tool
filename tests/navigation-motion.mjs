import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.AUNOTE_CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "zh-CN" });
const page = await context.newPage();

try {
  await page.goto(process.env.AUNOTE_TEST_URL || "http://127.0.0.1:4173/", { waitUntil: "networkidle" });

  await page.locator('[data-action="templates"]').first().click();
  await page.waitForFunction(() => document.documentElement.dataset.pageTransition === "forward");
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement, "::view-transition-new(aunote-screen)").animationDuration), "0.32s");
  await page.waitForFunction(() => !document.documentElement.dataset.pageTransition);

  await page.locator('[data-action="home"]').click();
  await page.waitForFunction(() => document.documentElement.dataset.pageTransition === "back");
  await page.waitForFunction(() => !document.documentElement.dataset.pageTransition);

  await page.locator('[data-action="records"]').click();
  await page.waitForFunction(() => document.documentElement.dataset.pageTransition === "forward");
  await page.waitForFunction(() => !document.documentElement.dataset.pageTransition);
  await page.locator('[data-action="home"]').click();
  await page.waitForFunction(() => document.documentElement.dataset.pageTransition === "back");
  await page.waitForFunction(() => !document.documentElement.dataset.pageTransition);

  await page.locator('[data-action="templates"]').first().click();
  await page.waitForFunction(() => !document.documentElement.dataset.pageTransition);

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
  console.log(JSON.stringify({ passed: true, scenarios: ["home-templates-push-pop", "home-records-push-pop", "nested-push-pop", "form-direct"] }));
} finally {
  await context.close();
  await browser.close();
}
