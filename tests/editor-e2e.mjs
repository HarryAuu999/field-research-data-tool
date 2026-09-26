import { chromium } from "playwright";
import fs from "node:fs/promises";
import JSZip from "jszip";
import { appVersion } from "./version-consistency.mjs";

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.AUNOTE_CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function databaseSnapshot(page) {
  return page.evaluate(async () => {
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
    const result = {
      templates: await read("templates"),
      records: await read("records"),
      drafts: await read("drafts"),
      settings: await read("settings")
    };
    db.close();
    return result;
  });
}

async function openHiddenAction(page, action, key) {
  await page.locator(`[data-action="${action}"][data-key="${key}"]`).evaluate((element) => element.click());
}

async function confirm(page, label) {
  const dialog = page.getByRole("alertdialog");
  await dialog.waitFor();
  await dialog.getByRole("button", { name: label, exact: true }).click();
}

async function longPressReorder(page, fromIndex = 0, toIndex = 2) {
  const sourceCard = page.locator("[data-editor-field-id]").nth(fromIndex);
  const targetCard = page.locator("[data-editor-field-id]").nth(toIndex);
  const sourceBox = await sourceCard.evaluate((element) => element.getBoundingClientRect().toJSON());
  const targetBox = await targetCard.evaluate((element) => element.getBoundingClientRect().toJSON());
  const client = await page.context().newCDPSession(page);
  const startPoint = { x: sourceBox.x + 70, y: sourceBox.y + 30, id: 1, radiusX: 6, radiusY: 6, force: 1 };
  const targetPoint = { x: targetBox.x + 70, y: targetBox.bottom - 4, id: 1, radiusX: 6, radiusY: 6, force: 1 };
  const scrollBeforeDrag = await page.evaluate(() => window.scrollY);
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [startPoint] });
  await page.waitForTimeout(470);
  assert(await page.locator(".reorder-drag-ghost").count() === 1, "长按后没有创建跟手浮动卡片");
  assert(await sourceCard.evaluate((element) => element.classList.contains("reorder-placeholder")), "长按后原位置没有保留占位");
  await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [targetPoint] });
  await page.waitForTimeout(30);
  const ghostTransform = await page.locator(".reorder-drag-ghost").evaluate((element) => element.style.transform);
  assert(ghostTransform.includes("translate3d") && !ghostTransform.includes("translate3d(0, 0px"), "浮动卡片没有跟随手指移动");
  assert(await page.locator("[data-editor-field-id]").nth(1).evaluate((element) => element.style.transform.includes("translate3d")), "其他问题没有为拖动卡片平滑让位");
  const scrollAfterDrag = await page.evaluate(() => window.scrollY);
  assert(Math.abs(scrollAfterDrag - scrollBeforeDrag) <= 1, `长按浮起后页面仍被手势滚动：${scrollBeforeDrag} -> ${scrollAfterDrag}`);
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await client.detach();
}

const noRecordContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "zh-CN" });
const noRecordPage = await noRecordContext.newPage();
await noRecordPage.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle" });
assert(await noRecordPage.locator("#update-skip").count() === 1 && await noRecordPage.locator("#update-later").count() === 1, "更新提示缺少跳过或此次不更新操作");
await noRecordPage.evaluate((version) => {
  document.querySelector("#update-title").textContent = `发现新版本 V${version}`;
  document.querySelector("#update-summary").textContent = "本次更新：改进问卷编辑体验，并修复已知问题。";
  document.querySelector("#update-dialog").hidden = false;
  document.body.classList.add("dialog-open");
}, appVersion);
await noRecordPage.screenshot({ path: "test-results/mobile-update-dialog.png" });
await noRecordPage.evaluate(() => {
  document.querySelector("#update-dialog").hidden = true;
  document.body.classList.remove("dialog-open");
});
await noRecordPage.getByRole("button", { name: "佩戴耳厚数据采集", exact: false }).first().click();
await noRecordPage.getByRole("heading", { name: "问卷管理", exact: true }).waitFor();
assert(await noRecordPage.locator('[data-template-row="ear-anthropometry-survey@1.2"] .swipe-action').count() === 2, "问卷左滑区域应只有复制和删除两个操作");
assert(await noRecordPage.locator('[data-template-row="ear-hook-annotation-acceptance@1.0"]').count() === 1, "新安装缺少图片标注验收问卷");
assert(await noRecordPage.locator('[data-template-row="ear-anthropometry-survey@1.0"]').count() === 0, "新安装不应再内置旧耳厚V1.0问卷");
await openHiddenAction(noRecordPage, "duplicate-template", "ear-anthropometry-survey@1.2");
const initialCopyData = await databaseSnapshot(noRecordPage);
const emptySource = initialCopyData.templates.find((item) => item.title === "佩戴耳厚数据采集（副本）");
assert(emptySource, "没有生成用于无记录编辑测试的问卷副本");

await noRecordPage.locator(`[data-action="open-template"][data-key="${emptySource.key}"]`).click();
await noRecordPage.getByRole("heading", { name: "问卷概览", exact: true }).waitFor();
await noRecordPage.getByRole("button", { name: "选择此问卷", exact: true }).click();
await noRecordPage.getByText("当前问卷 / CURRENT", { exact: true }).waitFor();
assert(await noRecordPage.locator(".form-screen").count() === 0, "选择问卷后错误地进入了填写页面");
await noRecordPage.locator('[data-action="templates"]').first().click();
await noRecordPage.locator(`[data-action="open-template"][data-key="${emptySource.key}"]`).click();
await noRecordPage.getByRole("button", { name: "选择此问卷", exact: true }).waitFor();
const reorderSelectionStyles = await noRecordPage.locator("[data-editor-field-id]").first().evaluate((element) => ({
  userSelect: getComputedStyle(element).userSelect,
  webkitUserSelect: getComputedStyle(element).webkitUserSelect,
  webkitTouchCallout: getComputedStyle(element).webkitTouchCallout
}));
assert(reorderSelectionStyles.userSelect === "none" || reorderSelectionStyles.webkitUserSelect === "none", "可拖动问题仍允许iOS长按选择文字");
const initialOrder = await noRecordPage.locator("[data-editor-field-id]").evaluateAll((items) => items.map((item) => item.dataset.editorFieldId));
await longPressReorder(noRecordPage);
const reorderedInitialOrder = await noRecordPage.locator("[data-editor-field-id]").evaluateAll((items) => items.map((item) => item.dataset.editorFieldId));
assert(JSON.stringify(initialOrder) !== JSON.stringify(reorderedInitialOrder), "长按拖动没有改变问题顺序");
await noRecordPage.getByRole("button", { name: "保存问卷", exact: true }).waitFor();
assert(await noRecordPage.getByRole("button", { name: "另存为副本", exact: true }).isVisible(), "问卷修改后缺少另存为副本操作");
await noRecordPage.screenshot({ path: "test-results/mobile-questionnaire-editor.png", fullPage: true });
await noRecordPage.locator('[data-action="open-editor-meta"]').click();
await noRecordPage.locator("[data-editor-template-title]").fill("无记录问卷修改测试");
await noRecordPage.locator("[data-editor-template-description]").fill("这是新的背景信息，会显示在首页。");
await noRecordPage.getByRole("button", { name: "完成", exact: true }).click();
await noRecordPage.locator('[data-action="open-question-type-picker"]').click();
const addTypeDialog = noRecordPage.getByRole("dialog", { name: "选择问题类型" });
await addTypeDialog.waitFor();
assert(await addTypeDialog.getByRole("button", { name: "关闭", exact: true }).count() === 0, "新增题型选择器仍显示取消按钮");
await noRecordPage.locator(".question-type-overlay").click({ position: { x: 4, y: 4 } });
await addTypeDialog.waitFor({ state: "detached" });
await noRecordPage.locator('[data-action="open-question-type-picker"]').click();
await addTypeDialog.waitFor();
await noRecordPage.screenshot({ path: "test-results/mobile-question-type-picker.png", fullPage: true });
await noRecordPage.getByRole("button", { name: /数字/ }).first().click();
const editorTextControlSizes = await noRecordPage.locator('.editor-form-content input:not([type="checkbox"]), .editor-form-content textarea').evaluateAll((elements) => elements.map((element) => getComputedStyle(element).fontSize));
assert(editorTextControlSizes.length > 0 && editorTextControlSizes.every((size) => Number.parseFloat(size) >= 16), `问题编辑输入框字号小于16px，可能触发iOS自动缩放：${JSON.stringify(editorTextControlSizes)}`);
await noRecordPage.locator("[data-field-label]").fill("新增数字题");
await noRecordPage.locator("[data-field-unit]").fill("mm");
await noRecordPage.screenshot({ path: "test-results/mobile-question-editor.png", fullPage: true });
await noRecordPage.getByRole("button", { name: "完成", exact: true }).click();
await noRecordPage.locator('[data-editor-field-id="name"]').click();
await noRecordPage.locator('[data-action="open-question-type-picker"][data-mode="change"]').click();
const changeTypeDialog = noRecordPage.getByRole("dialog", { name: "选择问题类型" });
await changeTypeDialog.waitFor();
assert(await changeTypeDialog.getByRole("button", { name: "关闭", exact: true }).count() === 0, "修改题型选择器仍显示取消按钮");
await noRecordPage.getByRole("heading", { name: "编辑问题", exact: true }).click();
await changeTypeDialog.waitFor({ state: "detached" });
await noRecordPage.locator('[data-action="open-question-type-picker"][data-mode="change"]').click();
await changeTypeDialog.waitFor();
await noRecordPage.getByRole("button", { name: /长文字/ }).click();
await confirm(noRecordPage, "更换题型");
await noRecordPage.locator(".editor-type-label strong", { hasText: "长文字" }).waitFor();
await noRecordPage.getByRole("button", { name: "完成", exact: true }).click();

const lowerQuestionCard = noRecordPage.locator('[data-editor-field-id="preferenceReason"]');
await lowerQuestionCard.evaluate((element) => window.scrollTo(0, Math.max(0, element.getBoundingClientRect().top + window.scrollY - 220)));
const overviewScrollBeforeQuestion = await noRecordPage.evaluate(() => window.scrollY);
assert(overviewScrollBeforeQuestion > 0, "滚动位置恢复测试没有进入概览页下方");
await lowerQuestionCard.evaluate((element) => element.click());
await noRecordPage.waitForFunction(() => window.scrollY === 0);
assert(await noRecordPage.getByRole("dialog", { name: "选择问题类型" }).count() === 0, "重新进入问题时仍残留上次的题型弹窗");
await noRecordPage.locator("[data-field-label]").fill("临时性别题");
await noRecordPage.getByRole("button", { name: "返回", exact: true }).click();
const questionLeaveDialog = noRecordPage.getByRole("alertdialog");
await questionLeaveDialog.getByRole("button", { name: "继续编辑", exact: true }).click();
assert(await noRecordPage.locator("[data-field-label]").inputValue() === "临时性别题", "继续编辑没有保留当前输入");
await noRecordPage.getByRole("button", { name: "返回", exact: true }).click();
await confirm(noRecordPage, "放弃更改");
await noRecordPage.getByRole("heading", { name: "问卷概览", exact: true }).waitFor();
await noRecordPage.waitForFunction((expected) => Math.abs(window.scrollY - expected) <= 2, overviewScrollBeforeQuestion);
assert(await noRecordPage.getByText("临时性别题", { exact: true }).count() === 0, "放弃问题编辑后修改仍然生效");

await lowerQuestionCard.evaluate((element) => window.scrollTo(0, Math.max(0, element.getBoundingClientRect().top + window.scrollY - 220)));
const overviewScrollBeforeComplete = await noRecordPage.evaluate(() => window.scrollY);
await lowerQuestionCard.evaluate((element) => element.click());
await noRecordPage.locator("[data-field-description]").fill("用于验证完成编辑后的概览位置恢复");
await noRecordPage.getByRole("button", { name: "完成", exact: true }).click();
await noRecordPage.getByRole("heading", { name: "问卷概览", exact: true }).waitFor();
await noRecordPage.waitForFunction((expected) => Math.abs(window.scrollY - expected) <= 2, overviewScrollBeforeComplete);

await noRecordPage.getByRole("button", { name: "返回", exact: true }).click();
const overviewLeaveDialog = noRecordPage.getByRole("alertdialog");
assert(await overviewLeaveDialog.getByRole("button", { name: "放弃更改", exact: true }).isVisible(), "问卷概览返回提示缺少放弃更改");
await overviewLeaveDialog.getByRole("button", { name: "继续编辑", exact: true }).click();
await noRecordPage.getByRole("button", { name: "保存问卷", exact: true }).waitFor();

await noRecordPage.getByRole("button", { name: "保存问卷", exact: true }).click();
await noRecordPage.locator("#toast", { hasText: "问卷已保存为" }).waitFor();
await noRecordPage.getByRole("heading", { name: "问卷概览", exact: true }).waitFor();
const savedToastPosition = await noRecordPage.evaluate(() => {
  const toast = document.querySelector("#toast").getBoundingClientRect();
  const footer = document.querySelector(".overview-footer").getBoundingClientRect();
  return { toastBottom: toast.bottom, footerTop: footer.top };
});
assert(savedToastPosition.toastBottom < savedToastPosition.footerTop, "问卷保存成功提示遮挡了底部操作按钮");
const noRecordData = await databaseSnapshot(noRecordPage);
assert(!noRecordData.templates.some((item) => item.key === emptySource.key), "无记录问卷编辑后仍保留旧的空模板");
const replaced = noRecordData.templates.find((item) => item.title === "无记录问卷修改测试");
assert(replaced?.id === emptySource.id && replaced.version === "1.1", "无记录问卷没有在同一身份下更新版本");
assert(replaced.fields.some((field) => field.label === "新增数字题" && field.type === "number"), "新增数字题没有按数字题型保存");
assert(replaced.fields.some((field) => field.id === "name" && field.type === "longText"), "已有问题的题型修改没有保存");
assert(noRecordData.settings.find((item) => item.key === "currentTemplateKey")?.value === replaced.key, "修改后的版本没有成为当前问卷");
await noRecordContext.close();

const recordedContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "zh-CN" });
const recordedPage = await recordedContext.newPage();
await recordedPage.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle" });
await recordedPage.evaluate(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("research-notebook", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise((resolve, reject) => {
    const transaction = db.transaction("records", "readwrite");
    transaction.objectStore("records").put({
      id: "existing-record",
      recordNumber: "R-EXISTING",
      templateKey: "ear-anthropometry-survey@1.2",
      answers: { preferenceReason: "旧版本答案" },
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z"
    });
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
});
await recordedPage.reload({ waitUntil: "networkidle" });
await recordedPage.locator('[data-action="templates"]').first().click();
await recordedPage.locator('[data-action="open-template"][data-key="ear-anthropometry-survey@1.2"]').click();
await recordedPage.getByRole("heading", { name: "问卷概览", exact: true }).waitFor();
const reasonCard = recordedPage.locator('[data-editor-field-id="preferenceReason"]');
const reasonContent = reasonCard.locator(".swipe-content");
const swipeResult = await reasonContent.evaluate((element) => {
  const scrollBefore = window.scrollY;
  element.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 31, pointerType: "touch", clientX: 320, clientY: 300, bubbles: true, cancelable: true }));
  const move = new PointerEvent("pointermove", { pointerId: 31, pointerType: "touch", clientX: 240, clientY: 303, bubbles: true, cancelable: true });
  element.dispatchEvent(move);
  element.dispatchEvent(new PointerEvent("pointerup", { pointerId: 31, pointerType: "touch", clientX: 240, clientY: 303, bubbles: true, cancelable: true }));
  return { prevented: move.defaultPrevented, scrollBefore, scrollAfter: window.scrollY };
});
await reasonCard.waitFor();
assert(swipeResult.prevented, "问题横向左滑时没有阻止页面纵向滚动");
assert(swipeResult.scrollAfter === swipeResult.scrollBefore, "问题横向左滑导致页面上下移动");
assert((await reasonCard.getAttribute("class")).includes("revealed"), "问题左滑后没有显示删除操作");
await recordedPage.locator(".template-overview-content").click({ position: { x: 2, y: 2 } });
assert(!(await reasonCard.getAttribute("class")).includes("revealed"), "点击左滑区域外的空白处没有收起删除操作");
await reasonContent.dispatchEvent("pointerdown", { pointerId: 32, pointerType: "touch", clientX: 320, clientY: 300 });
await reasonContent.dispatchEvent("pointermove", { pointerId: 32, pointerType: "touch", clientX: 240, clientY: 302 });
await reasonContent.dispatchEvent("pointerup", { pointerId: 32, pointerType: "touch", clientX: 240, clientY: 302 });
await reasonCard.locator('[data-action="delete-overview-question"]').click();
await confirm(recordedPage, "删除问题");
await recordedPage.getByRole("button", { name: "保存问卷", exact: true }).click();
await recordedPage.locator("#toast", { hasText: "问卷已保存为" }).waitFor();
await recordedPage.getByRole("heading", { name: "问卷概览", exact: true }).waitFor();
const recordedData = await databaseSnapshot(recordedPage);
const oldVersion = recordedData.templates.find((item) => item.key === "ear-anthropometry-survey@1.2");
const newVersion = recordedData.templates.find((item) => item.key === "ear-anthropometry-survey@1.3");
assert(oldVersion?.fields.some((field) => field.id === "preferenceReason"), "有记录问卷的旧版本问题被修改");
assert(!newVersion?.fields.some((field) => field.id === "preferenceReason"), "新版本没有删除指定问题");
assert(recordedData.records.some((item) => item.id === "existing-record" && item.templateKey === oldVersion.key && item.answers.preferenceReason === "旧版本答案"), "旧记录或旧答案被迁移或修改");
assert(!recordedData.records.some((item) => item.templateKey === newVersion.key), "旧记录被错误迁移到了新版本");

await recordedPage.locator('[data-action="leave-template-overview"]').click();
await recordedPage.getByRole("heading", { name: "问卷管理", exact: true }).waitFor();
await recordedPage.waitForTimeout(100);
await openHiddenAction(recordedPage, "duplicate-template", "ear-anthropometry-survey@1.3");
await recordedPage.getByRole("heading", { name: "问卷管理", exact: true }).waitFor();
const copyRow = recordedPage.locator('[data-action="open-template"]').filter({ hasText: "副本" }).first();
await copyRow.waitFor();
assert(await copyRow.count() === 1, "复制后没有在问卷管理页面生成副本");
await copyRow.click();
await recordedPage.getByRole("heading", { name: "问卷概览", exact: true }).waitFor();
assert(await recordedPage.getByText(/副本/, { exact: false }).count() > 0, "复制后的问卷不能从管理页进入概览");
const copiedData = await databaseSnapshot(recordedPage);
const copied = copiedData.templates.find((item) => item.title === "佩戴耳厚数据采集（副本）");
assert(copied && copied.id !== oldVersion.id && copied.version === "1.0", "复制问卷没有生成独立身份和V1.0版本");
assert(!copiedData.records.some((item) => item.templateKey === copied.key), "复制问卷错误地复制了记录");
assert(copied.analysis?.fields?.length === 2, "复制问卷没有保留简易分析设置");

await recordedPage.locator('[data-action="open-editor-meta"]').click();
await recordedPage.locator('[data-editor-template-description]').fill("第一行背景\n第二行背景");
await recordedPage.getByRole("button", { name: "完成", exact: true }).click();
await recordedPage.getByRole("button", { name: "另存为副本", exact: true }).click();
await recordedPage.locator("#toast", { hasText: "问卷已另存为副本" }).waitFor();
const savedCopyData = await databaseSnapshot(recordedPage);
const savedCopy = savedCopyData.templates.find((item) => item.title === "佩戴耳厚数据采集（副本）（副本）");
assert(savedCopy && savedCopy.id !== copied.id && savedCopy.version === "1.0", "另存为副本没有生成独立问卷身份");
assert(savedCopy.description === "第一行背景\n第二行背景", "另存为副本没有保留编辑后的多行背景");
assert(!savedCopyData.records.some((item) => item.templateKey === savedCopy.key), "另存为副本错误地复制了样本");
await recordedPage.locator('[data-action="leave-template-overview"]').click();
await recordedPage.getByRole("heading", { name: "问卷管理", exact: true }).waitFor();
await recordedPage.locator('[data-action="home"]').click();
const multilineBackground = recordedPage.locator(".hero-description");
assert(await multilineBackground.innerText() === "第一行背景\n第二行背景", "首页没有保留问卷背景换行");
assert(await multilineBackground.evaluate((element) => getComputedStyle(element).whiteSpace) === "pre-line", "首页问卷背景没有启用换行显示");
await recordedPage.locator('[data-action="templates"]').first().click();
await recordedPage.locator('[data-action="open-template"][data-key="ear-anthropometry-survey@1.2"]').click();
await recordedPage.getByRole("button", { name: "选择此问卷", exact: true }).click();
await recordedPage.getByText("1 份", { exact: true }).waitFor();
const oldCsvDownloadPromise = recordedPage.waitForEvent("download");
await recordedPage.locator('[data-action="export-xlsx"]').click();
const oldCsvDownload = await oldCsvDownloadPromise;
await oldCsvDownload.saveAs("test-results/editor-old-version.xlsx");
const oldWorkbook = await JSZip.loadAsync(await fs.readFile("test-results/editor-old-version.xlsx"));
const oldResponses = await oldWorkbook.file("xl/worksheets/sheet1.xml").async("string");
assert(oldResponses.includes("偏好原因") && oldResponses.includes("旧版本答案"), "旧版本Excel没有保留旧问题和旧答案");
assert(!oldResponses.includes("偏好原因（已删除）"), "旧版本Excel错误地把采集时有效的问题标成已删除");

await recordedContext.close();

console.log(JSON.stringify({ passed: true, scenarios: ["empty-template-replace", "recorded-template-versioning", "save-as-copy", "multiline-home-description", "copy-without-records", "long-press-reorder", "overview-swipe-delete", "swipe-outside-dismiss"] }, null, 2));
await browser.close();
