import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.AUNOTE_CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await context.newPage();

try {
  await page.goto(process.env.AUNOTE_TEST_URL || "http://127.0.0.1:4173/", { waitUntil: "networkidle" });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.evaluate(() => {
    ServiceWorkerRegistration.prototype.update = () => new Promise(() => {});
  });

  await page.locator('[data-action="check-update"]').click();
  await page.getByText("正在检查更新…", { exact: true }).waitFor();
  assert.equal(await page.locator('[data-action="check-update"]').isDisabled(), true, "等待期间仅检查更新按钮应禁用");

  await page.locator('[data-action="templates"]').first().click();
  await page.getByRole("heading", { name: "问卷管理" }).waitFor();
  await page.locator('[data-action="home"]').click();
  await page.getByText("检查更新超时，仍可继续使用；请稍后重试", { exact: true }).waitFor({ timeout: 12000 });
  assert.equal(await page.locator('[data-action="check-update"]').isEnabled(), true, "超时后检查更新按钮应恢复");
  console.log(JSON.stringify({ passed: true, scenarios: ["update-check-does-not-lock-app", "update-check-timeout-recovers"] }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
