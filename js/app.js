import {
  deleteSetting,
  deleteDraft,
  deleteRecord,
  deleteTemplateCascade,
  exportDatabaseState,
  getDraft,
  getRecord,
  getRecords,
  getSetting,
  getTemplate,
  getTemplates,
  openDatabase,
  putDraft,
  putRecord,
  putTemplate,
  replaceEmptyTemplateVersion,
  replaceDatabaseState,
  setSetting
} from "./db.js?v=1.4.0";
import { ANALYSIS_PRESETS, DEFAULT_TEMPLATE, templateKey } from "./default-template.js?v=1.4.0";
import {
  EDITABLE_FIELD_TYPES,
  changeQuestionType,
  duplicateTemplate,
  fieldTypeName,
  makeQuestion,
  newOptionId,
  nextQuestionnaireVersion,
  questionUsesAnalysis,
  reorderFields
} from "./questionnaire-editor.js?v=1.4.0";
import { bindLongPressReorder } from "./question-reorder.js?v=1.4.0";
import { appendStrokePoint, blankImageRangeAnswer, imageRangeStrokes, pointOnImage, simplifyStrokePoints, strokePath } from "./image-range.js?v=1.4.0";
import { countImageRangeParticipants, paintHeatmap } from "./image-range-heatmap.js?v=1.4.0";
import { createXlsxBlob } from "./xlsx-export.js?v=1.4.0";
import { normalizeTemplateImport, validateTemplate } from "./questionnaire-schema.js?v=1.4.0";
import {
  DESCRIPTIVE_STATISTICS,
  descriptiveStatistics,
  fieldDistribution,
  formatStatistic,
  quantile,
  sampleStandardDeviation
} from "./statistics.js?v=1.4.0";

const APP_VERSION = "1.4.0";
const BACKUP_FORMAT = "research-notebook-backup";
const BACKUP_VERSION = 1;
const ICON_ARROW_LEFT = "./assets/arrow-left.svg";
const ICON_CHEVRON_RIGHT = "./assets/chevron-right.svg";
const ICON_TRASH = "./assets/trash.svg";
const ICON_COPY = "./assets/copy.svg";
const ICON_PLUS = "./assets/plus.svg";
const ANALYSIS_THEMES = {
  blue: { base: "#2b6ea8", fill: "rgba(43, 110, 168, 0.22)" },
  orange: { base: "#c66a2b", fill: "rgba(198, 106, 43, 0.22)" }
};
const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
const templateFileInput = document.querySelector("#template-file-input");
const backupFileInput = document.querySelector("#backup-file-input");
const updateDialog = document.querySelector("#update-dialog");
const updateTitle = document.querySelector("#update-title");
const updateSummary = document.querySelector("#update-summary");
const updateButton = document.querySelector("#update-button");
const updateSkip = document.querySelector("#update-skip");
const updateLater = document.querySelector("#update-later");
const confirmOverlay = document.querySelector("#confirm-overlay");
const confirmTitle = document.querySelector("#confirm-title");
const confirmMessage = document.querySelector("#confirm-message");
const confirmCancel = document.querySelector("#confirm-cancel");
const confirmSubmit = document.querySelector("#confirm-submit");

let confirmResolver = null;

const state = {
  view: "home",
  templates: [],
  currentTemplate: null,
  records: [],
  draft: null,
  selectedRecord: null,
  selectedTemplate: null,
  selectedTemplateDraft: null,
  editorTemplate: null,
  editorSourceKey: null,
  editorQuestionIndex: null,
  editorQuestionOriginal: null,
  editorQuestionWasNew: false,
  editorDirtyBeforeQuestion: false,
  editorDirty: false,
  editorOverviewScrollY: null,
  questionTypePickerOpen: false,
  questionTypePickerMode: null,
  editorReorderCleanup: null,
  formIndex: 0,
  templateCounts: {},
  waitingWorker: null,
  serviceWorkerRegistration: null,
  waitingWorkerInfo: null,
  dismissedUpdateVersion: null,
  deferredUpdate: null,
  toastTimer: null,
  actionBusy: false,
  analysisResizeObserver: null
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date).replaceAll("/", "-");
}

function compactDate(value = new Date()) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function showToast(message, duration = 2600, placement = "default") {
  clearTimeout(state.toastTimer);
  toast.textContent = message;
  toast.classList.toggle("toast-above-overview-footer", placement === "aboveOverviewFooter");
  toast.hidden = false;
  state.toastTimer = setTimeout(() => {
    toast.hidden = true;
    toast.classList.remove("toast-above-overview-footer");
  }, duration);
}

function closeConfirm(result) {
  if (!confirmResolver) return;
  const resolve = confirmResolver;
  confirmResolver = null;
  confirmOverlay.hidden = true;
  document.body.classList.remove("dialog-open");
  resolve(result);
}

function showConfirm({ title, message, confirmLabel = "确认", cancelLabel = "取消" }) {
  if (confirmResolver) closeConfirm(false);
  confirmTitle.textContent = title;
  confirmMessage.textContent = message;
  confirmCancel.textContent = cancelLabel;
  confirmSubmit.textContent = confirmLabel;
  confirmOverlay.hidden = false;
  document.body.classList.add("dialog-open");
  requestAnimationFrame(() => confirmCancel.focus());
  return new Promise((resolve) => {
    confirmResolver = resolve;
  });
}

function fatalError(error) {
  console.error(error);
  app.innerHTML = `
    <section class="fatal-error">
      <h1>工具暂时无法打开</h1>
      <p>${escapeHtml(error?.message || "发生未知错误")}</p>
      <button class="primary-button" type="button" onclick="location.reload()">重新打开</button>
    </section>`;
}

function analysisConfig(template) {
  if (!template) return null;
  return template.analysis || ANALYSIS_PRESETS[template.key] || null;
}

async function seedDefaultTemplate() {
  const wasSeeded = await getSetting("defaultTemplateSeeded", false);
  const seedRevision = await getSetting("builtInTemplateSeedRevision", wasSeeded ? 1 : 0);
  // Only a fresh, empty installation receives the revised ear-thickness sample.
  // Existing questionnaire versions, drafts, records, and selection stay intact.
  if (!wasSeeded && seedRevision === 0 && !(await getTemplates()).length) {
    const template = validateTemplate(DEFAULT_TEMPLATE);
    await putTemplate(template);
    if (!(await getSetting("currentTemplateKey", null))) await setSetting("currentTemplateKey", template.key);
  }

  let completedSeedRevision = seedRevision;
  if (seedRevision < 6) {
    try {
      const response = await fetch("./examples/ear-image-range-test.json");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const template = validateTemplate(await response.json());
      if (!(await getTemplate(template.key))) await putTemplate(template);
      completedSeedRevision = 6;
    } catch (error) {
      console.warn("图片标注示例问卷暂未载入；下次启动会重试", error);
    }
  }

  await setSetting("defaultTemplateSeeded", true);
  await setSetting("builtInTemplateSeedRevision", completedSeedRevision);
}

async function refreshContext() {
  state.templates = await getTemplates();
  let currentKey = await getSetting("currentTemplateKey", null);
  let current = currentKey ? await getTemplate(currentKey) : null;

  if (!current && state.templates.length) {
    current = state.templates[0];
    currentKey = current.key;
    await setSetting("currentTemplateKey", currentKey);
  }

  state.currentTemplate = current || null;
  if (state.currentTemplate) {
    [state.records, state.draft] = await Promise.all([
      getRecords(state.currentTemplate.key),
      getDraft(state.currentTemplate.key)
    ]);
  } else {
    state.records = [];
    state.draft = null;
  }
}

async function loadTemplateCounts() {
  const pairs = await Promise.all(state.templates.map(async (template) => [template.key, (await getRecords(template.key)).length]));
  state.templateCounts = Object.fromEntries(pairs);
}

function pageHeader(title, backAction = "home") {
  return `
    <header class="nav-top-bar">
      <button class="back-button" type="button" data-action="${escapeHtml(backAction)}" aria-label="返回">
        <img src="${ICON_ARROW_LEFT}" alt="" width="20" height="20" />
      </button>
      <h1>${escapeHtml(title)}</h1>
      <span class="nav-side" aria-hidden="true"></span>
    </header>`;
}

function render() {
  document.documentElement.classList.remove("annotation-page");
  state.analysisResizeObserver?.disconnect();
  state.analysisResizeObserver = null;
  state.editorReorderCleanup?.();
  state.editorReorderCleanup = null;
  switch (state.view) {
    case "templates": renderTemplates(); break;
    case "templateOverview": renderTemplateOverview(); break;
    case "templateMetaEditor": renderTemplateMetaEditor(); break;
    case "questionEditor": renderQuestionEditor(); break;
    case "records": renderRecords(); break;
    case "recordDetail": renderRecordDetail(); break;
    case "analysis": renderAnalysis(); break;
    case "form": renderForm(); break;
    case "backup": renderBackup(); break;
    default: renderHome();
  }
}

function restoreWindowScroll(top) {
  if (!Number.isFinite(top)) return;
  requestAnimationFrame(() => window.scrollTo({ top, left: 0, behavior: "auto" }));
}

function renderHome() {
  if (!state.currentTemplate) {
    app.innerHTML = `
      <section class="screen home-screen">
        <header class="app-header">
          <strong class="app-brand">AuNote</strong>
          <span class="app-version">V${APP_VERSION}</span>
        </header>
        <div class="home-content">
          <button class="hero" type="button" data-action="templates">
            <span class="hero-heading"><span class="eyebrow">当前问卷 / CURRENT</span><img src="${ICON_CHEVRON_RIGHT}" alt="" width="16" height="16" /></span>
            <span class="hero-title">尚未导入问卷</span>
            <span class="hero-version">点击进入问卷管理</span>
          </button>
          <div class="empty-state card"><p>请先导入一份问卷JSON，才能开始记录。</p></div>
          <button class="secondary-button" type="button" data-action="templates">进入问卷管理</button>
        </div>
        <footer class="home-footer">
          <button class="text-button" data-action="backup" type="button">数据备份/恢复</button>
          <button class="text-button" data-action="check-update" type="button">检查更新</button>
        </footer>
      </section>`;
    return;
  }

  const draftButtons = state.draft
    ? `<div class="draft-actions">
         <button class="primary-button" type="button" data-action="continue-draft">${state.draft.mode === "edit" ? "继续修改" : "继续填写"}</button>
         <button class="danger-button" type="button" data-action="discard-draft">废弃草稿</button>
       </div>`
    : `<button class="primary-button" type="button" data-action="start-form">开始填写</button>`;

  const heroEyebrow = state.draft
    ? '<span class="draft-label"><span class="draft-dot"></span>未完成草稿 / DRAFT</span>'
    : '<span class="eyebrow">当前问卷 / CURRENT</span>';
  const heroDetail = state.draft
    ? `<span class="hero-version hero-description">${escapeHtml(state.currentTemplate.description || "暂无背景信息")}</span><span class="hero-draft-detail">上次编辑：${escapeHtml(formatDateTime(state.draft.updatedAt))} · 已填写至第 ${Number(state.draft.currentIndex || 0) + 1} 项</span>`
    : `<span class="hero-version hero-description">${escapeHtml(state.currentTemplate.description || "暂无背景信息")}</span>`;
  const currentAnalysis = analysisConfig(state.currentTemplate);

  app.innerHTML = `
    <section class="screen home-screen">
      <header class="app-header">
        <strong class="app-brand">AuNote</strong>
        <span class="app-version">V${APP_VERSION}</span>
      </header>
      <div class="home-content">
        <button class="hero ${state.draft ? "has-draft" : ""}" type="button" data-action="templates">
          <span class="hero-heading">${heroEyebrow}<img src="${ICON_CHEVRON_RIGHT}" alt="" width="16" height="16" /></span>
          <span class="hero-title">${escapeHtml(state.currentTemplate.title)}</span>
          ${heroDetail}
        </button>
        <div class="home-list">
          <button class="count-link" type="button" data-action="records">
            <span>已记录样本</span>
            <span class="count-value">${state.records.length} 份</span>
            <img src="${ICON_CHEVRON_RIGHT}" alt="" width="16" height="16" />
          </button>
        </div>
        <div class="home-actions">
          ${draftButtons}
          ${currentAnalysis ? `<button class="secondary-button" type="button" data-action="analysis" ${state.records.length ? "" : "disabled"}>简易分析</button>` : ""}
          <button class="secondary-button" type="button" data-action="export-xlsx" ${state.records.length ? "" : "disabled"}>导出数据</button>
        </div>
      </div>
      <footer class="home-footer">
        <button class="text-button" data-action="backup" type="button">数据备份/恢复</button>
        <button class="text-button" data-action="check-update" type="button">检查更新</button>
      </footer>
    </section>`;
  if (state.deferredUpdate) queueMicrotask(() => showUpdate(state.deferredUpdate.worker, { info: state.deferredUpdate.info }));
}

function renderTemplates() {
  const items = state.templates.map((template) => {
    const isCurrent = template.key === state.currentTemplate?.key;
    const count = state.templateCounts[template.key] ?? 0;
    return `
      <div class="swipe-row" data-template-row="${escapeHtml(template.key)}">
        <div class="swipe-actions" aria-label="问卷操作">
          <button class="swipe-action swipe-copy" type="button" data-action="duplicate-template" data-key="${escapeHtml(template.key)}" aria-label="复制${escapeHtml(template.title)} V${escapeHtml(template.version)}"><img src="${ICON_COPY}" alt="" width="20" height="20" /></button>
          <button class="swipe-action swipe-delete" type="button" data-action="delete-template" data-key="${escapeHtml(template.key)}" aria-label="删除${escapeHtml(template.title)} V${escapeHtml(template.version)}"><img src="${ICON_TRASH}" alt="" width="20" height="20" /></button>
        </div>
        <button class="swipe-content" type="button" data-action="open-template" data-key="${escapeHtml(template.key)}">
          <span class="template-copy">
            <span class="template-name">${escapeHtml(template.title)} <small>V${escapeHtml(template.version)}</small></span>
            <span class="template-meta">${count}份记录 ${isCurrent ? '<span class="current-chip">当前</span>' : ""}</span>
          </span>
          <img class="row-chevron" src="${ICON_CHEVRON_RIGHT}" alt="" width="16" height="16" />
        </button>
      </div>`;
  }).join("");

  app.innerHTML = `
    <section class="screen template-screen">
      ${pageHeader("问卷管理")}
      <div class="page-content template-content">
        <div class="template-list">${items || '<div class="empty-state card">还没有问卷模板</div>'}</div>
        ${items ? '<p class="swipe-hint">提示：向左滑动问卷条目可复制或删除</p>' : ""}
      </div>
      <footer class="template-footer">
        <button class="secondary-button" type="button" data-action="import-template">导入问卷 JSON</button>
        <p>不同版本独立保存，导入不会覆盖已有数据</p>
      </footer>
    </section>`;
  bindSwipeRows();
}

function questionTypePickerHtml(mode) {
  const action = mode === "change" ? "change-editor-question-type" : "create-editor-question";
  return EDITABLE_FIELD_TYPES.map((item) => `<button type="button" data-action="${action}" data-type="${item.value}"><strong>${escapeHtml(item.label)}</strong><span>${item.value === "section" ? "只显示标题或说明，不采集答案" : "按这种格式填写和保存答案"}</span></button>`).join("");
}

function renderTemplateOverview() {
  const sourceTemplate = state.selectedTemplate;
  if (!sourceTemplate) {
    state.view = "templates";
    renderTemplates();
    return;
  }
  const editing = state.editorSourceKey === sourceTemplate.key && state.editorTemplate;
  const template = editing ? state.editorTemplate : sourceTemplate;
  const isCurrent = sourceTemplate.key === state.currentTemplate?.key;
  const count = state.templateCounts[sourceTemplate.key] ?? 0;
  const config = analysisConfig(template);
  let questionNumber = 0;
  const questions = template.fields.map((field, fieldIndex) => {
    const action = editing ? "open-editor-question" : "edit-template-question";
    const rowStart = `<div class="swipe-row overview-question-row" data-swipe-row data-swipe-offset="64" data-action="${action}" data-key="${escapeHtml(sourceTemplate.key)}" data-index="${fieldIndex}" data-editor-field-id="${escapeHtml(field.id)}">
      <div class="swipe-actions" aria-label="问题操作"><button class="swipe-action swipe-delete" type="button" data-action="delete-overview-question" data-key="${escapeHtml(sourceTemplate.key)}" data-index="${fieldIndex}" aria-label="删除${escapeHtml(field.label)}"><img src="${ICON_TRASH}" alt="" width="20" height="20" /></button></div>`;
    if (field.type === "section") {
      return `${rowStart}<button class="swipe-content overview-section overview-edit-target" type="button" aria-label="打开${escapeHtml(field.label)}进行编辑，长按可以调整顺序"><h3>${escapeHtml(field.label)}</h3>${field.description ? `<p>${escapeHtml(field.description)}</p>` : ""}</button></div>`;
    }
    questionNumber += 1;
    const options = ["singleChoice", "multiChoice"].includes(field.type)
      ? `<p class="overview-options">${field.options.map((option) => escapeHtml(option.label)).join(" · ")}</p>`
      : "";
    const repeat = field.type === "repeatedNumber" ? ` · 可填写${field.minEntries || 1}至${field.repeatCount}次` : "";
    return `${rowStart}
      <button class="swipe-content overview-question overview-edit-target" type="button" aria-label="打开${escapeHtml(field.label)}进行编辑，长按可以调整顺序">
        <div class="overview-question-heading"><span>Q${field.questionNumber || questionNumber}. ${escapeHtml(field.label)}</span><small>${field.required ? "必填" : "可跳过"}</small></div>
        <p class="overview-question-type">${escapeHtml(fieldTypeName(field.type))}${escapeHtml(repeat)}${field.unit ? ` · ${escapeHtml(field.unit)}` : ""}</p>
        ${field.description ? `<p>${escapeHtml(field.description)}</p>` : ""}
        ${options}
      </button></div>`;
  }).join("");
  const typePicker = state.questionTypePickerOpen && state.questionTypePickerMode === "add" ? `
    <div class="question-type-overlay" role="presentation">
      <section class="question-type-dialog" role="dialog" aria-modal="true" aria-labelledby="question-type-title">
        <div class="question-type-dialog-heading">
          <h2 id="question-type-title">选择问题类型</h2>
        </div>
        <div class="question-type-list">
          ${questionTypePickerHtml("add")}
        </div>
      </section>
    </div>` : "";

  app.innerHTML = `
    <section class="screen template-overview-screen">
      ${pageHeader("问卷概览", "leave-template-overview")}
      <div class="page-content template-overview-content">
        <div class="overview-summary">
          <button class="overview-summary-edit overview-edit-target" type="button" data-action="${editing ? "open-editor-meta" : "edit-template-meta"}" data-key="${escapeHtml(sourceTemplate.key)}" aria-label="打开问卷标题和背景信息进行编辑">
            <div class="overview-title-row"><h2>${escapeHtml(template.title)}</h2><span>V${escapeHtml(template.version)}</span></div>
            <p>${escapeHtml(template.description || "暂无背景信息")}</p>
          </button>
          <div class="overview-meta"><span>${count}份记录</span>${isCurrent ? '<span class="current-chip">当前问卷</span>' : ""}${config ? '<span class="analysis-chip">支持简易分析</span>' : ""}</div>
        </div>
        <div class="overview-question-list">${questions}</div>
        <button class="overview-add-question" type="button" data-action="open-question-type-picker" data-key="${escapeHtml(sourceTemplate.key)}" aria-label="增加问题"><img src="${ICON_PLUS}" alt="" width="22" height="22" /></button>
        ${state.editorDirty ? '<button class="editor-discard-link" type="button" data-action="discard-template-editor">放弃本次修改</button>' : ""}
        <button class="overview-delete-link" type="button" data-action="delete-template" data-key="${escapeHtml(sourceTemplate.key)}">删除此问卷</button>
      </div>
      <footer class="overview-footer ${state.editorDirty ? "overview-footer-actions" : ""}">
        ${state.editorDirty
          ? '<button class="primary-button" type="button" data-action="save-template-editor">保存问卷</button><button class="secondary-button" type="button" data-action="save-template-editor-copy">另存为副本</button>'
          : `<button class="primary-button" type="button" data-action="select-template" data-key="${escapeHtml(sourceTemplate.key)}">选择此问卷</button>`}
      </footer>
    </section>
    ${typePicker}`;
  const list = app.querySelector(".overview-question-list");
  if (editing && list) {
    state.editorReorderCleanup = bindLongPressReorder(list, {
      onReorder: async (orderedIds) => {
        const scrollTop = window.scrollY;
        state.editorTemplate.fields = reorderFields(state.editorTemplate.fields, orderedIds);
        state.editorDirty = true;
        render();
        restoreWindowScroll(scrollTop);
        await persistTemplateEditorDraft();
        showToast("问题顺序已调整");
      }
    });
  }
  bindSwipeRows();
}

function editorDraftSettingKey(key) {
  return `templateEditorDraft:${key}`;
}

async function persistTemplateEditorDraft() {
  if (!state.editorTemplate || !state.editorSourceKey) return;
  await setSetting(editorDraftSettingKey(state.editorSourceKey), {
    sourceKey: state.editorSourceKey,
    template: deepClone(state.editorTemplate),
    updatedAt: nowIso()
  });
}

function clearTemplateEditorState() {
  state.editorTemplate = null;
  state.editorSourceKey = null;
  state.editorQuestionIndex = null;
  state.editorQuestionOriginal = null;
  state.editorQuestionWasNew = false;
  state.editorDirtyBeforeQuestion = false;
  state.editorDirty = false;
  state.editorOverviewScrollY = null;
  state.questionTypePickerOpen = false;
  state.questionTypePickerMode = null;
}

async function beginTemplateEditor(key, destination = "templateOverview", questionIndex = null) {
  const template = await getTemplate(key);
  if (!template) return;
  const formDraft = await getDraft(key);
  if (formDraft) {
    showToast("这份问卷还有未完成草稿，请先完成或废弃草稿");
    return;
  }
  const saved = await getSetting(editorDraftSettingKey(key), null);
  const working = saved?.sourceKey === key && saved?.template ? deepClone(saved.template) : deepClone(template);
  const effectiveAnalysis = analysisConfig(template);
  if (!working.analysis && effectiveAnalysis) working.analysis = deepClone(effectiveAnalysis);
  state.editorTemplate = working;
  state.editorSourceKey = key;
  state.editorQuestionIndex = questionIndex;
  state.editorDirty = Boolean(saved);
  state.view = destination;
  render();
}

async function duplicateQuestionnaire(key) {
  const source = await getTemplate(key);
  if (!source) return;
  const copy = validateTemplate(duplicateTemplate(source, analysisConfig(source)));
  await putTemplate(copy);
  await refreshContext();
  await loadTemplateCounts();
  state.view = "templates";
  renderTemplates();
  showToast("已建立问卷副本，不包含记录和填写草稿");
}

function renderTemplateMetaEditor() {
  const template = state.editorTemplate;
  if (!template) return beginTemplateEditor(state.editorSourceKey || "");
  app.innerHTML = `
    <section class="screen editor-form-screen">
      ${pageHeader("问卷信息", "editor-overview")}
      <div class="page-content editor-form-content" data-editor-meta-form>
        <label class="editor-field"><span>问卷标题</span><input type="text" data-editor-template-title value="${escapeHtml(template.title)}" autocomplete="off" /></label>
        <label class="editor-field"><span>背景信息</span><textarea data-editor-template-description rows="7" placeholder="说明研究背景、对象或测试产品">${escapeHtml(template.description || "")}</textarea></label>
        <p class="editor-help">背景信息会显示在首页，内容过长时首页只显示前几行，问卷概览会显示完整内容。</p>
      </div>
      <footer class="editor-form-footer"><button class="primary-button" type="button" data-action="editor-overview">完成</button></footer>
    </section>`;
}

function optionEditorHtml(field) {
  return (field.options || []).map((option, index) => `
    <div class="editor-option-card" data-editor-option="${index}">
      <div class="editor-option-heading">
        <label class="editor-field compact"><span>选项${index + 1}</span><input type="text" data-option-label value="${escapeHtml(option.label)}" /></label>
        <button type="button" class="editor-remove-option" data-action="remove-editor-option" data-index="${index}" aria-label="删除选项${index + 1}">删除</button>
      </div>
      <label class="editor-check"><input type="checkbox" data-option-text-input ${option.textInput ? "checked" : ""} />选择后允许补充文字</label>
      <div class="editor-option-text-config ${option.textInput ? "" : "is-disabled"}">
        <label class="editor-field compact"><span>补充文字标题</span><input type="text" data-option-text-label value="${escapeHtml(option.textInput?.label || "请说明")}" ${option.textInput ? "" : "disabled"} /></label>
        <label class="editor-field compact"><span>输入提示</span><input type="text" data-option-text-placeholder value="${escapeHtml(option.textInput?.placeholder || "请输入具体情况")}" ${option.textInput ? "" : "disabled"} /></label>
        <label class="editor-check"><input type="checkbox" data-option-text-required ${option.textInput?.required !== false ? "checked" : ""} ${option.textInput ? "" : "disabled"} />选择后必须填写补充文字</label>
      </div>
      ${field.type === "multiChoice" ? `<label class="editor-check"><input type="checkbox" data-option-exclusive ${option.exclusive ? "checked" : ""} />与其他选项互斥</label>` : ""}
    </div>`).join("");
}

function ratingLabelsHtml(field) {
  const min = Number.isInteger(field.min) ? field.min : 1;
  const max = Number.isInteger(field.max) ? field.max : 5;
  return Array.from({ length: Math.max(0, Math.min(10, max - min + 1)) }, (_, offset) => {
    const value = min + offset;
    const item = field.labels?.[String(value)] || {};
    return `<div class="editor-rating-row"><strong>${value}分</strong><input type="text" data-rating-short="${value}" value="${escapeHtml(item.short || "")}" placeholder="简短名称" /><textarea rows="2" data-rating-help="${value}" placeholder="帮助理解的说明">${escapeHtml(item.help || "")}</textarea></div>`;
  }).join("");
}

function questionSpecificEditorHtml(field) {
  if (["shortText", "longText"].includes(field.type)) {
    return `
      <label class="editor-field"><span>输入提示</span><input type="text" data-field-placeholder value="${escapeHtml(field.placeholder || "")}" /></label>
      ${field.type === "shortText" ? `<label class="editor-check"><input type="checkbox" data-field-anonymous ${field.allowAnonymous ? "checked" : ""} />允许匿名记录</label>` : ""}`;
  }
  if (field.type === "number") {
    return `
      <div class="editor-two-columns">
        <label class="editor-field"><span>单位</span><input type="text" data-field-unit value="${escapeHtml(field.unit || "")}" /></label>
        <label class="editor-field"><span>输入提示</span><input type="text" data-field-placeholder value="${escapeHtml(field.placeholder || "")}" /></label>
      </div>
      <label class="editor-check"><input type="checkbox" data-field-integer ${field.integer ? "checked" : ""} />只允许整数</label>`;
  }
  if (field.type === "repeatedNumber") {
    return `
      <div class="editor-two-columns">
        <label class="editor-field"><span>最多填写次数</span><input type="number" min="2" max="10" inputmode="numeric" data-field-repeat-count value="${field.repeatCount || 3}" /></label>
        <label class="editor-field"><span>最少填写数量</span><input type="number" min="0" max="10" inputmode="numeric" data-field-min-entries value="${field.minEntries ?? 1}" /></label>
      </div>
      <div class="editor-two-columns">
        <label class="editor-field"><span>单位</span><input type="text" data-field-unit value="${escapeHtml(field.unit || "")}" /></label>
        <label class="editor-field"><span>输入提示</span><input type="text" data-field-placeholder value="${escapeHtml(field.placeholder || "")}" /></label>
      </div>`;
  }
  if (["singleChoice", "multiChoice"].includes(field.type)) {
    return `<div class="editor-options"><h3>选项</h3>${optionEditorHtml(field)}<button class="secondary-button editor-add-option" type="button" data-action="add-editor-option">增加选项</button></div>`;
  }
  if (field.type === "rating") {
    return `
      <div class="editor-two-columns">
        <label class="editor-field"><span>最低分</span><input type="number" min="0" max="9" inputmode="numeric" data-field-rating-min value="${field.min ?? 1}" /></label>
        <label class="editor-field"><span>最高分</span><input type="number" min="1" max="10" inputmode="numeric" data-field-rating-max value="${field.max ?? 5}" /></label>
      </div>
      <label class="editor-check"><input type="checkbox" data-field-rating-unknown ${field.unknownOption ? "checked" : ""} />提供“无法判断”选项</label>
      <label class="editor-field"><span>无法判断选项名称</span><input type="text" data-field-rating-unknown-label value="${escapeHtml(field.unknownOption?.label || "无法判断")}" /></label>
      <div class="editor-rating-labels"><h3>每档说明</h3>${ratingLabelsHtml(field)}</div>`;
  }
  if (field.type === "section") return "";
  return '<p class="editor-locked-notice">这是专用交互题。可以随整份问卷复制或调整顺序，但不能用通用编辑器修改内部内容。</p>';
}

function renderQuestionEditor() {
  const field = state.editorTemplate?.fields?.[state.editorQuestionIndex];
  if (!field) {
    state.view = "templateOverview";
    render();
    return;
  }
  const editable = EDITABLE_FIELD_TYPES.some((item) => item.value === field.type);
  const typePicker = state.questionTypePickerOpen && state.questionTypePickerMode === "change" ? `
    <div class="editor-type-popover" role="dialog" aria-label="选择问题类型">
      <div class="editor-type-popover-heading"><strong>选择问题类型</strong></div>
      <div class="question-type-list">${questionTypePickerHtml("change")}</div>
    </div>` : "";
  app.innerHTML = `
    <section class="screen editor-form-screen">
      ${pageHeader("编辑问题", "leave-question-editor")}
      <div class="page-content editor-form-content" data-editor-question-form>
        <div class="editor-type-anchor">
          <button class="editor-type-label" type="button" data-action="open-question-type-picker" data-mode="change" ${editable ? "" : "disabled"}>
            <span>题型</span><strong>${escapeHtml(fieldTypeName(field.type))}<small aria-hidden="true">›</small></strong>
          </button>
          ${typePicker}
        </div>
        ${editable ? `
          <label class="editor-field"><span>${field.type === "section" ? "标题" : "问题"}</span><input type="text" data-field-label value="${escapeHtml(field.label)}" /></label>
          <label class="editor-field"><span>${field.type === "section" ? "备注" : "补充说明"}</span><textarea rows="4" data-field-description>${escapeHtml(field.description || "")}</textarea></label>
          ${field.type === "section" ? "" : `<label class="editor-check"><input type="checkbox" data-field-required ${field.required ? "checked" : ""} />必填问题</label>`}
          ${questionSpecificEditorHtml(field)}
          ${field.image?.src ? '<p class="editor-help">这道题包含现有图片。图片会被保留，当前编辑器暂不支持替换图片。</p>' : ""}
        ` : questionSpecificEditorHtml(field)}
        <button class="editor-delete-question" type="button" data-action="delete-editor-question">删除该问题</button>
      </div>
      <footer class="editor-form-footer"><button class="primary-button" type="button" data-action="editor-overview">完成</button></footer>
    </section>`;
}

function captureTemplateMetaEditor() {
  if (!state.editorTemplate || state.view !== "templateMetaEditor") return;
  state.editorTemplate.title = app.querySelector("[data-editor-template-title]")?.value || "";
  state.editorTemplate.description = app.querySelector("[data-editor-template-description]")?.value || "";
  state.editorDirty = true;
}

function captureQuestionEditor() {
  const field = state.editorTemplate?.fields?.[state.editorQuestionIndex];
  if (!field || state.view !== "questionEditor") return;
  const value = (selector) => app.querySelector(selector)?.value ?? "";
  const checked = (selector) => Boolean(app.querySelector(selector)?.checked);
  if (app.querySelector("[data-field-label]")) field.label = value("[data-field-label]");
  if (app.querySelector("[data-field-description]")) field.description = value("[data-field-description]");
  if (field.type !== "section" && app.querySelector("[data-field-required]")) field.required = checked("[data-field-required]");
  if (app.querySelector("[data-field-placeholder]")) field.placeholder = value("[data-field-placeholder]");
  if (app.querySelector("[data-field-unit]")) field.unit = value("[data-field-unit]");
  if (field.type === "shortText") field.allowAnonymous = checked("[data-field-anonymous]");
  if (field.type === "number") field.integer = checked("[data-field-integer]");
  if (field.type === "repeatedNumber") {
    field.repeatCount = Number(value("[data-field-repeat-count]"));
    field.minEntries = Number(value("[data-field-min-entries]"));
  }
  if (["singleChoice", "multiChoice"].includes(field.type)) {
    field.options = [...app.querySelectorAll("[data-editor-option]")].map((element, index) => {
      const previous = field.options[index] || { id: newOptionId(field) };
      const option = { ...previous, label: element.querySelector("[data-option-label]")?.value || "" };
      if (element.querySelector("[data-option-text-input]")?.checked) {
        option.textInput = {
          ...(option.textInput || {}),
          label: element.querySelector("[data-option-text-label]")?.value || "请说明",
          placeholder: element.querySelector("[data-option-text-placeholder]")?.value || "请输入具体情况",
          required: Boolean(element.querySelector("[data-option-text-required]")?.checked)
        };
      } else delete option.textInput;
      if (field.type === "multiChoice" && element.querySelector("[data-option-exclusive]")?.checked) option.exclusive = true;
      else delete option.exclusive;
      return option;
    });
  }
  if (field.type === "rating") {
    field.min = Number(value("[data-field-rating-min]"));
    field.max = Number(value("[data-field-rating-max]"));
    if (checked("[data-field-rating-unknown]")) {
      field.unknownOption = field.unknownOption || { id: "unknown", label: "无法判断" };
      field.unknownOption.label = value("[data-field-rating-unknown-label]") || "无法判断";
    } else delete field.unknownOption;
    field.labels = field.labels || {};
    app.querySelectorAll("[data-rating-short]").forEach((input) => {
      const score = input.dataset.ratingShort;
      field.labels[score] = field.labels[score] || {};
      field.labels[score].short = input.value;
    });
    app.querySelectorAll("[data-rating-help]").forEach((input) => {
      const score = input.dataset.ratingHelp;
      field.labels[score] = field.labels[score] || {};
      field.labels[score].help = input.value;
    });
  }
  state.editorDirty = true;
}

async function editorOverview() {
  let overviewScrollY = null;
  if (state.view === "questionEditor") {
    overviewScrollY = state.editorOverviewScrollY;
    captureQuestionEditor();
    const changed = state.editorQuestionWasNew || JSON.stringify(state.editorTemplate.fields[state.editorQuestionIndex]) !== JSON.stringify(state.editorQuestionOriginal);
    state.editorDirty = state.editorDirtyBeforeQuestion || changed;
    if (changed) await persistTemplateEditorDraft();
    resetQuestionEditSession();
  } else {
    captureTemplateMetaEditor();
    await persistTemplateEditorDraft();
  }
  state.view = "templateOverview";
  render();
  state.editorOverviewScrollY = null;
  restoreWindowScroll(overviewScrollY);
}

function resetQuestionEditSession() {
  state.editorQuestionIndex = null;
  state.editorQuestionOriginal = null;
  state.editorQuestionWasNew = false;
  state.editorDirtyBeforeQuestion = false;
  state.questionTypePickerOpen = false;
  state.questionTypePickerMode = null;
}

async function saveTemplateEditor() {
  if (!state.editorTemplate || !state.editorSourceKey) return;
  const source = await getTemplate(state.editorSourceKey);
  if (!source) throw new Error("原问卷已经不存在");
  const formDraft = await getDraft(source.key);
  if (formDraft) throw new Error("问卷出现了未完成草稿，请先处理草稿后再保存修改");
  const existing = await getTemplates();
  let version = nextQuestionnaireVersion(source.version);
  const usedKeys = new Set(existing.map((template) => template.key));
  while (usedKeys.has(`${source.id}@${version}`)) version = nextQuestionnaireVersion(version);
  const candidate = validateTemplate({
    ...deepClone(state.editorTemplate),
    id: source.id,
    version,
    importedAt: nowIso()
  });
  const records = await getRecords(source.key);
  if (!records.length) {
    try {
      await replaceEmptyTemplateVersion(source.key, candidate);
    } catch (error) {
      if (!String(error?.message || "").includes("编辑期间新增")) throw error;
      await putTemplate(candidate);
      await setSetting("currentTemplateKey", candidate.key);
    }
  } else {
    await putTemplate(candidate);
    await setSetting("currentTemplateKey", candidate.key);
  }
  await deleteSetting(editorDraftSettingKey(source.key));
  clearTemplateEditorState();
  await refreshContext();
  await loadTemplateCounts();
  await openTemplateOverview(candidate.key);
  showToast(`问卷已保存为 V${candidate.version}，并设为当前问卷`, 2600, "aboveOverviewFooter");
}

async function saveTemplateEditorCopy() {
  if (!state.editorTemplate || !state.editorSourceKey) return;
  const source = await getTemplate(state.editorSourceKey);
  if (!source) throw new Error("原问卷已经不存在");
  const candidate = validateTemplate({
    ...duplicateTemplate(state.editorTemplate, analysisConfig(state.editorTemplate)),
    importedAt: nowIso()
  });
  await putTemplate(candidate);
  await setSetting("currentTemplateKey", candidate.key);
  await deleteSetting(editorDraftSettingKey(source.key));
  clearTemplateEditorState();
  await refreshContext();
  await loadTemplateCounts();
  await openTemplateOverview(candidate.key);
  showToast("问卷已另存为副本，并设为当前问卷", 2600, "aboveOverviewFooter");
}

async function discardTemplateEditor() {
  if (!state.editorSourceKey) return;
  const confirmed = await showConfirm({ title: "放弃问卷修改？", message: "尚未保存为正式版本的问卷修改将被删除。", confirmLabel: "放弃修改" });
  if (!confirmed) return;
  const sourceKey = state.editorSourceKey;
  await deleteSetting(editorDraftSettingKey(sourceKey));
  clearTemplateEditorState();
  await openTemplateOverview(sourceKey);
}

async function leaveTemplateEditor() {
  captureTemplateMetaEditor();
  captureQuestionEditor();
  await persistTemplateEditorDraft();
  const sourceKey = state.editorSourceKey;
  clearTemplateEditorState();
  await openTemplateOverview(sourceKey);
  showToast("问卷修改草稿已保存");
}

async function leaveTemplateOverview() {
  if (!state.editorDirty) {
    clearTemplateEditorState();
    state.view = "templates";
    renderTemplates();
    return;
  }
  const confirmed = await showConfirm({
    title: "问卷修改尚未保存",
    message: "返回问卷管理将放弃这次对问卷的全部修改。",
    confirmLabel: "放弃更改",
    cancelLabel: "继续编辑"
  });
  if (!confirmed) return;
  await deleteSetting(editorDraftSettingKey(state.editorSourceKey));
  clearTemplateEditorState();
  state.view = "templates";
  renderTemplates();
}

async function leaveQuestionEditor() {
  const index = state.editorQuestionIndex;
  if (!state.editorTemplate?.fields?.[index]) return;
  captureQuestionEditor();
  const changed = state.editorQuestionWasNew || JSON.stringify(state.editorTemplate.fields[index]) !== JSON.stringify(state.editorQuestionOriginal);
  if (changed) {
    const confirmed = await showConfirm({
      title: "问题编辑尚未保存",
      message: "返回问卷概览将放弃这次对该问题的修改。",
      confirmLabel: "放弃更改",
      cancelLabel: "继续编辑"
    });
    if (!confirmed) return;
    if (state.editorQuestionWasNew) state.editorTemplate.fields.splice(index, 1);
    else state.editorTemplate.fields[index] = deepClone(state.editorQuestionOriginal);
    state.editorDirty = state.editorDirtyBeforeQuestion;
    if (state.editorDirty) await persistTemplateEditorDraft();
    else await deleteSetting(editorDraftSettingKey(state.editorSourceKey));
  } else {
    state.editorDirty = state.editorDirtyBeforeQuestion;
  }
  const overviewScrollY = state.editorOverviewScrollY;
  resetQuestionEditSession();
  state.view = "templateOverview";
  render();
  state.editorOverviewScrollY = null;
  restoreWindowScroll(overviewScrollY);
}

async function openEditorQuestion(index, isNew = false) {
  const numericIndex = Number(index);
  if (!state.editorTemplate?.fields?.[numericIndex]) return;
  if (state.view === "templateOverview") state.editorOverviewScrollY = window.scrollY;
  state.editorQuestionIndex = numericIndex;
  state.editorQuestionOriginal = isNew ? null : deepClone(state.editorTemplate.fields[numericIndex]);
  state.editorQuestionWasNew = isNew;
  state.editorDirtyBeforeQuestion = state.editorDirty;
  state.questionTypePickerOpen = false;
  state.questionTypePickerMode = null;
  state.view = "questionEditor";
  render();
  requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "auto" }));
}

async function openQuestionTypePicker(key = null, mode = "add") {
  if (!state.editorTemplate && key) await beginTemplateEditor(key);
  if (!state.editorTemplate) return;
  state.questionTypePickerOpen = true;
  state.questionTypePickerMode = mode;
  state.view = mode === "change" ? "questionEditor" : "templateOverview";
  render();
}

function closeQuestionTypePicker() {
  state.questionTypePickerOpen = false;
  state.questionTypePickerMode = null;
  app.querySelector(".question-type-overlay, .editor-type-popover")?.remove();
}

async function createEditorQuestion(type) {
  if (!state.editorTemplate || !EDITABLE_FIELD_TYPES.some((item) => item.value === type)) return;
  state.questionTypePickerOpen = false;
  state.questionTypePickerMode = null;
  const field = makeQuestion(type, state.editorTemplate.fields);
  state.editorTemplate.fields.push(field);
  await openEditorQuestion(state.editorTemplate.fields.length - 1, true);
}

async function changeEditorQuestionType(type) {
  const index = state.editorQuestionIndex;
  const field = state.editorTemplate?.fields?.[index];
  if (!field || !EDITABLE_FIELD_TYPES.some((item) => item.value === type)) return;
  if (field.type === type) {
    state.questionTypePickerOpen = false;
    state.questionTypePickerMode = null;
    renderQuestionEditor();
    return;
  }
  if (questionUsesAnalysis(state.editorTemplate, field.id)) {
    showToast("这个问题用于简易分析，不能更换题型");
    return;
  }
  const confirmed = await showConfirm({
    title: "更换问题类型？",
    message: `将“${fieldTypeName(field.type)}”改为“${fieldTypeName(type)}”后，原题型的选项、单位或评分设置会被重置。问题名称和说明会保留。`,
    confirmLabel: "更换题型"
  });
  if (!confirmed) return;
  captureQuestionEditor();
  state.editorTemplate.fields[index] = changeQuestionType(field, type, state.editorTemplate.fields);
  if (type === "section" && state.editorTemplate.recordLabelField === field.id) delete state.editorTemplate.recordLabelField;
  state.questionTypePickerOpen = false;
  state.questionTypePickerMode = null;
  render();
  showToast(`已改为${fieldTypeName(type)}`);
}

async function addEditorOption() {
  captureQuestionEditor();
  const field = state.editorTemplate?.fields?.[state.editorQuestionIndex];
  if (!field || !["singleChoice", "multiChoice"].includes(field.type)) return;
  field.options.push({ id: newOptionId(field), label: `选项${field.options.length + 1}` });
  renderQuestionEditor();
}

async function removeEditorOption(index) {
  captureQuestionEditor();
  const field = state.editorTemplate?.fields?.[state.editorQuestionIndex];
  if (!field || !Array.isArray(field.options)) return;
  if (field.options.length <= 1) {
    showToast("选择题至少需要保留一个选项");
    return;
  }
  field.options.splice(Number(index), 1);
  renderQuestionEditor();
}

async function deleteOverviewQuestion(key, index) {
  const scrollTop = window.scrollY;
  if (state.editorSourceKey !== key || !state.editorTemplate) await beginTemplateEditor(key);
  if (state.editorSourceKey !== key || !state.editorTemplate) return;
  const fieldIndex = Number(index);
  const field = state.editorTemplate.fields[fieldIndex];
  if (!field) return;
  if (state.editorTemplate.fields.length <= 1) {
    showToast("问卷至少需要保留一个问题或说明");
    return;
  }
  if (questionUsesAnalysis(state.editorTemplate, field.id)) {
    showToast("这个问题用于简易分析，当前版本不能删除");
    return;
  }
  const confirmed = await showConfirm({
    title: "删除该问题？",
    message: `“${field.label}”将不会出现在修改后的问卷中。已有记录所属的旧版本不会改变。`,
    confirmLabel: "删除问题"
  });
  if (!confirmed) return;
  if (state.editorTemplate.recordLabelField === field.id) delete state.editorTemplate.recordLabelField;
  state.editorTemplate.fields.splice(fieldIndex, 1);
  state.editorDirty = true;
  await persistTemplateEditorDraft();
  state.view = "templateOverview";
  render();
  restoreWindowScroll(scrollTop);
  showToast("问题已从修改稿中删除");
}

async function deleteEditorQuestion() {
  const field = state.editorTemplate?.fields?.[state.editorQuestionIndex];
  if (!field) return;
  if (state.editorTemplate.fields.length <= 1) {
    showToast("问卷至少需要保留一个问题或说明");
    return;
  }
  if (questionUsesAnalysis(state.editorTemplate, field.id)) {
    showToast("这个问题用于简易分析，当前版本不能删除");
    return;
  }
  const confirmed = await showConfirm({
    title: "删除该问题？",
    message: `“${field.label}”将不会出现在修改后的问卷中。已有记录所属的旧版本不会改变。`,
    confirmLabel: "删除问题"
  });
  if (!confirmed) return;
  if (state.editorTemplate.recordLabelField === field.id) delete state.editorTemplate.recordLabelField;
  state.editorTemplate.fields.splice(state.editorQuestionIndex, 1);
  state.editorDirty = true;
  await persistTemplateEditorDraft();
  resetQuestionEditSession();
  state.view = "templateOverview";
  render();
  showToast("问题已从修改稿中删除");
}

function recordName(record) {
  const fields = state.currentTemplate?.fields || [];
  const configuredId = state.currentTemplate?.recordLabelField;
  const field = fields.find((item) => item.id === configuredId)
    || fields.find((item) => item.id === "name")
    || fields.find((item) => item.type === "shortText" && /姓名|name/i.test(`${item.id} ${item.label}`))
    || fields.find((item) => item.type === "shortText");
  const value = field ? formatAnswer(field, record.answers[field.id], { forList: true }) : "";
  return value || "未填写姓名";
}

function simpleAnswer(record, fieldId) {
  const field = state.currentTemplate?.fields.find((item) => item.id === fieldId);
  return field ? formatAnswer(field, record.answers[fieldId], { forList: true }) : "";
}

function renderRecords() {
  const records = state.records.map((record) => `
    <div class="swipe-row record-swipe-row" data-swipe-row data-record-row="${escapeHtml(record.id)}" data-swipe-offset="64">
      <div class="swipe-actions" aria-label="样本操作">
        <button class="swipe-action swipe-delete" type="button" data-action="delete-record-by-id" data-id="${escapeHtml(record.id)}" aria-label="删除${escapeHtml(recordName(record))}"><img src="${ICON_TRASH}" alt="" width="20" height="20" /></button>
      </div>
      <button class="swipe-content record-card" type="button" data-action="open-record" data-id="${escapeHtml(record.id)}">
        <span class="record-copy">
          <span class="record-card-main">
            <span class="record-name">${escapeHtml(recordName(record))}</span>
            <span class="record-demographics">${escapeHtml([simpleAnswer(record, "gender"), simpleAnswer(record, "age") ? `${simpleAnswer(record, "age")}岁` : ""].filter(Boolean).join(" / "))}</span>
          </span>
          <span class="record-times">
            <span>首次保存 ${escapeHtml(formatDateTime(record.createdAt))}</span>
            <span class="record-updated">最后修改 ${escapeHtml(formatDateTime(record.updatedAt))}</span>
          </span>
        </span>
        <img class="row-chevron" src="${ICON_CHEVRON_RIGHT}" alt="" width="16" height="16" />
      </button>
    </div>`).join("");

  app.innerHTML = `
    <section class="screen">
      ${pageHeader("已记录样本")}
      <div class="page-content records-content">
        <p class="section-title">${escapeHtml(state.currentTemplate?.title || "")} · 最早记录在上</p>
        <div class="record-list">${records || '<div class="empty-state card">还没有已记录样本</div>'}</div>
        ${records ? '<p class="swipe-hint">提示：向左滑动样本可删除</p>' : ""}
      </div>
    </section>`;
  bindSwipeRows();
}

function renderRecordDetail() {
  const record = state.selectedRecord;
  if (!record) {
    state.view = "records";
    renderRecords();
    return;
  }

  let displayIndex = 0;
  const rows = state.currentTemplate.fields.map((field, fieldIndex) => {
    if (field.type === "section") return "";
    displayIndex += 1;
    return `
      <button class="detail-row" type="button" data-action="edit-record-at" data-field-index="${fieldIndex}" aria-label="编辑${escapeHtml(field.label)}">
        <span class="detail-row-copy">
          <span class="detail-label">${field.questionNumber || displayIndex}. ${escapeHtml(field.label)}</span>
          <span class="detail-value">${escapeHtml(formatAnswer(field, record.answers[field.id]) || "未填写")}</span>
        </span>
        <img class="row-chevron" src="${ICON_CHEVRON_RIGHT}" alt="" width="16" height="16" />
      </button>`;
  }).join("");

  app.innerHTML = `
    <section class="screen">
      ${pageHeader("记录详情", "records")}
      <div class="page-content detail-content">
        <div class="record-meta">
          <span>记录 ${escapeHtml(record.recordNumber)}</span>
          <span>首次保存 ${escapeHtml(formatDateTime(record.createdAt))}</span>
          <span>最后修改 ${escapeHtml(formatDateTime(record.updatedAt))}</span>
        </div>
        <div class="card detail-grid">${rows}</div>
      </div>
      <div class="detail-actions">
        <button class="danger-button" type="button" data-action="delete-record">删除记录</button>
      </div>
    </section>`;
}

function getFieldAnswer(field) {
  return state.draft?.answers?.[field.id];
}

function renderTextField(field, answer, long = false, fieldIndex = state.formIndex) {
  const data = field.allowAnonymous && typeof answer === "object" ? answer : { value: answer ?? "", anonymous: false };
  const input = long
    ? `<textarea class="textarea-input" data-field-input autocomplete="off" placeholder="${escapeHtml(field.placeholder || "")}">${escapeHtml(data.value || "")}</textarea>`
    : `<input class="text-input" data-field-input type="text" inputmode="text" autocomplete="off" value="${escapeHtml(data.value || "")}" placeholder="${escapeHtml(field.placeholder || "")}" ${data.anonymous ? "disabled" : ""} />`;
  const anonymous = field.allowAnonymous
    ? `<label class="anonymous-row"><input type="checkbox" data-anonymous data-field-index="${fieldIndex}" ${data.anonymous ? "checked" : ""} /><span>${escapeHtml(field.anonymousLabel || "匿名")}</span></label>`
    : "";
  return `<div class="field-wrap">${input}${anonymous}</div>`;
}

function renderNumberField(field, answer) {
  return `
    <div class="input-with-unit">
      <input class="number-input" data-field-input type="text" inputmode="${field.integer ? "numeric" : "decimal"}" autocomplete="off" value="${escapeHtml(answer ?? "")}" placeholder="${escapeHtml(field.placeholder || "")}" />
      ${field.unit ? `<span class="unit-label">${escapeHtml(field.unit)}</span>` : ""}
    </div>`;
}

function validRepeatedValues(answer) {
  return (Array.isArray(answer) ? answer : [])
    .map((value) => String(value ?? "").trim())
    .filter((value) => /^(?:\d+|\d*\.\d+)$/.test(value));
}

function parseDecimal(value) {
  const [whole, fraction = ""] = String(value).split(".");
  return { integer: BigInt(`${whole || "0"}${fraction}`), scale: fraction.length };
}

function formatScaledInteger(integer, scale) {
  const negative = integer < 0n;
  let digits = String(negative ? -integer : integer).padStart(scale + 1, "0");
  if (scale) {
    digits = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/0+$/, "").replace(/\.$/, "");
  }
  if (!digits) digits = "0";
  return `${negative ? "-" : ""}${digits}`;
}

function repeatedStats(answer) {
  const values = validRepeatedValues(answer);
  if (!values.length) return { count: 0, mean: "", range: "" };
  const parsed = values.map(parseDecimal);
  const scale = Math.max(...parsed.map((value) => value.scale));
  const scaled = parsed.map((value) => value.integer * (10n ** BigInt(scale - value.scale)));
  const sum = scaled.reduce((total, value) => total + value, 0n);

  let mean;
  if (values.length === 1) {
    mean = formatScaledInteger(sum, scale);
  } else {
    const extraScale = 4;
    const divisor = BigInt(values.length);
    const scaledSum = sum * (10n ** BigInt(extraScale));
    let quotient = scaledSum / divisor;
    const remainder = scaledSum % divisor;
    if (remainder * 2n >= divisor) quotient += 1n;
    mean = formatScaledInteger(quotient, scale + extraScale);
  }

  const range = values.length > 1
    ? formatScaledInteger(scaled.reduce((max, value) => value > max ? value : max) - scaled.reduce((min, value) => value < min ? value : min), scale)
    : "";
  return { count: values.length, mean, range };
}

function repeatedSummaryHtml(field, answer) {
  const stats = repeatedStats(answer);
  if (!stats.count) return "";
  const unit = field.unit ? ` ${escapeHtml(field.unit)}` : "";
  const parts = [`平均值：${escapeHtml(stats.mean)}${unit}`];
  if (stats.range) parts.push(`最大差值：${escapeHtml(stats.range)}${unit}`);
  return parts.map((part) => `<span>${part}</span>`).join("");
}

function nearestUsefulStep(value) {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const candidates = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10];
  const nearest = candidates.reduce((best, candidate) => (
    Math.abs(candidate - normalized) < Math.abs(best - normalized) ? candidate : best
  ), candidates[0]);
  return nearest * magnitude;
}

function automaticBinWidth(values) {
  const minimum = values[0];
  const maximum = values[values.length - 1];
  const range = maximum - minimum;
  if (!Number.isFinite(range) || range <= 0) return nearestUsefulStep(Math.max(Math.abs(minimum) * 0.1, 1));

  const iqr = quantile(values, 75) - quantile(values, 25);
  const fdWidth = iqr > 0 ? 2 * iqr / Math.cbrt(values.length) : 0;
  const fallbackBins = Math.ceil(Math.log2(values.length) + 1);
  return nearestUsefulStep(fdWidth > 0 ? fdWidth : range / Math.max(1, fallbackBins));
}

function kdeBandwidth(values, binWidth) {
  if (values.length < 2) return binWidth;
  const standardDeviation = sampleStandardDeviation(values);
  const iqr = quantile(values, 75) - quantile(values, 25);
  const robustScale = Math.min(...[standardDeviation, iqr / 1.34].filter((value) => value > 0));
  const scale = Number.isFinite(robustScale) ? robustScale : standardDeviation || binWidth;
  return Math.max(scale * 0.9 * (values.length ** -0.2), binWidth * 0.18);
}

function niceCeiling(value) {
  const raw = Math.max(2, value);
  if (raw <= 2) return 2;
  const step = Math.max(1, Math.ceil(raw / 4));
  return step * 4;
}

function distributionModel(values, configuredBinWidth) {
  const minimum = values[0];
  const maximum = values[values.length - 1];
  const automatic = !Number.isFinite(configuredBinWidth);
  const binWidth = automatic ? automaticBinWidth(values) : configuredBinWidth;
  let start = Math.floor(minimum / binWidth) * binWidth;
  let end = Math.ceil(maximum / binWidth) * binWidth;
  if (end <= start) end = start + binWidth;
  if (!automatic) {
    start -= binWidth * 0.5;
    end += binWidth * 0.5;
  }
  const binCount = Math.max(1, Math.ceil((end - start) / binWidth));
  end = start + binCount * binWidth;
  const bins = Array.from({ length: binCount }, (_, index) => ({
    start: start + index * binWidth,
    end: start + (index + 1) * binWidth,
    count: 0
  }));
  values.forEach((value) => {
    const index = Math.min(binCount - 1, Math.max(0, Math.floor((value - start) / binWidth)));
    bins[index].count += 1;
  });

  const bandwidth = kdeBandwidth(values, binWidth);
  const curve = values.length > 1 ? Array.from({ length: 181 }, (_, index) => {
    const x = start + (end - start) * (index / 180);
    const density = values.reduce((sum, value) => {
      const z = (x - value) / bandwidth;
      return sum + Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
    }, 0) / (values.length * bandwidth);
    return { x, y: density * values.length * binWidth };
  }) : [];
  const standardDeviation = sampleStandardDeviation(values);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const normalCurve = values.length > 1 && standardDeviation > 0 ? Array.from({ length: 181 }, (_, index) => {
    const x = start + (end - start) * (index / 180);
    const z = (x - mean) / standardDeviation;
    const density = Math.exp(-0.5 * z * z) / (standardDeviation * Math.sqrt(2 * Math.PI));
    return { x, y: density * values.length * binWidth };
  }) : [];
  return { values, start, end, bins, curve, normalCurve, bandwidth, binWidth, automatic };
}

function drawDistributionChart(svg, values, config, field, theme) {
  const bounds = svg.getBoundingClientRect();
  const width = Math.max(280, Math.round(bounds.width));
  const height = Math.max(250, Math.round(bounds.height));
  const margin = { top: 42, right: 18, bottom: 42, left: 42 };
  const plot = { left: margin.left, top: margin.top, right: width - margin.right, bottom: height - margin.bottom };
  const model = distributionModel(values, config.binWidth);
  const peak = Math.max(...model.bins.map((bin) => bin.count), ...model.curve.map((point) => point.y), ...model.normalCurve.map((point) => point.y), 1);
  const yMax = niceCeiling(peak * 1.12);
  const xScale = (value) => plot.left + ((value - model.start) / (model.end - model.start)) * (plot.right - plot.left);
  const yScale = (value) => plot.bottom - (value / yMax) * (plot.bottom - plot.top);
  const elements = [];
  const textStyle = "font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif";

  for (let index = 0; index <= 4; index += 1) {
    const value = yMax * index / 4;
    const y = yScale(value);
    elements.push(`<line x1="${plot.left}" y1="${y}" x2="${plot.right}" y2="${y}" stroke="${index === 0 ? "#9ca3af" : "#e5e7eb"}" stroke-width="1" />`);
    elements.push(`<text x="${plot.left - 7}" y="${y}" fill="#6b7280" font-size="11" text-anchor="end" dominant-baseline="middle" style="${textStyle}">${Number.isInteger(value) ? String(value) : value.toFixed(1)}</text>`);
  }

  model.bins.forEach((bin) => {
    const x = xScale(bin.start) + 1;
    const barWidth = Math.max(1, xScale(bin.end) - xScale(bin.start) - 2);
    const y = yScale(bin.count);
    elements.push(`<rect x="${x}" y="${y}" width="${barWidth}" height="${plot.bottom - y}" fill="${theme.fill}" stroke="${theme.base}" stroke-width="1" />`);
    if (bin.count) {
      const labelY = Math.max(plot.top + 8, y - 9);
      elements.push(`<text x="${x + barWidth / 2}" y="${labelY}" fill="#1f2937" font-size="11" text-anchor="middle" dominant-baseline="middle" style="${textStyle}">${bin.count}人</text>`);
      if (barWidth >= 44) {
        const percentage = bin.count / values.length * 100;
        elements.push(`<text x="${x + barWidth / 2}" y="${labelY + 12}" fill="#6b7280" font-size="9" text-anchor="middle" dominant-baseline="middle" style="${textStyle}">${percentage.toFixed(percentage >= 10 ? 0 : 1)}%</text>`);
      }
    }
  });

  if (model.normalCurve.length) {
    const path = model.normalCurve.map((point, index) => `${index ? "L" : "M"}${xScale(point.x).toFixed(2)} ${yScale(point.y).toFixed(2)}`).join(" ");
    elements.push(`<path data-chart-series="normal-reference" d="${path}" fill="none" stroke="#4b5563" stroke-width="2" stroke-dasharray="7 5" stroke-linecap="round" stroke-linejoin="round" />`);
  }

  if (model.curve.length) {
    const path = model.curve.map((point, index) => `${index ? "L" : "M"}${xScale(point.x).toFixed(2)} ${yScale(point.y).toFixed(2)}`).join(" ");
    elements.push(`<path data-chart-series="kde" d="${path}" fill="none" stroke="${theme.base}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />`);
  }

  const chartPercentiles = [...new Set([...(config.percentiles || []), 50])].sort((a, b) => a - b);
  const percentileGroups = chartPercentiles.map((percentile) => {
    const value = quantile(values, percentile);
    return { percentiles: [percentile], value, x: xScale(value) };
  }).reduce((groups, point) => {
    const previous = groups.at(-1);
    if (previous && Math.abs(previous.value - point.value) < 0.005) {
      previous.percentiles.push(...point.percentiles);
      previous.value = (previous.value + point.value) / 2;
      previous.x = (previous.x + point.x) / 2;
    } else {
      groups.push(point);
    }
    return groups;
  }, []);
  percentileGroups.forEach((group, index) => {
    const x = group.x;
    elements.push(`<line x1="${x}" y1="${plot.top}" x2="${x}" y2="${plot.bottom}" stroke="${theme.base}" stroke-width="1" stroke-dasharray="4 4" />`);
    const labels = group.percentiles.map((value) => value === 50 ? "P50/中位数" : `P${value}`);
    elements.push(`<text x="${x}" y="${13 + (index % 2) * 14}" fill="${theme.base}" font-size="10" font-weight="600" text-anchor="middle" dominant-baseline="middle" style="${textStyle}">${labels.join("/")} ${formatStatistic(group.value, values)}</text>`);
  });

  for (let index = 0; index <= 4; index += 1) {
    const value = model.start + (model.end - model.start) * index / 4;
    elements.push(`<text x="${xScale(value)}" y="${plot.bottom + 18}" fill="#6b7280" font-size="11" text-anchor="middle" dominant-baseline="middle" style="${textStyle}">${value.toFixed(1)}</text>`);
  }
  elements.push(`<text x="12" y="${(plot.top + plot.bottom) / 2}" fill="#6b7280" font-size="11" text-anchor="middle" dominant-baseline="middle" transform="rotate(-90 12 ${(plot.top + plot.bottom) / 2})" style="${textStyle}">人数</text>`);
  const axisLabel = field.unit ? `${field.label}（${field.unit}）` : field.label;
  elements.push(`<text x="${(plot.left + plot.right) / 2}" y="${height - 9}" fill="#6b7280" font-size="11" text-anchor="middle" dominant-baseline="middle" style="${textStyle}">${escapeHtml(axisLabel)}</text>`);

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.dataset.binWidth = String(model.binWidth);
  svg.dataset.binMode = model.automatic ? "automatic" : "fixed";
  svg.innerHTML = `<title>${escapeHtml(field.label)}分布图</title>${elements.join("")}`;

  return { ...model, plot, width, height, xScale, unit: field.unit || "" };
}

function updateChartCursor(chart, clientX) {
  const model = chart._distributionModel;
  if (!model) return;
  const rect = chart.getBoundingClientRect();
  const chartX = (clientX - rect.left) * (model.width / rect.width);
  const localX = Math.max(model.plot.left, Math.min(model.plot.right, chartX));
  const value = model.start + ((localX - model.plot.left) / (model.plot.right - model.plot.left)) * (model.end - model.start);
  const percentile = model.values.filter((item) => item <= value).length / model.values.length * 100;
  const bin = model.bins.find((item, index) => value >= item.start && (value < item.end || index === model.bins.length - 1));
  const stage = chart.closest(".chart-stage");
  const cursor = stage.querySelector(".chart-cursor");
  const tooltip = stage.querySelector(".chart-tooltip");
  const left = localX / model.width * 100;
  cursor.style.left = `${left}%`;
  cursor.hidden = false;
  tooltip.style.left = `${Math.max(20, Math.min(80, left))}%`;
  tooltip.textContent = `P${percentile.toFixed(0)} · ${value.toFixed(2)}${model.unit ? ` ${model.unit}` : ""} · 本区间${bin?.count || 0}人`;
  tooltip.hidden = false;
}

function bindChartCursor(chart) {
  const update = (event) => {
    if (event.isPrimary === false) return;
    updateChartCursor(chart, event.clientX);
  };
  chart.addEventListener("pointerdown", update);
  chart.addEventListener("pointermove", update);
  chart.addEventListener("pointerleave", (event) => {
    if (event.pointerType !== "mouse") return;
    const stage = chart.closest(".chart-stage");
    stage.querySelector(".chart-cursor").hidden = true;
    stage.querySelector(".chart-tooltip").hidden = true;
  });
}

function initializeAnalysisCharts(config) {
  const redrawers = [];
  app.querySelectorAll("[data-analysis-chart]").forEach((chart) => {
    const item = config.fields[Number(chart.dataset.analysisChart)];
    const field = state.currentTemplate.fields.find((candidate) => candidate.id === item.id);
    const values = fieldDistribution(state.currentTemplate, state.records, item.id, config.aggregation);
    const theme = ANALYSIS_THEMES[item.theme] || ANALYSIS_THEMES.blue;
    const redraw = () => {
      if (!chart.isConnected || !values.length) return;
      chart._distributionModel = drawDistributionChart(chart, values, config, field, theme);
      const note = chart.closest(".analysis-chart-card")?.querySelector("[data-bin-width-note]");
      if (note) {
        const model = chart._distributionModel;
        note.textContent = `${model.automatic ? "自动" : "固定"}分箱：每格 ${model.binWidth.toLocaleString("zh-CN", { maximumFractionDigits: 4 })} ${field.unit || ""}`;
      }
    };
    redrawers.push(redraw);
    bindChartCursor(chart);
    redraw();
  });
  state.analysisResizeObserver = new ResizeObserver(() => redrawers.forEach((redraw) => redraw()));
  app.querySelectorAll(".chart-stage").forEach((stage) => state.analysisResizeObserver.observe(stage));
}

const STATISTIC_LABELS = {
  count: "样本数",
  mean: "平均数",
  median: "中位数",
  mode: "众数",
  min: "最小值",
  max: "最大值",
  sd: "标准差",
  q1: "Q1",
  q3: "Q3"
};

function statisticValueHtml(key, stats, values, unit) {
  if (key === "count") return String(stats.count);
  if (key === "mode") {
    if (!stats.mode.length) return "无明显众数";
    return `${stats.mode.map((value) => formatStatistic(value, values)).join(" / ")}${unit}`;
  }
  return `${formatStatistic(stats[key], values)}${stats[key] === null ? "" : unit}`;
}

function statisticGridHtml(keys, stats, values, field, className) {
  if (!keys.length) return "";
  const unit = field.unit ? ` ${escapeHtml(field.unit)}` : "";
  return `<div class="${className}">${keys.map((key) => `
    <div class="analysis-stat"><span>${STATISTIC_LABELS[key]}</span><strong>${statisticValueHtml(key, stats, values, unit)}</strong></div>`).join("")}</div>`;
}

function analysisStatisticsHtml(config, values, field) {
  const requested = config.statistics || DESCRIPTIVE_STATISTICS;
  const stats = descriptiveStatistics(values);
  const primaryKeys = ["count", "mean", "median", "mode"].filter((key) => requested.includes(key));
  const detailKeys = ["sd", "min", "max", "q1", "q3"].filter((key) => requested.includes(key));
  return `
    ${statisticGridHtml(primaryKeys, stats, values, field, "analysis-primary-stats")}
    ${detailKeys.length ? `<details class="analysis-more"><summary>更多统计</summary>${statisticGridHtml(detailKeys, stats, values, field, "analysis-detail-stats")}</details>` : ""}`;
}

function renderImageRangeAnalysis(config) {
  const fields = config.fields.map((item) => ({
    item,
    field: state.currentTemplate.fields.find((candidate) => candidate.id === item.id)
  }));
  const scaleMaximum = Math.max(0, ...fields.map(({ field }) => state.records.filter((record) => imageRangeStrokes(record.answers?.[field.id]).length).length));
  const scaleTicks = scaleMaximum === 0 ? [0] : Array.from(new Set(Array.from({ length: Math.min(6, scaleMaximum + 1) }, (_, index) => Math.round(index * scaleMaximum / Math.min(5, scaleMaximum)))));
  app.innerHTML = `
    <section class="screen analysis-screen">
      ${pageHeader("简易分析")}
      <div class="page-content analysis-content">
        <p class="analysis-help">每位参与者在同一位置最多计 1 人；颜色边缘仅为显示柔化，人数累计不被改变。三张视图使用相同的人数色标。</p>
        <section class="analysis-chart-card heatmap-card">
          <label class="heatmap-picker-label">查看图片
            <select data-heatmap-field>${fields.map(({ item, field }) => `<option value="${escapeHtml(field.id)}">${escapeHtml(item.label || field.label)}</option>`).join("")}</select>
          </label>
          <div class="heatmap-levels" data-heatmap-levels></div>
          <p class="heatmap-sample-count" data-heatmap-count></p>
          <div class="heatmap-image-wrap"><img data-heatmap-image alt="" /><canvas data-heatmap-overlay aria-hidden="true"></canvas></div>
          <div class="heatmap-scale" role="img" aria-label="热力图色标，0至${scaleMaximum}人"><div class="heatmap-scale-bar"></div><div class="heatmap-scale-ticks">${scaleTicks.map((count) => `<span>${count}</span>`).join("")}</div></div>
          <p class="heatmap-scale-note">色标：同一区域的标注人数（0–${scaleMaximum} 人）</p>
        </section>
      </div>
    </section>`;
  const picker = app.querySelector("[data-heatmap-field]");
  const levels = app.querySelector("[data-heatmap-levels]");
  const count = app.querySelector("[data-heatmap-count]");
  const image = app.querySelector("[data-heatmap-image]");
  const overlay = app.querySelector("[data-heatmap-overlay]");
  let activeLevel = 1;
  const draw = () => {
    if (!overlay.isConnected) return;
    const { field } = fields.find(({ field: candidate }) => candidate.id === picker.value);
    image.src = field.image.src;
    image.alt = field.image.alt || field.label;
    levels.innerHTML = field.levels.length > 1 ? field.levels.map((level) => `<button type="button" data-heatmap-level="${level.id}" aria-pressed="${level.id === activeLevel}">${escapeHtml(level.label)}</button>`).join("") : "";
    const result = countImageRangeParticipants(field, state.records, activeLevel);
    count.textContent = `这张图有 ${result.participantCount} 份已标注样本；其中 ${result.levelCount} 份标注了${field.levels[activeLevel - 1].label}。最高重合 ${result.maxCount} 人。`;
    paintHeatmap(overlay, result, scaleMaximum);
  };
  picker.addEventListener("change", () => { activeLevel = 1; draw(); });
  levels.addEventListener("click", (event) => {
    const button = event.target.closest("[data-heatmap-level]");
    if (!button) return;
    activeLevel = Number(button.dataset.heatmapLevel);
    draw();
  });
  requestAnimationFrame(draw);
}

function renderAnalysis() {
  const config = analysisConfig(state.currentTemplate);
  if (!config) {
    state.view = "home";
    renderHome();
    showToast("当前问卷没有配置简易分析");
    return;
  }
  if (config.type === "imageRangeHeatmap") {
    renderImageRangeAnalysis(config);
    return;
  }
  const charts = config.fields.map((item, index) => {
    const field = state.currentTemplate.fields.find((candidate) => candidate.id === item.id);
    const values = fieldDistribution(state.currentTemplate, state.records, item.id, config.aggregation);
    const themeName = ANALYSIS_THEMES[item.theme] ? item.theme : "blue";
    const theme = ANALYSIS_THEMES[themeName];
    if (!field || !values.length) {
      return `<section class="analysis-chart-card"><h2>${escapeHtml(item.label || field?.label || item.id)}</h2><div class="analysis-empty">还没有可用于分析的数据</div></section>`;
    }
    const percentileText = (config.percentiles || []).map((percentile) => `P${percentile} ${formatStatistic(quantile(values, percentile), values)} ${field.unit || ""}`.trim()).join(" · ");
    const aggregationText = field.type === "repeatedNumber"
      ? "每名参与者先取有效重复测量的平均值，再只计入一次"
      : "每份记录中的有效数值计为一个样本";
    return `
      <section class="analysis-chart-card" data-chart-theme="${themeName}" style="--chart-color:${theme.base};--chart-fill:${theme.fill}">
        <div class="analysis-chart-heading"><h2>${escapeHtml(item.label || field.label)}</h2><p>${aggregationText}；柱形为实际人数${values.length > 1 ? "，曲线用于观察分布形状" : "；记录较少时暂不绘制分布曲线"}。<span data-bin-width-note></span></p></div>
        ${analysisStatisticsHtml(config, values, field)}
        <div class="chart-legend"><span class="legend-bar">实际人数</span>${values.length > 1 ? '<span class="legend-line">KDE 分布曲线</span><span class="legend-normal">正态分布参考</span>' : ""}</div>
        <div class="chart-stage">
          <svg xmlns="http://www.w3.org/2000/svg" data-analysis-chart="${index}" role="img" aria-label="${escapeHtml(item.label || field.label)}，样本数${values.length}${percentileText ? `，${escapeHtml(percentileText)}` : ""}，含人数直方图${values.length > 1 ? "、KDE和正态分布参考" : ""}" preserveAspectRatio="none"></svg>
          <span class="chart-cursor" hidden></span><span class="chart-tooltip" hidden></span>
        </div>
        ${percentileText ? `<p class="percentile-summary">${escapeHtml(percentileText)}</p>` : ""}
      </section>`;
  }).join("");
  app.innerHTML = `
    <section class="screen analysis-screen">
      ${pageHeader("简易分析")}
      <div class="page-content analysis-content">
        <p class="analysis-help">在图表上左右移动可查看对应数值、P值和区间人数；中位数以竖向虚线标出。页面上下滚动仍由系统处理，横屏时图表会自动放大。</p>
        ${charts}
      </div>
    </section>`;
  requestAnimationFrame(() => initializeAnalysisCharts(config));
}

function renderRepeatedNumberField(field, answer) {
  const values = Array.from({ length: field.repeatCount }, (_, index) => Array.isArray(answer) ? answer[index] ?? "" : "");
  return `
    <div class="repeated-number-field">
      ${values.map((value, index) => `
        <label class="repeated-input-row">
          <span class="repeated-input-label">第${index + 1}次${index === 0 ? "" : "（选填）"}</span>
          <span class="input-with-unit">
            <input class="number-input" data-repeat-input="${index}" type="text" inputmode="${field.integer ? "numeric" : "decimal"}" autocomplete="off" value="${escapeHtml(value)}" placeholder="${escapeHtml(field.placeholder || "")}" />
            ${field.unit ? `<span class="unit-label">${escapeHtml(field.unit)}</span>` : ""}
          </span>
        </label>`).join("")}
      <div class="repeated-summary" data-repeated-summary ${validRepeatedValues(values).length ? "" : "hidden"}>${repeatedSummaryHtml(field, values)}</div>
    </div>`;
}

function renderSingleChoice(field, answer, fieldIndex = state.formIndex) {
  const current = answer && typeof answer === "object" ? answer : { value: "", otherText: "" };
  return `<div class="choice-list">${field.options.map((option) => {
    const selected = current.value === option.id;
    return `
      <button class="choice-button ${selected ? "selected" : ""}" type="button" data-action="select-single" data-field-index="${fieldIndex}" data-option="${escapeHtml(option.id)}">${escapeHtml(option.label)}</button>
      ${selected && option.textInput ? `<input class="other-input" data-other-input type="text" inputmode="text" autocomplete="off" value="${escapeHtml(current.otherText || "")}" placeholder="${escapeHtml(option.textInput.placeholder || "")}" aria-label="${escapeHtml(option.textInput.label || "其他说明")}" />` : ""}`;
  }).join("")}</div>`;
}

function renderMultiChoice(field, answer, fieldIndex = state.formIndex) {
  const current = answer && typeof answer === "object" ? answer : { values: [], otherTextById: {} };
  const selectedValues = Array.isArray(current.values) ? current.values : [];
  return `<div class="choice-list ${field.image?.src ? "choice-grid" : ""}">${field.options.map((option) => {
    const selected = selectedValues.includes(option.id);
    return `
      <button class="choice-button multi ${option.exclusive ? "choice-exclusive" : ""} ${selected ? "selected" : ""}" type="button" data-action="toggle-multi" data-field-index="${fieldIndex}" data-option="${escapeHtml(option.id)}">${escapeHtml(option.label)}</button>
      ${selected && option.textInput ? `<input class="other-input" data-other-input data-option="${escapeHtml(option.id)}" type="text" inputmode="text" autocomplete="off" value="${escapeHtml(current.otherTextById?.[option.id] || "")}" placeholder="${escapeHtml(option.textInput.placeholder || "")}" />` : ""}`;
  }).join("")}</div>`;
}

function renderRating(field, answer, fieldIndex = state.formIndex) {
  const values = [];
  for (let value = field.min; value <= field.max; value += 1) values.push(value);
  const selectedHelp = typeof answer === "number" ? field.labels?.[String(answer)]?.help : "";
  return `
    <div class="rating-grid">
      ${values.map((value) => `<button class="rating-button ${answer === value ? "selected" : ""}" type="button" data-action="select-rating" data-field-index="${fieldIndex}" data-value="${value}"><strong>${value}</strong><span>${escapeHtml(field.labels?.[String(value)]?.short || "")}</span></button>`).join("")}
    </div>
    ${selectedHelp ? `<div class="rating-help">${escapeHtml(selectedHelp)}</div>` : ""}
    ${field.unknownOption ? `<button class="choice-button unknown-button ${answer === field.unknownOption.id ? "selected" : ""}" type="button" data-action="select-rating" data-field-index="${fieldIndex}" data-value="${escapeHtml(field.unknownOption.id)}">${escapeHtml(field.unknownOption.label)}</button>` : ""}`;
}

function renderFieldControl(field, answer, fieldIndex = state.formIndex) {
  switch (field.type) {
    case "shortText": return renderTextField(field, answer, false, fieldIndex);
    case "longText": return renderTextField(field, answer, true, fieldIndex);
    case "number": return renderNumberField(field, answer);
    case "repeatedNumber": return renderRepeatedNumberField(field, answer);
    case "singleChoice": return renderSingleChoice(field, answer, fieldIndex);
    case "multiChoice": return renderMultiChoice(field, answer, fieldIndex);
    case "rating": return renderRating(field, answer, fieldIndex);
    case "imageRange": return renderImageRange(field, answer, fieldIndex);
    case "section": return `<div class="card">${escapeHtml(field.description || "")}</div>`;
    default: return "";
  }
}

function formPages(fields) {
  const pages = [];
  fields.forEach((field, fieldIndex) => {
    const pageId = field.page?.trim() || null;
    const previous = pages.at(-1);
    if (pageId && previous?.pageId === pageId) previous.items.push({ field, fieldIndex });
    else pages.push({ pageId, items: [{ field, fieldIndex }] });
  });
  return pages;
}

function currentFormPage(fields = state.currentTemplate?.fields || []) {
  const pages = formPages(fields);
  const pageIndex = Math.max(0, pages.findIndex((page) => page.items.some((item) => item.fieldIndex === state.formIndex)));
  return { pages, pageIndex, page: pages[pageIndex] };
}

function renderImageRange(field, answer, fieldIndex) {
  const width = field.image.width;
  const height = field.image.height;
  const brushMin = Math.min(0.01, field.brushSize);
  const brushMax = Math.max(0.06, field.brushSize);
  const strokes = imageRangeStrokes(answer);
  const masks = field.levels.map((level) => {
    const levelPaths = strokes.filter((stroke) => stroke.level === level.id).map((stroke) =>
      `<path d="${strokePath(stroke, width, height)}" fill="none" stroke="white" stroke-width="${stroke.brushSize * width}" stroke-linecap="round" stroke-linejoin="round" />`).join("");
    const higherLevelCutout = level.id === 1 ? strokes.filter((stroke) => stroke.level === 2).map((stroke) =>
      `<path d="${strokePath(stroke, width, height)}" fill="none" stroke="black" stroke-width="${stroke.brushSize * width}" stroke-linecap="round" stroke-linejoin="round" />`).join("") : "";
    const paths = levelPaths + higherLevelCutout;
    return `<mask id="annotation-mask-${fieldIndex}-${level.id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}">${paths}</mask>`;
  }).join("");
  const overlays = field.levels.map((level, index) => `<rect width="${width}" height="${height}" fill="${index ? "#d34b50" : "#188d9d"}" opacity="0.48" mask="url(#annotation-mask-${fieldIndex}-${level.id})" pointer-events="none" />`).join("");
  return `<div class="annotation-workspace" data-annotation-index="${fieldIndex}">
    <svg class="annotation-canvas" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeHtml(field.image.alt || field.label)}；在图上滑动可涂画范围">
      <image href="${escapeHtml(field.image.src)}" width="${width}" height="${height}" />
      <defs>${masks}</defs>${overlays}
      <rect class="annotation-hit-area" width="${width}" height="${height}" fill="transparent" />
    </svg>
    <div class="annotation-tools">
      ${field.levels.length === 2 ? `<div class="annotation-segment" data-active-level="1" role="group" aria-label="疼痛等级">${field.levels.map((level) => `<button type="button" data-annotation-level="${level.id}" aria-pressed="${level.id === 1}">${escapeHtml(level.label)}</button>`).join("")}</div>` : `<span class="annotation-level-name">${escapeHtml(field.levels[0].label)}</span>`}
      <label class="annotation-brush">画笔 <input type="range" data-annotation-brush min="${brushMin}" max="${brushMax}" step="any" value="${field.brushSize}" aria-label="画笔大小" /><span data-annotation-brush-value></span></label>
      <div class="annotation-edit-tools"><button type="button" data-annotation-undo>撤销上一笔</button><button type="button" data-annotation-clear>清除所有标记</button></div>
    </div>
  </div>`;
}

function bindImageRange(field, fieldIndex) {
  const workspace = app.querySelector(`[data-annotation-index="${fieldIndex}"]`);
  if (!workspace) return;
  const svg = workspace.querySelector(".annotation-canvas");
  const hit = workspace.querySelector(".annotation-hit-area");
  const answer = state.draft.answers[field.id] && Array.isArray(state.draft.answers[field.id].strokes)
    ? state.draft.answers[field.id] : blankImageRangeAnswer();
  state.draft.answers[field.id] = answer;
  let level = 1;
  let active = null;
  const brushInput = workspace.querySelector("[data-annotation-brush]");
  const brushValue = workspace.querySelector("[data-annotation-brush-value]");
  const updateBrushLabel = () => {
    brushValue.textContent = `${(Number(brushInput.value) * 100).toFixed(1)}%`;
    const range = Number(brushInput.max) - Number(brushInput.min);
    const progress = range ? (Number(brushInput.value) - Number(brushInput.min)) / range : 0;
    brushInput.style.setProperty("--brush-progress", `${Math.max(0, Math.min(100, progress * 100))}%`);
  };
  brushInput.addEventListener("input", updateBrushLabel);
  updateBrushLabel();
  const updateMasks = () => field.levels.forEach((item) => {
    const mask = svg.querySelector(`#annotation-mask-${fieldIndex}-${item.id}`);
    const maskStrokes = [
      ...answer.strokes.filter((stroke) => stroke.level === item.id).map((stroke) => [stroke, "white"]),
      ...(item.id === 1 ? answer.strokes.filter((stroke) => stroke.level === 2).map((stroke) => [stroke, "black"]) : [])
    ];
    mask.replaceChildren(...maskStrokes.map(([stroke, color]) => {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", strokePath(stroke, field.image.width, field.image.height));
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", color);
      path.setAttribute("stroke-width", String(stroke.brushSize * field.image.width));
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      return path;
    }));
  });
  const chooseLevel = (selected) => {
    level = selected;
    if (segment) segment.dataset.activeLevel = String(level);
    workspace.querySelectorAll("[data-annotation-level]").forEach((button) => button.setAttribute("aria-pressed", String(Number(button.dataset.annotationLevel) === level)));
  };
  workspace.querySelectorAll("[data-annotation-level]").forEach((button) => button.addEventListener("click", () => chooseLevel(Number(button.dataset.annotationLevel))));
  const segment = workspace.querySelector(".annotation-segment");
  segment?.addEventListener("pointerdown", (event) => segment.setPointerCapture(event.pointerId));
  segment?.addEventListener("pointerup", (event) => {
    const rect = segment.getBoundingClientRect();
    chooseLevel(event.clientX < rect.left + rect.width / 2 ? 1 : 2);
  });
  hit.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    const point = pointOnImage(svg, event, field.image.width, field.image.height);
    if (!point) return;
    const stroke = { id: crypto.randomUUID(), annotationType: field.annotationType, level, brushSize: Number(brushInput.value), points: [point] };
    answer.strokes.push(stroke);
    hit.setPointerCapture(event.pointerId);
    updateMasks();
    const ownMask = svg.querySelector(`#annotation-mask-${fieldIndex}-${level}`);
    const livePaths = [Array.from(ownMask.querySelectorAll("path[stroke='white']")).at(-1)];
    if (level === 2) livePaths.push(Array.from(svg.querySelector(`#annotation-mask-${fieldIndex}-1`).querySelectorAll("path[stroke='black']")).at(-1));
    active = { pointerId: event.pointerId, stroke, livePaths };
  });
  hit.addEventListener("pointermove", (event) => {
    if (!active || event.pointerId !== active.pointerId) return;
    event.preventDefault();
    const point = pointOnImage(svg, event, field.image.width, field.image.height);
    if (point && appendStrokePoint(active.stroke, point)) {
      const path = strokePath(active.stroke, field.image.width, field.image.height);
      active.livePaths.forEach((element) => element?.setAttribute("d", path));
    }
  });
  const endStroke = (event) => {
    if (!active || event.pointerId !== active.pointerId) return;
    active.stroke.points = simplifyStrokePoints(active.stroke.points, field.image.width, field.image.height);
    active = null;
    if (hit.hasPointerCapture(event.pointerId)) hit.releasePointerCapture(event.pointerId);
    updateMasks();
    void persistDraft();
  };
  hit.addEventListener("pointerup", endStroke);
  hit.addEventListener("pointercancel", endStroke);
  workspace.querySelector("[data-annotation-undo]").addEventListener("click", () => { answer.strokes.pop(); updateMasks(); void persistDraft(); });
  workspace.querySelector("[data-annotation-clear]").addEventListener("click", async () => {
    if (!answer.strokes.length) return;
    const confirmed = await showConfirm({ title: "清除本页标记？", message: "这张图片的所有标记（包括两个疼痛等级）都会清除，其他图片不受影响。", confirmLabel: "全部清除" });
    if (!confirmed) return;
    answer.strokes = [];
    updateMasks();
    void persistDraft();
  });
}

function renderFormQuestion({ field, fieldIndex }) {
  if (field.type === "section") {
    return `<section class="form-page-section" data-question-index="${fieldIndex}"><h2 class="question-title">${escapeHtml(field.label)}</h2>${field.description ? `<p class="question-description">${escapeHtml(field.description)}</p>` : ""}</section>`;
  }
  const answer = getFieldAnswer(field);
  const requirementLabel = field.required ? "必填" : "可跳过";
  return `<section class="form-page-question" data-question-index="${fieldIndex}">
    <div class="question-meta"><span class="question-number">Q${field.questionNumber || fieldIndex + 1}.</span><span class="requirement-chip ${field.required ? "is-required" : ""}">${requirementLabel}</span></div>
    <h2 class="question-title">${escapeHtml(field.label)}</h2>
    ${field.description ? `<p class="question-description">${escapeHtml(field.description)}</p>` : ""}
    ${field.image?.src && field.type !== "imageRange" ? `<img class="question-image" src="${escapeHtml(field.image.src)}" alt="${escapeHtml(field.image.alt || field.label)}" />` : ""}
    ${renderFieldControl(field, answer, fieldIndex)}
    <div class="validation-message" data-validation-for="${fieldIndex}"></div>
  </section>`;
}

function renderForm() {
  if (!state.currentTemplate || !state.draft) {
    state.view = "home";
    renderHome();
    return;
  }

  const fields = state.currentTemplate.fields;
  state.formIndex = Math.max(0, Math.min(state.formIndex, fields.length - 1));
  const { pages, pageIndex, page } = currentFormPage(fields);
  state.formIndex = page.items[0].fieldIndex;
  const progress = ((pageIndex + 1) / pages.length) * 100;
  const isLast = pageIndex === pages.length - 1;
  const usesGroupedPages = pages.some((item) => item.items.length > 1);
  const annotationItem = page.items.length === 1 && page.items[0].field.type === "imageRange" ? page.items[0] : null;
  document.documentElement.classList.toggle("annotation-page", Boolean(annotationItem));

  app.innerHTML = `
    <section class="screen form-screen ${annotationItem ? "annotation-screen" : ""}">
      <header class="nav-top-bar form-top-bar">
        <button class="back-button" type="button" data-action="leave-form" aria-label="${state.draft.mode === "edit" ? "返回记录详情" : "返回首页"}"><img src="${ICON_ARROW_LEFT}" alt="" width="20" height="20" /></button>
        <h1>${state.draft.mode === "edit" ? "修改记录" : "填写问卷"}</h1>
        <span class="form-counter">${pageIndex + 1}/${pages.length}</span>
      </header>
      <div class="progress-block">
        <div class="progress-track"><div class="progress-fill" style="width:${progress}%"></div></div>
      </div>
      <article class="question-card ${page.items.length > 1 ? "multi-question-page" : ""}">
        ${page.items.map(renderFormQuestion).join("")}
      </article>
      <div class="form-navigation">
        <button class="secondary-button" type="button" data-action="previous-question" ${pageIndex === 0 ? "disabled" : ""}>${usesGroupedPages ? "上一页" : "上一题"}</button>
        <button class="primary-button" type="button" data-action="next-question">${isLast ? (state.draft.mode === "edit" ? "保存修改" : "保存记录") : (usesGroupedPages ? "下一页" : "下一题")}</button>
      </div>
    </section>`;
  if (annotationItem) bindImageRange(annotationItem.field, annotationItem.fieldIndex);
}

function renderBackup() {
  app.innerHTML = `
    <section class="screen">
      ${pageHeader("完整备份与恢复")}
      <div class="page-content"><div class="card backup-panel">
        <p>完整JSON包含所有问卷模板、已保存记录和草稿。更换测试手机或考虑数据可能丢失时使用。</p>
        <div class="backup-actions">
          <button class="secondary-button" type="button" data-action="export-backup">导出完整 JSON 备份</button>
          <button class="danger-button" type="button" data-action="import-backup">从 JSON 恢复整个工具</button>
        </div>
      </div></div>
    </section>`;
}

function blankAnswer(field) {
  if (field.type === "imageRange") return blankImageRangeAnswer();
  if (field.allowAnonymous) return { value: "", anonymous: false };
  if (field.type === "singleChoice") return { value: "", otherText: "" };
  if (field.type === "multiChoice") return { values: [], otherTextById: {} };
  if (field.type === "repeatedNumber") return Array.from({ length: field.repeatCount }, () => "");
  return "";
}

function createAnswers(template) {
  return Object.fromEntries(template.fields.filter((field) => field.type !== "section").map((field) => [field.id, blankAnswer(field)]));
}

async function startNewForm() {
  const timestamp = nowIso();
  state.draft = {
    templateKey: state.currentTemplate.key,
    mode: "new",
    recordId: null,
    currentIndex: 0,
    answers: createAnswers(state.currentTemplate),
    createdAt: timestamp,
    updatedAt: timestamp
  };
  await putDraft(state.draft);
  state.formIndex = 0;
  state.view = "form";
  render();
}

async function persistDraft() {
  if (!state.draft) return;
  state.draft.currentIndex = state.formIndex;
  state.draft.updatedAt = nowIso();
  if (state.draft.mode !== "edit") await putDraft(state.draft);
}

async function saveEditedRecord({ validateAll = false } = {}) {
  if (state.draft?.mode !== "edit") return false;
  captureCurrentPage();
  const fields = validateAll ? state.currentTemplate.fields : currentFormPage().page.items.map((item) => item.field);
  for (const field of fields) {
    const message = fieldValidation(field, state.draft.answers[field.id]);
    if (message) {
      const fieldIndex = state.currentTemplate.fields.indexOf(field);
      if (validateAll) state.formIndex = fieldIndex;
      render();
      showValidation(message, fieldIndex);
      return false;
    }
  }
  const existing = await getRecord(state.draft.recordId);
  if (!existing) throw new Error("需要修改的原记录不存在");
  const updated = { ...existing, answers: deepClone(state.draft.answers), updatedAt: nowIso() };
  await putRecord(updated);
  state.selectedRecord = updated;
  state.draft = null;
  await refreshContext();
  state.view = "recordDetail";
  render();
  showToast("修改已保存");
  return true;
}

function captureFieldAt(fieldIndex) {
  if (!state.draft || !state.currentTemplate) return;
  const field = state.currentTemplate.fields[fieldIndex];
  if (!field || field.type === "section") return;
  const container = app.querySelector(`[data-question-index="${fieldIndex}"]`);
  if (!container) return;

  if (["shortText", "longText", "number"].includes(field.type)) {
    const input = container.querySelector("[data-field-input]");
    const value = input?.value ?? "";
    if (field.allowAnonymous) {
      state.draft.answers[field.id] = {
        value,
        anonymous: Boolean(container.querySelector("[data-anonymous]")?.checked)
      };
    } else {
      state.draft.answers[field.id] = value;
    }
  }

  if (field.type === "repeatedNumber") {
    state.draft.answers[field.id] = Array.from(container.querySelectorAll("[data-repeat-input]"), (input) => input.value);
  }

  if (field.type === "singleChoice") {
    const answer = state.draft.answers[field.id] || { value: "", otherText: "" };
    const other = container.querySelector("[data-other-input]");
    if (other) answer.otherText = other.value;
    state.draft.answers[field.id] = answer;
  }

  if (field.type === "multiChoice") {
    const answer = state.draft.answers[field.id] || { values: [], otherTextById: {} };
    container.querySelectorAll("[data-other-input][data-option]").forEach((input) => {
      answer.otherTextById[input.dataset.option] = input.value;
    });
    state.draft.answers[field.id] = answer;
  }
}

function captureCurrentPage() {
  currentFormPage().page?.items.forEach((item) => captureFieldAt(item.fieldIndex));
}

function captureCurrentField() {
  captureFieldAt(state.formIndex);
}

function fieldValidation(field, answer) {
  if (field.type === "section") return "";
  const isBlankString = (value) => typeof value !== "string" || !value.trim();
  if (field.type === "imageRange" && field.required && imageRangeStrokes(answer).length === 0) return `请标注“${field.label}”`;

  if (["shortText", "longText"].includes(field.type)) {
    if (field.allowAnonymous && answer?.anonymous) return "";
    if (field.required && isBlankString(field.allowAnonymous ? answer?.value : answer)) return `请填写“${field.label}”`;
  }

  if (field.type === "number") {
    const value = String(answer ?? "").trim();
    if (!value && field.required) return `请填写“${field.label}”`;
    if (value) {
      const pattern = field.integer ? /^\d+$/ : /^(?:\d+|\d*\.\d+)$/;
      if (!pattern.test(value)) return field.integer ? "请输入有效的整数" : "请输入有效数字，可以包含小数点";
    }
  }


  if (field.type === "repeatedNumber") {
    const values = Array.from({ length: field.repeatCount }, (_, index) => String(Array.isArray(answer) ? answer[index] ?? "" : "").trim());
    const entered = values.filter(Boolean);
    const minEntries = field.minEntries ?? (field.required ? 1 : 0);
    if (entered.length < minEntries) return `请至少填写${minEntries}次“${field.label}”`;
    for (const value of entered) {
      const pattern = field.integer ? /^\d+$/ : /^(?:\d+|\d*\.\d+)$/;
      if (!pattern.test(value)) return field.integer ? "请输入有效的整数" : "请输入有效数字，可以包含小数点";
    }
    const lastEnteredIndex = values.reduce((last, value, index) => value ? index : last, -1);
    if (values.slice(0, lastEnteredIndex + 1).some((value) => !value)) return "请按顺序填写测量数据，不要跳过中间一次";
  }

  if (field.type === "singleChoice") {
    if (field.required && !answer?.value) return `请选择“${field.label}”`;
    if (answer?.value) {
      const option = field.options.find((item) => item.id === answer.value);
      if (option?.textInput?.required && !String(answer.otherText || "").trim()) return option.textInput.label || "请填写其他说明";
    }
  }

  if (field.type === "multiChoice") {
    const values = Array.isArray(answer?.values) ? answer.values : [];
    if (field.required && values.length === 0) return `请至少选择一项“${field.label}”`;
    for (const value of values) {
      const option = field.options.find((item) => item.id === value);
      if (option?.textInput?.required && !String(answer?.otherTextById?.[value] || "").trim()) return option.textInput.label || "请填写其他说明";
    }
  }

  if (field.type === "rating" && field.required && (answer === "" || answer === null || answer === undefined)) {
    return `请选择“${field.label}”`;
  }
  return "";
}

function showValidation(message, fieldIndex = state.formIndex) {
  const element = document.querySelector(`[data-validation-for="${fieldIndex}"]`);
  if (element) element.textContent = message;
  if (message) showToast(message);
}

async function moveQuestion(direction) {
  captureCurrentPage();
  const fields = state.currentTemplate.fields;
  const { pages, pageIndex, page } = currentFormPage(fields);

  if (direction > 0) {
    for (const { field, fieldIndex } of page.items) {
      const message = fieldValidation(field, state.draft.answers[field.id]);
      if (message) {
        showValidation(message, fieldIndex);
        return;
      }
    }
  }

  await persistDraft();
  if (direction < 0) {
    state.formIndex = pages[Math.max(0, pageIndex - 1)].items[0].fieldIndex;
    await persistDraft();
    render();
    return;
  }

  if (pageIndex < pages.length - 1) {
    state.formIndex = pages[pageIndex + 1].items[0].fieldIndex;
    await persistDraft();
    render();
    return;
  }

  await completeRecord();
}

async function completeRecord() {
  if (state.draft?.mode === "edit") {
    await saveEditedRecord({ validateAll: true });
    return;
  }
  captureCurrentPage();
  const fields = state.currentTemplate.fields;
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    const message = fieldValidation(field, state.draft.answers[field.id]);
    if (message) {
      state.formIndex = index;
      await persistDraft();
      render();
      showValidation(message, index);
      return;
    }
  }

  const timestamp = nowIso();
  const id = crypto.randomUUID();
  await putRecord({
    id,
    recordNumber: makeRecordNumber(id),
    templateKey: state.currentTemplate.key,
    answers: deepClone(state.draft.answers),
    createdAt: timestamp,
    updatedAt: timestamp
  });
  showToast("记录已保存");

  await deleteDraft(state.currentTemplate.key);
  state.draft = null;
  state.view = "home";
  await refreshContext();
  render();
}

function makeRecordNumber(id) {
  const date = compactDate().replaceAll("-", "");
  return `R-${date}-${id.slice(0, 8).toUpperCase()}`;
}

function formatAnswer(field, answer, options = {}) {
  if (answer === null || answer === undefined || answer === "") return "";
  if (field.type === "imageRange") return imageRangeStrokes(answer).length ? `已标注（${imageRangeStrokes(answer).length}笔）` : "";
  if (["shortText", "longText"].includes(field.type)) {
    if (field.allowAnonymous && typeof answer === "object") return answer.anonymous ? "匿名" : String(answer.value || "");
    return String(answer);
  }
  if (field.type === "number") return String(answer);
  if (field.type === "repeatedNumber") {
    const values = (Array.isArray(answer) ? answer : []).map((value) => String(value ?? "").trim()).filter(Boolean);
    if (!values.length) return "";
    const stats = repeatedStats(values);
    const unit = field.unit ? ` ${field.unit}` : "";
    const parts = values.map((value, index) => `第${index + 1}次：${value}${unit}`);
    parts.push(`平均值：${stats.mean}${unit}`);
    if (stats.range) parts.push(`最大差值：${stats.range}${unit}`);
    return parts.join("；");
  }
  if (field.type === "singleChoice") {
    const selected = field.options.find((item) => item.id === answer?.value);
    if (!selected) return "";
    return answer.otherText ? `${selected.label}：${answer.otherText}` : selected.label;
  }
  if (field.type === "multiChoice") {
    const values = Array.isArray(answer?.values) ? answer.values : [];
    return values.map((value) => {
      const selected = field.options.find((item) => item.id === value);
      if (!selected) return "";
      const other = answer?.otherTextById?.[value];
      return other ? `${selected.label}：${other}` : selected.label;
    }).filter(Boolean).join("；");
  }
  if (field.type === "rating") {
    if (field.unknownOption && answer === field.unknownOption.id) return field.unknownOption.label;
    if (typeof answer !== "number") return "";
    if (options.forExport || options.forList) return String(answer);
    const short = field.labels?.[String(answer)]?.short;
    return short ? `${answer}－${short}` : String(answer);
  }
  return String(answer || "");
}

function exportHeader(field) {
  return field.unit ? `${field.label}（${field.unit}）` : field.label;
}

function exportColumns(field) {
  if (field.type !== "repeatedNumber") {
    return [{ header: exportHeader(field), value: (answer) => formatAnswer(field, answer, { forExport: true }) }];
  }
  const unit = field.unit ? `（${field.unit}）` : "";
  const columns = Array.from({ length: field.repeatCount }, (_, index) => ({
    header: `${field.label}－第${index + 1}次${unit}`,
    value: (answer) => String(Array.isArray(answer) ? answer[index] ?? "" : "")
  }));
  columns.push({
    header: `${field.label}－平均值${unit}`,
    value: (answer) => repeatedStats(answer).mean
  });
  columns.push({
    header: `${field.label}－最大差值${unit}`,
    value: (answer) => repeatedStats(answer).range
  });
  return columns;
}

async function exportXlsx() {
  if (!state.currentTemplate || !state.records.length) return;
  const fields = state.currentTemplate.fields.filter((field) => field.type !== "section");
  const columns = fields.flatMap(exportColumns);
  const headers = ["记录编号", "首次保存时间", "最后修改时间", ...columns.map((column) => column.header)];
  const rows = state.records.map((record) => [
    record.recordNumber,
    formatDateTime(record.createdAt),
    formatDateTime(record.updatedAt),
    ...fields.flatMap((field) => exportColumns(field).map((column) => column.value(record.answers[field.id])))
  ]);
  const annotationRows = [["sampleId", "recordNumber", "questionId", "view", "annotationType", "level", "strokeId", "pointOrder", "normalizedX", "normalizedY", "brushSize", "imageSrc", "imageWidth", "imageHeight"]];
  for (const record of state.records) {
    for (const field of fields.filter((item) => item.type === "imageRange")) {
      for (const stroke of imageRangeStrokes(record.answers?.[field.id])) {
        (stroke.points || []).forEach(([x, y], index) => annotationRows.push([
          record.id, record.recordNumber, field.id, field.view, stroke.annotationType || field.annotationType,
          stroke.level, stroke.id, index, x, y, stroke.brushSize, field.image.src, field.image.width, field.image.height
        ]));
      }
    }
  }
  const blob = createXlsxBlob([{ name: "Responses", rows: [headers, ...rows] }, { name: "Annotations", rows: annotationRows }]);
  const filename = sanitizeFilename(`${state.currentTemplate.title}_V${state.currentTemplate.version}_${compactDate()}_共${state.records.length}份.xlsx`);
  const file = new File([blob], filename, { type: blob.type });
  await shareOrDownload(file);
}

function sanitizeFilename(name) {
  return name.replace(/[\\/:*?"<>|]/g, "-");
}

async function shareOrDownload(file) {
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
      console.warn("系统分享失败，改用下载", error);
    }
  }
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  showToast("文件已生成，请查看系统下载内容");
}

async function makeBackupFile(prefix = "AuNote_完整备份") {
  const data = await exportDatabaseState();
  const payload = {
    format: BACKUP_FORMAT,
    backupVersion: BACKUP_VERSION,
    appVersion: APP_VERSION,
    exportedAt: nowIso(),
    data
  };
  const filename = sanitizeFilename(`${prefix}_${compactDate()}.json`);
  return new File([JSON.stringify(payload, null, 2)], filename, { type: "application/json" });
}

async function exportBackup() {
  await shareOrDownload(await makeBackupFile());
}

function validateBackup(payload) {
  if (!payload || payload.format !== BACKUP_FORMAT || payload.backupVersion !== BACKUP_VERSION) throw new Error("这不是当前工具支持的完整备份文件");
  const data = payload.data;
  for (const key of ["templates", "records", "drafts", "settings"]) {
    if (!Array.isArray(data?.[key])) throw new Error(`备份中缺少 ${key}`);
  }
  data.templates.forEach(validateTemplate);
  return data;
}

async function importTemplateFile(file) {
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch (error) {
    throw new Error(`文件“${file.name}”不是有效JSON：${error.message}`);
  }
  const input = normalizeTemplateImport(parsed);
  const template = validateTemplate(input);
  if (await getTemplate(template.key)) throw new Error("相同问卷和版本已经存在；本工具不会覆盖已有问卷");
  await putTemplate(template);
  await setSetting("currentTemplateKey", template.key);
  await refreshContext();
  await loadTemplateCounts();
  state.view = "templates";
  render();
  showToast("问卷已导入并设为当前问卷");
}

async function restoreBackupFile(file) {
  const payload = JSON.parse(await file.text());
  const data = validateBackup(payload);
  const confirmed = await showConfirm({
    title: "恢复完整备份？",
    message: "备份内容将替换当前工具中的全部问卷、记录和草稿。继续前会自动导出一份当前完整备份。",
    confirmLabel: "继续恢复"
  });
  if (!confirmed) return;

  const safetyFile = await makeBackupFile("恢复前自动备份");
  await shareOrDownload(safetyFile);
  await replaceDatabaseState(data);
  window.alert("恢复完成，工具将重新打开。");
  location.reload();
}

async function selectTemplate(key) {
  await setSetting("currentTemplateKey", key);
  clearTemplateEditorState();
  await refreshContext();
  state.view = "home";
  render();
}

async function openTemplateOverview(key) {
  const template = await getTemplate(key);
  if (!template) return;
  state.selectedTemplate = template;
  state.selectedTemplateDraft = await getDraft(key);
  if (!state.selectedTemplateDraft) {
    await beginTemplateEditor(key, "templateOverview");
    return;
  }
  if (state.editorSourceKey === key) clearTemplateEditorState();
  state.view = "templateOverview";
  render();
}

async function removeTemplate(key) {
  const template = await getTemplate(key);
  if (!template) return;
  const records = await getRecords(key);
  const draft = await getDraft(key);
  const confirmed = await showConfirm({
    title: "删除问卷？",
    message: `将永久删除“${template.title} V${template.version}”及其 ${records.length} 条已保存记录${draft ? "和1份草稿" : ""}。此操作不可撤销，请先确认已经导出需要的数据。`,
    confirmLabel: "删除问卷"
  });
  if (!confirmed) return;

  await deleteSetting(editorDraftSettingKey(key));
  await deleteTemplateCascade(key);
  const remaining = await getTemplates();
  if (state.currentTemplate?.key === key) await setSetting("currentTemplateKey", remaining[0]?.key || null);
  await refreshContext();
  await loadTemplateCounts();
  state.selectedTemplate = null;
  state.selectedTemplateDraft = null;
  state.view = "templates";
  render();
  showToast("问卷及其本地数据已删除");
}

async function openRecord(id) {
  state.selectedRecord = await getRecord(id);
  state.view = "recordDetail";
  render();
}

async function editSelectedRecord(startIndex = 0) {
  if (!state.selectedRecord) return;
  const existingDraft = await getDraft(state.currentTemplate.key);
  if (existingDraft) {
    showToast("当前问卷已有草稿，请先继续或废弃草稿");
    return;
  }
  const timestamp = nowIso();
  state.draft = {
    templateKey: state.currentTemplate.key,
    mode: "edit",
    recordId: state.selectedRecord.id,
    currentIndex: startIndex,
    answers: deepClone(state.selectedRecord.answers),
    createdAt: timestamp,
    updatedAt: timestamp
  };
  state.formIndex = startIndex;
  state.view = "form";
  render();
}

async function removeRecord(id) {
  const record = await getRecord(id);
  if (!record) return;
  const label = recordName(record);
  const confirmed = await showConfirm({
    title: "删除样本？",
    message: `将永久删除“${label}”的样本数据，此操作不可撤销。`,
    confirmLabel: "删除样本"
  });
  if (!confirmed) return;
  await deleteRecord(record.id);
  if (state.selectedRecord?.id === record.id) state.selectedRecord = null;
  await refreshContext();
  state.view = "records";
  render();
  showToast("样本已删除");
}

async function removeSelectedRecord() {
  if (!state.selectedRecord) return;
  await removeRecord(state.selectedRecord.id);
}

function closeSwipeRows(current = null) {
  app.querySelectorAll("[data-swipe-row], [data-template-row]").forEach((row) => {
    if (row === current) return;
    row.classList.remove("revealed", "dragging");
    row.querySelector(".swipe-content")?.style.removeProperty("transform");
  });
}

function bindSwipeRows() {
  const rows = Array.from(app.querySelectorAll("[data-swipe-row], [data-template-row]"));

  rows.forEach((row) => {
    const openOffset = -Math.max(48, Number(row.dataset.swipeOffset) || 116);
    const content = row.querySelector(".swipe-content");
    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let baseOffset = 0;
    let currentOffset = 0;
    let axis = null;

    const settle = (open) => {
      row.classList.remove("dragging");
      row.classList.toggle("revealed", open);
      content.style.removeProperty("transform");
      currentOffset = open ? openOffset : 0;
    };

    content.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      closeSwipeRows(row);
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      startTime = performance.now();
      baseOffset = row.classList.contains("revealed") ? openOffset : 0;
      currentOffset = baseOffset;
      axis = null;
      try {
        content.setPointerCapture?.(pointerId);
      } catch {
        // Synthetic pointer events used by automated tests do not own a real pointer.
      }
    });

    content.addEventListener("pointermove", (event) => {
      if (pointerId !== event.pointerId) return;
      const deltaX = event.clientX - startX;
      const deltaY = event.clientY - startY;
      if (!axis && Math.max(Math.abs(deltaX), Math.abs(deltaY)) > 6) axis = Math.abs(deltaX) > Math.abs(deltaY) * 1.15 ? "x" : "y";
      if (axis !== "x") return;
      event.preventDefault();
      row.classList.add("dragging");
      currentOffset = Math.max(openOffset, Math.min(0, baseOffset + deltaX));
      content.style.transform = `translateX(${currentOffset}px)`;
      if (Math.abs(deltaX) > 8) row.dataset.suppressClick = "true";
    });

    const finish = (event) => {
      if (pointerId !== event.pointerId) return;
      const elapsed = Math.max(1, performance.now() - startTime);
      const velocity = (event.clientX - startX) / elapsed;
      const open = axis === "x" ? (velocity < -0.45 || (velocity <= 0.45 && currentOffset < openOffset / 2)) : row.classList.contains("revealed");
      settle(open);
      pointerId = null;
      setTimeout(() => { delete row.dataset.suppressClick; }, 0);
    };
    content.addEventListener("pointerup", finish);
    content.addEventListener("pointercancel", (event) => {
      if (pointerId !== event.pointerId) return;
      settle(baseOffset < 0);
      pointerId = null;
      delete row.dataset.suppressClick;
    });
  });

  app.querySelector(".template-content, .records-content, .template-overview-content")?.addEventListener("scroll", () => closeSwipeRows(), { passive: true });
}

async function handleAction(action, element) {
  switch (action) {
    case "home":
      await refreshContext(); state.view = "home"; render(); break;
    case "templates":
      await loadTemplateCounts(); state.view = "templates"; render(); break;
    case "leave-template-overview": await leaveTemplateOverview(); break;
    case "open-template": await openTemplateOverview(element.dataset.key); break;
    case "duplicate-template": await duplicateQuestionnaire(element.dataset.key); break;
    case "edit-template-meta": await beginTemplateEditor(element.dataset.key, "templateMetaEditor"); break;
    case "edit-template-question": await beginTemplateEditor(element.dataset.key, "questionEditor", Number(element.dataset.index)); break;
    case "open-editor-meta": state.view = "templateMetaEditor"; render(); break;
    case "open-editor-question": await openEditorQuestion(element.dataset.index); break;
    case "editor-overview": await editorOverview(); break;
    case "leave-question-editor": await leaveQuestionEditor(); break;
    case "open-question-type-picker": await openQuestionTypePicker(element.dataset.key || null, element.dataset.mode || "add"); break;
    case "close-question-type-picker": closeQuestionTypePicker(); break;
    case "create-editor-question": await createEditorQuestion(element.dataset.type); break;
    case "change-editor-question-type": await changeEditorQuestionType(element.dataset.type); break;
    case "add-editor-option": await addEditorOption(); break;
    case "remove-editor-option": await removeEditorOption(element.dataset.index); break;
    case "delete-overview-question": await deleteOverviewQuestion(element.dataset.key, element.dataset.index); break;
    case "delete-editor-question": await deleteEditorQuestion(); break;
    case "save-template-editor": await saveTemplateEditor(); break;
    case "save-template-editor-copy": await saveTemplateEditorCopy(); break;
    case "discard-template-editor": await discardTemplateEditor(); break;
    case "leave-template-editor": await leaveTemplateEditor(); break;
    case "records":
      await refreshContext(); state.view = "records"; render(); break;
    case "analysis": await refreshContext(); state.view = "analysis"; render(); break;
    case "backup": state.view = "backup"; render(); break;
    case "import-template": templateFileInput.click(); break;
    case "select-template": await selectTemplate(element.dataset.key); break;
    case "delete-template": await removeTemplate(element.dataset.key); break;
    case "start-form": await startNewForm(); break;
    case "continue-draft":
      state.formIndex = state.draft?.currentIndex || 0; state.view = "form"; render(); break;
    case "discard-draft":
      if (await showConfirm({ title: "废弃草稿？", message: "当前草稿数据将被永久删除，此操作不可撤销。", confirmLabel: "废弃草稿" })) {
        await deleteDraft(state.currentTemplate.key); await refreshContext(); render(); showToast("草稿已废弃");
      }
      break;
    case "leave-form":
      if (state.draft?.mode === "edit") await saveEditedRecord();
      else { captureCurrentPage(); await persistDraft(); await refreshContext(); state.view = "home"; render(); showToast("草稿已保存"); }
      break;
    case "previous-question": await moveQuestion(-1); break;
    case "next-question": await moveQuestion(1); break;
    case "open-record": await openRecord(element.dataset.id); break;
    case "edit-record": await editSelectedRecord(); break;
    case "edit-record-at": await editSelectedRecord(Number(element.dataset.fieldIndex) || 0); break;
    case "delete-record": await removeSelectedRecord(); break;
    case "delete-record-by-id": await removeRecord(element.dataset.id); break;
    case "export-xlsx": await exportXlsx(); break;
    case "check-update": await checkForUpdates(); break;
    case "export-backup": await exportBackup(); break;
    case "import-backup": backupFileInput.click(); break;
    case "select-single": await selectSingle(element.dataset.option, Number(element.dataset.fieldIndex)); break;
    case "toggle-multi": await toggleMulti(element.dataset.option, Number(element.dataset.fieldIndex)); break;
    case "select-rating": await selectRating(element.dataset.value, Number(element.dataset.fieldIndex)); break;
  }
}

async function selectSingle(optionId, fieldIndex = state.formIndex) {
  captureCurrentPage();
  const field = state.currentTemplate.fields[fieldIndex];
  const previous = state.draft.answers[field.id];
  state.draft.answers[field.id] = { value: optionId, otherText: previous?.value === optionId ? previous.otherText || "" : "" };
  await persistDraft();
  render();
  if (field.options.find((item) => item.id === optionId)?.textInput) requestAnimationFrame(() => app.querySelector(`[data-question-index="${fieldIndex}"] [data-other-input]`)?.focus());
}

async function toggleMulti(optionId, fieldIndex = state.formIndex) {
  captureCurrentPage();
  const field = state.currentTemplate.fields[fieldIndex];
  const answer = state.draft.answers[field.id] || { values: [], otherTextById: {} };
  const option = field.options.find((item) => item.id === optionId);
  let values = Array.isArray(answer.values) ? [...answer.values] : [];
  if (values.includes(optionId)) {
    values = values.filter((value) => value !== optionId);
  } else if (option?.exclusive) {
    values = [optionId];
  } else {
    const exclusiveIds = new Set(field.options.filter((item) => item.exclusive).map((item) => item.id));
    values = values.filter((value) => !exclusiveIds.has(value));
    values.push(optionId);
  }
  state.draft.answers[field.id] = { values, otherTextById: answer.otherTextById || {} };
  await persistDraft();
  render();
}

async function selectRating(rawValue, fieldIndex = state.formIndex) {
  const numeric = Number(rawValue);
  const value = Number.isFinite(numeric) && rawValue.trim() !== "" ? numeric : rawValue;
  captureCurrentPage();
  const field = state.currentTemplate.fields[fieldIndex];
  state.draft.answers[field.id] = value;
  await persistDraft();
  render();
}

confirmCancel.addEventListener("click", () => closeConfirm(false));
confirmSubmit.addEventListener("click", () => closeConfirm(true));
confirmOverlay.addEventListener("click", (event) => {
  if (event.target === confirmOverlay) closeConfirm(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!confirmOverlay.hidden) closeConfirm(false);
  else if (state.questionTypePickerOpen) closeQuestionTypePicker();
});

app.addEventListener("click", async (event) => {
  if (!event.target.closest(".swipe-action, .swipe-row.revealed")) closeSwipeRows();
  if (state.questionTypePickerOpen && !event.target.closest(".question-type-dialog, .editor-type-popover")) {
    event.preventDefault();
    closeQuestionTypePicker();
    return;
  }
  const element = event.target.closest("[data-action]");
  if (!element || element.disabled || state.actionBusy) return;
  if (element.closest("[data-swipe-row], [data-template-row]")?.dataset.suppressClick === "true") {
    event.preventDefault();
    return;
  }
  if (element.closest("[data-editor-field-id]")?.dataset.suppressClick === "true") {
    event.preventDefault();
    return;
  }
  state.actionBusy = true;
  try {
    await handleAction(element.dataset.action, element);
  } catch (error) {
    console.error(error);
    showToast(error?.message || "操作失败");
  } finally {
    state.actionBusy = false;
  }
});

app.addEventListener("input", (event) => {
  if (state.view === "templateMetaEditor") {
    captureTemplateMetaEditor();
    persistTemplateEditorDraft().catch(console.error);
    return;
  }
  if (state.view === "questionEditor") {
    captureQuestionEditor();
    return;
  }
  if (state.view !== "form") return;
  captureCurrentPage();
  const repeatedContainer = event?.target?.closest?.("[data-question-index]");
  const fieldIndex = Number(repeatedContainer?.dataset.questionIndex ?? state.formIndex);
  const field = state.currentTemplate.fields[fieldIndex];
  if (field?.type === "repeatedNumber") {
    const summary = repeatedContainer?.querySelector("[data-repeated-summary]");
    const answer = state.draft.answers[field.id];
    if (summary) {
      summary.innerHTML = repeatedSummaryHtml(field, answer);
      summary.hidden = validRepeatedValues(answer).length === 0;
    }
  }
  persistDraft().catch(console.error);
});

app.addEventListener("change", async (event) => {
  if (state.view === "questionEditor" && event.target.matches("[data-option-text-input], [data-field-rating-min], [data-field-rating-max]")) {
    captureQuestionEditor();
    renderQuestionEditor();
    return;
  }
  if (state.view !== "form" || !event.target.matches("[data-anonymous]")) return;
  const fieldIndex = Number(event.target.dataset.fieldIndex ?? state.formIndex);
  captureFieldAt(fieldIndex);
  const field = state.currentTemplate.fields[fieldIndex];
  if (event.target.checked) state.draft.answers[field.id].value = "";
  await persistDraft();
  render();
});

templateFileInput.addEventListener("change", async () => {
  const [file] = templateFileInput.files;
  templateFileInput.value = "";
  if (!file) return;
  try {
    await importTemplateFile(file);
  } catch (error) {
    console.error(error);
    window.alert(`问卷导入失败：${error.message}`);
  }
});

backupFileInput.addEventListener("change", async () => {
  const [file] = backupFileInput.files;
  backupFileInput.value = "";
  if (!file) return;
  try {
    await restoreBackupFile(file);
  } catch (error) {
    console.error(error);
    window.alert(`恢复失败：${error.message}`);
  }
});

function askWorkerInfo(worker) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve({ version: "新版", summary: "本次更新包含功能改进和问题修复。" }), 1000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve({
        version: event.data?.version || "新版",
        summary: event.data?.summary || "本次更新包含功能改进和问题修复。"
      });
    };
    worker.postMessage({ type: "GET_VERSION_INFO" }, [channel.port2]);
  });
}

function closeUpdateDialog() {
  updateDialog.hidden = true;
  document.body.classList.remove("dialog-open");
}

async function showUpdate(worker, { manual = false, info = null } = {}) {
  const workerInfo = info || await askWorkerInfo(worker);
  const skippedVersion = await getSetting("skippedAppVersion", null);
  if (!manual && (skippedVersion === workerInfo.version || state.dismissedUpdateVersion === workerInfo.version)) return;
  if (state.view === "form") {
    state.deferredUpdate = { worker, info: workerInfo };
    return;
  }
  state.deferredUpdate = null;
  state.waitingWorker = worker;
  state.waitingWorkerInfo = workerInfo;
  updateTitle.textContent = `发现新版本 V${workerInfo.version}`;
  updateSummary.textContent = workerInfo.summary;
  updateDialog.hidden = false;
  document.body.classList.add("dialog-open");
}

async function checkForUpdates() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) {
    showToast("当前环境不支持程序更新检查");
    return;
  }

  showToast("正在检查更新…");
  try {
    const registration = state.serviceWorkerRegistration
      || await navigator.serviceWorker.getRegistration("./")
      || await navigator.serviceWorker.register("./sw.js");
    state.serviceWorkerRegistration = registration;
    await registration.update();

    if (registration.waiting) {
      await showUpdate(registration.waiting, { manual: true });
      return;
    }
    if (registration.installing) {
      showToast("正在准备新版本，完成后会显示更新提示");
      return;
    }
    showToast(`当前已是最新版本 V${APP_VERSION}`);
  } catch (error) {
    console.error(error);
    showToast("无法检查更新，请确认网络连接后重试");
  }
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  const registration = await navigator.serviceWorker.register("./sw.js");
  state.serviceWorkerRegistration = registration;
  if (registration.waiting) await showUpdate(registration.waiting);

  registration.addEventListener("updatefound", () => {
    const worker = registration.installing;
    worker?.addEventListener("statechange", () => {
      if (worker.state === "installed" && navigator.serviceWorker.controller) showUpdate(worker).catch(console.error);
    });
  });

  navigator.serviceWorker.addEventListener("controllerchange", () => location.reload());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") registration.update().catch(console.error);
  });
}

updateLater.addEventListener("click", () => {
  state.dismissedUpdateVersion = state.waitingWorkerInfo?.version || null;
  closeUpdateDialog();
});

updateSkip.addEventListener("click", async () => {
  const version = state.waitingWorkerInfo?.version;
  if (version) await setSetting("skippedAppVersion", version);
  closeUpdateDialog();
  showToast(version ? `已跳过 V${version}` : "已跳过这个版本");
});

updateButton.addEventListener("click", () => {
  if (state.view === "form") {
    showToast("请先返回首页，草稿保存后再更新");
    return;
  }
  closeUpdateDialog();
  state.waitingWorker?.postMessage({ type: "SKIP_WAITING" });
});

async function initialize() {
  await openDatabase();
  await seedDefaultTemplate();
  await refreshContext();
  render();
  registerServiceWorker().catch(console.error);
  navigator.storage?.persist?.().catch(() => false);
}

initialize().catch(fatalError);
