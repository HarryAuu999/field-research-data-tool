import assert from "node:assert/strict";
import { chromium, devices } from "playwright";

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
});
const context = await browser.newContext({ ...devices["Pixel 7"], locale: "zh-CN", acceptDownloads: true });
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});

try {
  await page.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle" });
  const client = await context.newCDPSession(page);
  const [{ data, errors = [] }, installability] = await Promise.all([
    client.send("Page.getAppManifest"),
    client.send("Page.getInstallabilityErrors")
  ]);
  const manifest = JSON.parse(data);
  const iconChecks = await page.evaluate(async (icons) => Promise.all(icons.map(async (icon) => {
    const response = await fetch(icon.src);
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    return { src: icon.src, ok: response.ok, type: response.headers.get("content-type"), width: bitmap.width, height: bitmap.height };
  })), manifest.icons);

  assert.equal(errors.length, 0, `Manifest 解析错误：${JSON.stringify(errors)}`);
  assert.equal(manifest.id, "./", "PWA 缺少稳定的安装标识");
  assert.ok(manifest.icons.some((icon) => icon.sizes === "192x192" && icon.type === "image/png"), "缺少 Android 192px PNG 图标");
  assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512" && icon.type === "image/png"), "缺少 Android 512px PNG 图标");
  assert.ok(manifest.icons.every((icon) => icon.type === "image/png" && icon.purpose === "any"), "Android 安装清单应使用兼容性稳定的普通 PNG 图标");
  assert.ok(iconChecks.every((icon) => icon.ok && icon.type?.includes("image/png") && icon.width === icon.height), "Android 图标资源无法正确读取");
  assert.equal(consoleErrors.length, 0, `Android 页面控制台错误：${consoleErrors.join("；")}`);
  assert.equal(await page.locator(".app-header").isVisible(), true, "Android 视口下主页不可见");
  const viewport = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  assert.ok(viewport.scrollWidth <= viewport.width, "Android 视口出现横向溢出");

  await page.evaluate(async () => {
    const template = {
      schemaVersion: 1,
      id: "android-core",
      version: "1.0",
      key: "android-core@1.0",
      title: "Android 核心测试",
      description: "安卓核心填写流程",
      importedAt: new Date().toISOString(),
      fields: [
        { id: "name", type: "shortText", label: "姓名", required: true },
        { id: "age", type: "number", label: "年龄", required: true, integer: true },
        { id: "choice", type: "singleChoice", label: "选择", required: true, options: [{ id: "yes", label: "是" }, { id: "no", label: "否" }] }
      ]
    };
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("research-notebook", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(["templates", "records", "drafts", "settings"], "readwrite");
      transaction.objectStore("templates").put(template);
      transaction.objectStore("records").clear();
      transaction.objectStore("drafts").clear();
      transaction.objectStore("settings").put({ key: "currentTemplateKey", value: template.key });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("Android 核心测试", { exact: true }).waitFor();
  await page.locator('[data-action="start-form"]').click();
  await page.locator("[data-field-input]").fill("安卓测试样本");
  await page.locator('[data-action="next-question"]').click();
  await page.locator(".question-title", { hasText: "年龄" }).waitFor();
  const numberInput = page.locator("[data-field-input]");
  assert.equal(await numberInput.getAttribute("inputmode"), "numeric", "Android 整数题没有声明数字键盘");
  await numberInput.fill("30");
  await page.locator('[data-action="next-question"]').click();
  await page.locator(".question-title", { hasText: "选择" }).waitFor();
  await page.locator('[data-action="select-single"][data-option="yes"]').click();
  await page.locator('[data-action="next-question"]').click();
  await page.getByText("1 份", { exact: true }).waitFor();

  const downloadPromise = page.waitForEvent("download");
  await page.locator('[data-action="export-csv"]').click();
  const download = await downloadPromise;
  assert.ok((await download.createReadStream()) !== null, "Android Chrome 未能生成 CSV 下载");

  await page.locator('[data-action="records"]').click();
  const recordRow = page.locator("[data-record-row]");
  const recordContent = recordRow.locator(".swipe-content");
  await recordContent.dispatchEvent("pointerdown", { pointerId: 21, pointerType: "touch", clientX: 340, clientY: 150 });
  await recordContent.dispatchEvent("pointermove", { pointerId: 21, pointerType: "touch", clientX: 250, clientY: 151 });
  await recordContent.dispatchEvent("pointerup", { pointerId: 21, pointerType: "touch", clientX: 250, clientY: 151 });
  await page.waitForTimeout(220);
  assert.ok((await recordRow.getAttribute("class")).includes("revealed"), "Android 触摸左滑未能显示样本删除操作");
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("1 份", { exact: true }).waitFor();
  await page.locator('[data-action="records"]').click();
  await page.locator('[data-action="open-record"]').click();
  await page.locator('[data-action="edit-record-at"][data-field-index="1"]').click();
  await page.locator("[data-field-input]").fill("31");
  await page.locator('[data-action="leave-form"]').click();
  await page.getByText("31", { exact: true }).waitFor();
  await page.locator('[data-action="records"]').click();
  await page.locator('[data-action="home"]').click();
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("1 份", { exact: true }).waitFor();

  await page.evaluate(() => navigator.serviceWorker?.ready);
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText("Android 核心测试", { exact: true }).waitFor();
  await context.setOffline(false);

  console.log(JSON.stringify({
    passed: true,
    device: "Pixel 7",
    scenarios: ["manifest-icons", "responsive-home", "form-input", "record-save", "touch-swipe", "record-edit", "persistence", "csv-download", "offline-reload"],
    installabilityErrors: installability.installabilityErrors,
    icons: manifest.icons,
    iconChecks
  }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
