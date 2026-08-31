import {
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
  replaceDatabaseState,
  setSetting
} from "./db.js";
import { ANALYSIS_PRESETS, BUILT_IN_TEMPLATES, DEFAULT_TEMPLATE, templateKey } from "./default-template.js";

const APP_VERSION = "1.1.3";
const BACKUP_FORMAT = "research-notebook-backup";
const BACKUP_VERSION = 1;
const ICON_ARROW_LEFT = "./assets/arrow-left.svg";
const ICON_CHEVRON_RIGHT = "./assets/chevron-right.svg";
const ICON_TRASH = "./assets/trash.svg";
const ANALYSIS_THEMES = {
  blue: { base: "#2b6ea8", fill: "rgba(43, 110, 168, 0.22)" },
  orange: { base: "#c66a2b", fill: "rgba(198, 106, 43, 0.22)" }
};
const SUPPORTED_FIELD_TYPES = new Set([
  "shortText",
  "longText",
  "number",
  "repeatedNumber",
  "singleChoice",
  "multiChoice",
  "rating",
  "section"
]);

const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
const templateFileInput = document.querySelector("#template-file-input");
const backupFileInput = document.querySelector("#backup-file-input");
const updateBanner = document.querySelector("#update-banner");
const updateMessage = document.querySelector("#update-message");
const updateButton = document.querySelector("#update-button");
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
  formIndex: 0,
  templateCounts: {},
  waitingWorker: null,
  serviceWorkerRegistration: null,
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

function showToast(message, duration = 2600) {
  clearTimeout(state.toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  state.toastTimer = setTimeout(() => {
    toast.hidden = true;
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

function showConfirm({ title, message, confirmLabel = "确认" }) {
  if (confirmResolver) closeConfirm(false);
  confirmTitle.textContent = title;
  confirmMessage.textContent = message;
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

function validateTemplate(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("问卷JSON的最外层必须是一个对象");
  if (input.schemaVersion !== 1) throw new Error("目前只支持 schemaVersion 为 1 的问卷模板");
  for (const key of ["id", "version", "title"]) {
    if (typeof input[key] !== "string" || !input[key].trim()) throw new Error(`问卷缺少有效的 ${key}`);
  }
  if (!Array.isArray(input.fields) || input.fields.length === 0) throw new Error("问卷至少需要一道题目");

  const ids = new Set();
  input.fields.forEach((field, index) => {
    if (!field || typeof field !== "object") throw new Error(`第${index + 1}项不是有效题目`);
    if (typeof field.id !== "string" || !field.id.trim()) throw new Error(`第${index + 1}项缺少题目ID`);
    if (ids.has(field.id)) throw new Error(`题目ID重复：${field.id}`);
    ids.add(field.id);
    if (!SUPPORTED_FIELD_TYPES.has(field.type)) throw new Error(`不支持的题型：${field.type}`);
    if (typeof field.label !== "string" || !field.label.trim()) throw new Error(`题目 ${field.id} 缺少标题`);

    if (["singleChoice", "multiChoice"].includes(field.type)) {
      if (!Array.isArray(field.options) || field.options.length === 0) throw new Error(`题目 ${field.label} 缺少选项`);
      const optionIds = new Set();
      for (const option of field.options) {
        if (!option.id || !option.label) throw new Error(`题目 ${field.label} 存在无效选项`);
        if (optionIds.has(option.id)) throw new Error(`题目 ${field.label} 的选项ID重复`);
        optionIds.add(option.id);
      }
    }

    if (field.type === "rating") {
      if (!Number.isInteger(field.min) || !Number.isInteger(field.max) || field.min >= field.max) {
        throw new Error(`评分题 ${field.label} 的分值范围无效`);
      }
    }

    if (field.type === "repeatedNumber") {
      if (!Number.isInteger(field.repeatCount) || field.repeatCount < 2 || field.repeatCount > 10) {
        throw new Error(`重复数字题 ${field.label} 的填写次数必须是2至10`);
      }
      const minEntries = field.minEntries ?? (field.required ? 1 : 0);
      if (!Number.isInteger(minEntries) || minEntries < 0 || minEntries > field.repeatCount) {
        throw new Error(`重复数字题 ${field.label} 的最少填写数量无效`);
      }
    }

    if (field.image?.src) {
      const src = String(field.image.src);
      if (!src.startsWith("data:image/") && !src.startsWith("./assets/")) {
        throw new Error(`题目 ${field.label} 的图片必须嵌入JSON，不能依赖外部网址`);
      }
    }
  });

  if (input.analysis !== undefined) validateAnalysisConfig(input.analysis, input.fields);

  const template = deepClone(input);
  template.key = templateKey(template);
  template.importedAt = template.importedAt || nowIso();
  return template;
}

function validateAnalysisConfig(config, fields) {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("简易分析配置必须是一个对象");
  if (config.type !== "distribution") throw new Error("目前只支持 distribution 分布分析");
  if (config.aggregation !== "participantMean") throw new Error("分布分析必须按参与者平均值汇总");
  if (!Number.isFinite(config.binWidth) || config.binWidth <= 0) throw new Error("分布分析的区间宽度必须大于0");
  if (!Array.isArray(config.percentiles) || !config.percentiles.length || config.percentiles.some((value) => !Number.isFinite(value) || value <= 0 || value >= 100)) {
    throw new Error("分布分析的百分位设置无效");
  }
  if (!Array.isArray(config.fields) || !config.fields.length) throw new Error("分布分析至少需要一个数字题");
  const fieldMap = new Map(fields.map((field) => [field.id, field]));
  for (const item of config.fields) {
    const field = fieldMap.get(item?.id);
    if (!field || !["number", "repeatedNumber"].includes(field.type)) throw new Error(`简易分析字段无效：${item?.id || "未命名"}`);
    if (item.label !== undefined && (typeof item.label !== "string" || !item.label.trim())) throw new Error(`简易分析字段 ${item.id} 的标题无效`);
    if (item.theme !== undefined && !ANALYSIS_THEMES[item.theme]) throw new Error(`简易分析字段 ${item.id} 的主题色无效`);
  }
}

function analysisConfig(template) {
  if (!template) return null;
  return template.analysis || ANALYSIS_PRESETS[template.key] || null;
}

async function seedDefaultTemplate() {
  const wasSeeded = await getSetting("defaultTemplateSeeded", false);
  const seedRevision = await getSetting("builtInTemplateSeedRevision", wasSeeded ? 1 : 0);
  if (seedRevision < 2) {
    const templatesToAdd = seedRevision >= 1 ? [DEFAULT_TEMPLATE] : BUILT_IN_TEMPLATES;
    for (const source of templatesToAdd) {
      const template = validateTemplate(source);
      if (!(await getTemplate(template.key))) await putTemplate(template);
    }

    const latest = validateTemplate(DEFAULT_TEMPLATE);
    const currentKey = await getSetting("currentTemplateKey", null);
    const current = currentKey ? await getTemplate(currentKey) : null;
    const legacyKey = templateKey(BUILT_IN_TEMPLATES[0]);
    const legacyDraft = currentKey === legacyKey ? await getDraft(legacyKey) : null;
    if (!current || (currentKey === legacyKey && !legacyDraft)) {
      await setSetting("currentTemplateKey", latest.key);
    }
  }

  if (seedRevision < 3) {
    for (const source of BUILT_IN_TEMPLATES) {
      const sourceTemplate = validateTemplate(source);
      const storedTemplate = await getTemplate(sourceTemplate.key);
      if (!storedTemplate || storedTemplate.title === sourceTemplate.title) continue;
      const storedStructure = storedTemplate.fields.map((field) => [field.id, field.type]);
      const sourceStructure = sourceTemplate.fields.map((field) => [field.id, field.type]);
      if (JSON.stringify(storedStructure) === JSON.stringify(sourceStructure)) {
        await putTemplate({ ...storedTemplate, title: sourceTemplate.title });
      }
    }
  }

  if (seedRevision < 4) {
    const sourceTemplate = validateTemplate(DEFAULT_TEMPLATE);
    const storedTemplate = await getTemplate(sourceTemplate.key);
    const sourceField = sourceTemplate.fields.find((field) => field.id === "openEarPreference");
    const sourceOption = sourceField?.options?.find((option) => option.id === "noPreference");
    const storedField = storedTemplate?.fields?.find((field) => field.id === "openEarPreference");
    const hasOption = storedField?.options?.some((option) => option.id === "noPreference");
    if (storedTemplate && storedField && sourceOption && !hasOption) {
      await putTemplate({
        ...storedTemplate,
        fields: storedTemplate.fields.map((field) => field.id === "openEarPreference"
          ? { ...field, options: [...field.options, deepClone(sourceOption)] }
          : field)
      });
    }
  }

  await setSetting("defaultTemplateSeeded", true);
  await setSetting("builtInTemplateSeedRevision", 4);
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
  state.analysisResizeObserver?.disconnect();
  state.analysisResizeObserver = null;
  switch (state.view) {
    case "templates": renderTemplates(); break;
    case "templateOverview": renderTemplateOverview(); break;
    case "records": renderRecords(); break;
    case "recordDetail": renderRecordDetail(); break;
    case "analysis": renderAnalysis(); break;
    case "form": renderForm(); break;
    case "backup": renderBackup(); break;
    default: renderHome();
  }
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
    ? `<span class="hero-version">上次编辑：${escapeHtml(formatDateTime(state.draft.updatedAt))} · 已填写至第 ${Number(state.draft.currentIndex || 0) + 1} 项</span>`
    : `<span class="hero-version">问卷版本 V${escapeHtml(state.currentTemplate.version)}</span>`;
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
            <span>已记录问卷</span>
            <span class="count-value">${state.records.length} 份</span>
            <img src="${ICON_CHEVRON_RIGHT}" alt="" width="16" height="16" />
          </button>
        </div>
        <div class="home-actions">
          ${draftButtons}
          ${currentAnalysis ? `<button class="secondary-button" type="button" data-action="analysis" ${state.records.length ? "" : "disabled"}>简易分析</button>` : ""}
          <button class="secondary-button" type="button" data-action="export-csv" ${state.records.length ? "" : "disabled"}>导出 CSV 数据</button>
        </div>
      </div>
      <footer class="home-footer">
        <button class="text-button" data-action="backup" type="button">数据备份/恢复</button>
        <button class="text-button" data-action="check-update" type="button">检查更新</button>
      </footer>
    </section>`;
}

function renderTemplates() {
  const items = state.templates.map((template) => {
    const isCurrent = template.key === state.currentTemplate?.key;
    const count = state.templateCounts[template.key] ?? 0;
    return `
      <div class="swipe-row" data-template-row="${escapeHtml(template.key)}">
        <button class="swipe-delete" type="button" data-action="delete-template" data-key="${escapeHtml(template.key)}" aria-label="删除${escapeHtml(template.title)} V${escapeHtml(template.version)}"><img src="${ICON_TRASH}" alt="" width="20" height="20" /></button>
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
        ${items ? '<p class="swipe-hint">提示：向左滑动问卷条目可呼出删除操作</p>' : ""}
      </div>
      <footer class="template-footer">
        <button class="secondary-button" type="button" data-action="import-template">导入问卷 JSON</button>
        <p>不同版本独立保存，导入不会覆盖已有数据</p>
      </footer>
    </section>`;
  bindSwipeRows();
}

function fieldTypeLabel(field) {
  const labels = {
    shortText: "短文字",
    longText: "长文字",
    number: "数字",
    repeatedNumber: "重复测量",
    singleChoice: "单选",
    multiChoice: "多选",
    rating: "评分",
    section: "说明"
  };
  return labels[field.type] || field.type;
}

function renderTemplateOverview() {
  const template = state.selectedTemplate;
  if (!template) {
    state.view = "templates";
    renderTemplates();
    return;
  }
  const isCurrent = template.key === state.currentTemplate?.key;
  const count = state.templateCounts[template.key] ?? 0;
  const config = analysisConfig(template);
  let questionNumber = 0;
  const questions = template.fields.map((field) => {
    if (field.type === "section") {
      return `<section class="overview-section"><h3>${escapeHtml(field.label)}</h3>${field.description ? `<p>${escapeHtml(field.description)}</p>` : ""}</section>`;
    }
    questionNumber += 1;
    const options = ["singleChoice", "multiChoice"].includes(field.type)
      ? `<p class="overview-options">${field.options.map((option) => escapeHtml(option.label)).join(" · ")}</p>`
      : "";
    const repeat = field.type === "repeatedNumber" ? ` · 可填写${field.minEntries || 1}至${field.repeatCount}次` : "";
    return `
      <article class="overview-question">
        <div class="overview-question-heading"><span>Q${questionNumber}. ${escapeHtml(field.label)}</span><small>${field.required ? "必填" : "可跳过"}</small></div>
        <p class="overview-question-type">${escapeHtml(fieldTypeLabel(field))}${escapeHtml(repeat)}${field.unit ? ` · ${escapeHtml(field.unit)}` : ""}</p>
        ${field.description ? `<p>${escapeHtml(field.description)}</p>` : ""}
        ${options}
      </article>`;
  }).join("");
  const startLabel = state.selectedTemplateDraft ? (state.selectedTemplateDraft.mode === "edit" ? "继续修改" : "继续填写") : "开始填写";

  app.innerHTML = `
    <section class="screen template-overview-screen">
      ${pageHeader("问卷概览", "templates")}
      <div class="page-content template-overview-content">
        <div class="overview-summary">
          <div class="overview-title-row"><h2>${escapeHtml(template.title)}</h2><span>V${escapeHtml(template.version)}</span></div>
          <p>${escapeHtml(template.description || "暂无问卷说明")}</p>
          <div class="overview-meta"><span>${count}份记录</span>${isCurrent ? '<span class="current-chip">当前问卷</span>' : ""}${config ? '<span class="analysis-chip">支持简易分析</span>' : ""}</div>
        </div>
        <div class="overview-question-list">${questions}</div>
        <button class="overview-delete-link" type="button" data-action="delete-template" data-key="${escapeHtml(template.key)}">删除此问卷</button>
      </div>
      <footer class="overview-footer"><button class="primary-button" type="button" data-action="start-template" data-key="${escapeHtml(template.key)}">${startLabel}</button></footer>
    </section>`;
}

function recordName(record) {
  const field = state.currentTemplate?.fields.find((item) => item.id === "name");
  const value = field ? formatAnswer(field, record.answers[field.id], { forList: true }) : "";
  return value || "未填写姓名";
}

function simpleAnswer(record, fieldId) {
  const field = state.currentTemplate?.fields.find((item) => item.id === fieldId);
  return field ? formatAnswer(field, record.answers[fieldId], { forList: true }) : "";
}

function renderRecords() {
  const records = state.records.map((record) => `
    <button class="record-card" type="button" data-action="open-record" data-id="${escapeHtml(record.id)}">
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
    </button>`).join("");

  app.innerHTML = `
    <section class="screen">
      ${pageHeader("已保存记录")}
      <div class="page-content records-content">
        <p class="section-title">${escapeHtml(state.currentTemplate?.title || "")} · 最早记录在上</p>
        <div class="record-list">${records || '<div class="empty-state card">还没有已完成记录</div>'}</div>
      </div>
    </section>`;
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
          <span class="detail-label">${displayIndex}. ${escapeHtml(field.label)}</span>
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
        <button class="primary-button" type="button" data-action="edit-record">编辑记录</button>
        <button class="danger-button" type="button" data-action="delete-record">删除记录</button>
      </div>
    </section>`;
}

function getFieldAnswer(field) {
  return state.draft?.answers?.[field.id];
}

function renderTextField(field, answer, long = false) {
  const data = field.allowAnonymous && typeof answer === "object" ? answer : { value: answer ?? "", anonymous: false };
  const input = long
    ? `<textarea class="textarea-input" data-field-input autocomplete="off" placeholder="${escapeHtml(field.placeholder || "")}">${escapeHtml(data.value || "")}</textarea>`
    : `<input class="text-input" data-field-input type="text" inputmode="text" autocomplete="off" value="${escapeHtml(data.value || "")}" placeholder="${escapeHtml(field.placeholder || "")}" ${data.anonymous ? "disabled" : ""} />`;
  const anonymous = field.allowAnonymous
    ? `<label class="anonymous-row"><input type="checkbox" data-anonymous ${data.anonymous ? "checked" : ""} /><span>${escapeHtml(field.anonymousLabel || "匿名")}</span></label>`
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

function quantile(sortedValues, percentile) {
  if (!sortedValues.length) return null;
  if (sortedValues.length === 1) return sortedValues[0];
  const position = (sortedValues.length - 1) * (percentile / 100);
  const lower = Math.floor(position);
  const fraction = position - lower;
  return sortedValues[lower] + (sortedValues[Math.min(lower + 1, sortedValues.length - 1)] - sortedValues[lower]) * fraction;
}

function analysisValue(field, answer) {
  if (field.type === "number") {
    const value = Number(answer);
    return Number.isFinite(value) ? value : null;
  }
  if (field.type === "repeatedNumber") {
    const values = validRepeatedValues(answer).map(Number).filter(Number.isFinite);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  }
  return null;
}

function fieldDistribution(template, records, fieldId) {
  const field = template.fields.find((item) => item.id === fieldId);
  if (!field) return [];
  return records.map((record) => analysisValue(field, record.answers?.[fieldId])).filter(Number.isFinite).sort((a, b) => a - b);
}

function sampleStandardDeviation(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (values.length - 1));
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

function distributionModel(values, binWidth) {
  const minimum = values[0];
  const maximum = values[values.length - 1];
  let start = Math.floor(minimum / binWidth) * binWidth;
  let end = Math.ceil(maximum / binWidth) * binWidth;
  if (end <= start) end = start + binWidth;
  start -= binWidth * 0.5;
  end += binWidth * 0.5;
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
  return { values, start, end, bins, curve, bandwidth };
}

function drawDistributionChart(svg, values, config, field, theme) {
  const bounds = svg.getBoundingClientRect();
  const width = Math.max(280, Math.round(bounds.width));
  const height = Math.max(250, Math.round(bounds.height));
  const margin = { top: 42, right: 18, bottom: 42, left: 42 };
  const plot = { left: margin.left, top: margin.top, right: width - margin.right, bottom: height - margin.bottom };
  const model = distributionModel(values, config.binWidth);
  const peak = Math.max(...model.bins.map((bin) => bin.count), ...model.curve.map((point) => point.y), 1);
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
      elements.push(`<text x="${x + barWidth / 2}" y="${Math.max(plot.top + 8, y - 9)}" fill="#1f2937" font-size="11" text-anchor="middle" dominant-baseline="middle" style="${textStyle}">${bin.count}人</text>`);
    }
  });

  if (model.curve.length) {
    const path = model.curve.map((point, index) => `${index ? "L" : "M"}${xScale(point.x).toFixed(2)} ${yScale(point.y).toFixed(2)}`).join(" ");
    elements.push(`<path d="${path}" fill="none" stroke="${theme.base}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />`);
  }

  const percentileGroups = config.percentiles.map((percentile) => {
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
    elements.push(`<text x="${x}" y="${13 + (index % 2) * 14}" fill="${theme.base}" font-size="10" font-weight="600" text-anchor="middle" dominant-baseline="middle" style="${textStyle}">${group.percentiles.map((value) => `P${value}`).join("/")} ${group.value.toFixed(2)}</text>`);
  });

  for (let index = 0; index <= 4; index += 1) {
    const value = model.start + (model.end - model.start) * index / 4;
    elements.push(`<text x="${xScale(value)}" y="${plot.bottom + 18}" fill="#6b7280" font-size="11" text-anchor="middle" dominant-baseline="middle" style="${textStyle}">${value.toFixed(1)}</text>`);
  }
  elements.push(`<text x="12" y="${(plot.top + plot.bottom) / 2}" fill="#6b7280" font-size="11" text-anchor="middle" dominant-baseline="middle" transform="rotate(-90 12 ${(plot.top + plot.bottom) / 2})" style="${textStyle}">人数</text>`);
  elements.push(`<text x="${(plot.left + plot.right) / 2}" y="${height - 9}" fill="#6b7280" font-size="11" text-anchor="middle" dominant-baseline="middle" style="${textStyle}">耳厚（${escapeHtml(field.unit || "数值")}）</text>`);

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.innerHTML = `<title>${escapeHtml(field.label)}分布图</title>${elements.join("")}`;

  return { ...model, plot, width, height, xScale, unit: field.unit || "" };
}

function initializeAnalysisCharts(config) {
  const redrawers = [];
  app.querySelectorAll("[data-analysis-chart]").forEach((chart) => {
    const item = config.fields[Number(chart.dataset.analysisChart)];
    const field = state.currentTemplate.fields.find((candidate) => candidate.id === item.id);
    const values = fieldDistribution(state.currentTemplate, state.records, item.id);
    const theme = ANALYSIS_THEMES[item.theme] || ANALYSIS_THEMES.blue;
    const redraw = () => {
      if (!chart.isConnected || !values.length) return;
      drawDistributionChart(chart, values, config, field, theme);
    };
    redrawers.push(redraw);
    redraw();
  });
  state.analysisResizeObserver = new ResizeObserver(() => redrawers.forEach((redraw) => redraw()));
  app.querySelectorAll(".chart-stage").forEach((stage) => state.analysisResizeObserver.observe(stage));
}

function renderAnalysis() {
  const config = analysisConfig(state.currentTemplate);
  if (!config) {
    state.view = "home";
    renderHome();
    showToast("当前问卷没有配置简易分析");
    return;
  }
  const charts = config.fields.map((item, index) => {
    const field = state.currentTemplate.fields.find((candidate) => candidate.id === item.id);
    const values = fieldDistribution(state.currentTemplate, state.records, item.id);
    const themeName = ANALYSIS_THEMES[item.theme] ? item.theme : "blue";
    const theme = ANALYSIS_THEMES[themeName];
    if (!field || !values.length) {
      return `<section class="analysis-chart-card"><h2>${escapeHtml(item.label || field?.label || item.id)}</h2><div class="analysis-empty">还没有可用于分析的数据</div></section>`;
    }
    const percentileText = config.percentiles.map((percentile) => `P${percentile} ${quantile(values, percentile).toFixed(2)} ${field.unit || ""}`).join(" · ");
    return `
      <section class="analysis-chart-card" data-chart-theme="${themeName}" style="--chart-color:${theme.base};--chart-fill:${theme.fill}">
        <div class="analysis-chart-heading"><h2>${escapeHtml(item.label || field.label)}</h2><p>每名参与者先取测量平均值，再只计入一次；柱形为实际人数${values.length > 1 ? "，曲线用于观察分布形状" : "；记录较少时暂不绘制分布曲线"}。</p></div>
        <div class="chart-legend"><span class="legend-bar">实际人数</span>${values.length > 1 ? '<span class="legend-line">KDE 分布曲线</span>' : ""}</div>
        <div class="chart-stage">
          <svg xmlns="http://www.w3.org/2000/svg" data-analysis-chart="${index}" role="img" aria-label="${escapeHtml(item.label || field.label)}，${escapeHtml(percentileText)}" preserveAspectRatio="none"></svg>
        </div>
        <p class="percentile-summary">${escapeHtml(percentileText)}</p>
      </section>`;
  }).join("");
  app.innerHTML = `
    <section class="screen analysis-screen">
      ${pageHeader("简易分析")}
      <div class="page-content analysis-content">
        <p class="analysis-help">图表显示实际人数、KDE 分布曲线及 P20、P50、P80。横屏时图表会自动放大。</p>
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

function renderSingleChoice(field, answer) {
  const current = answer && typeof answer === "object" ? answer : { value: "", otherText: "" };
  return `<div class="choice-list">${field.options.map((option) => {
    const selected = current.value === option.id;
    return `
      <button class="choice-button ${selected ? "selected" : ""}" type="button" data-action="select-single" data-option="${escapeHtml(option.id)}">${escapeHtml(option.label)}</button>
      ${selected && option.textInput ? `<input class="other-input" data-other-input type="text" inputmode="text" autocomplete="off" value="${escapeHtml(current.otherText || "")}" placeholder="${escapeHtml(option.textInput.placeholder || "")}" aria-label="${escapeHtml(option.textInput.label || "其他说明")}" />` : ""}`;
  }).join("")}</div>`;
}

function renderMultiChoice(field, answer) {
  const current = answer && typeof answer === "object" ? answer : { values: [], otherTextById: {} };
  const selectedValues = Array.isArray(current.values) ? current.values : [];
  return `<div class="choice-list ${field.image?.src ? "choice-grid" : ""}">${field.options.map((option) => {
    const selected = selectedValues.includes(option.id);
    return `
      <button class="choice-button multi ${option.exclusive ? "choice-exclusive" : ""} ${selected ? "selected" : ""}" type="button" data-action="toggle-multi" data-option="${escapeHtml(option.id)}">${escapeHtml(option.label)}</button>
      ${selected && option.textInput ? `<input class="other-input" data-other-input data-option="${escapeHtml(option.id)}" type="text" inputmode="text" autocomplete="off" value="${escapeHtml(current.otherTextById?.[option.id] || "")}" placeholder="${escapeHtml(option.textInput.placeholder || "")}" />` : ""}`;
  }).join("")}</div>`;
}

function renderRating(field, answer) {
  const values = [];
  for (let value = field.min; value <= field.max; value += 1) values.push(value);
  const selectedHelp = typeof answer === "number" ? field.labels?.[String(answer)]?.help : "";
  return `
    <div class="rating-grid">
      ${values.map((value) => `<button class="rating-button ${answer === value ? "selected" : ""}" type="button" data-action="select-rating" data-value="${value}"><strong>${value}</strong><span>${escapeHtml(field.labels?.[String(value)]?.short || "")}</span></button>`).join("")}
    </div>
    ${selectedHelp ? `<div class="rating-help">${escapeHtml(selectedHelp)}</div>` : ""}
    ${field.unknownOption ? `<button class="choice-button unknown-button ${answer === field.unknownOption.id ? "selected" : ""}" type="button" data-action="select-rating" data-value="${escapeHtml(field.unknownOption.id)}">${escapeHtml(field.unknownOption.label)}</button>` : ""}`;
}

function renderFieldControl(field, answer) {
  switch (field.type) {
    case "shortText": return renderTextField(field, answer, false);
    case "longText": return renderTextField(field, answer, true);
    case "number": return renderNumberField(field, answer);
    case "repeatedNumber": return renderRepeatedNumberField(field, answer);
    case "singleChoice": return renderSingleChoice(field, answer);
    case "multiChoice": return renderMultiChoice(field, answer);
    case "rating": return renderRating(field, answer);
    case "section": return `<div class="card">${escapeHtml(field.description || "")}</div>`;
    default: return "";
  }
}

function renderForm() {
  if (!state.currentTemplate || !state.draft) {
    state.view = "home";
    renderHome();
    return;
  }

  const fields = state.currentTemplate.fields;
  state.formIndex = Math.max(0, Math.min(state.formIndex, fields.length - 1));
  const field = fields[state.formIndex];
  const progress = ((state.formIndex + 1) / fields.length) * 100;
  const isLast = state.formIndex === fields.length - 1;
  const answer = getFieldAnswer(field);
  const requirementLabel = field.required ? "必填" : "可跳过";

  app.innerHTML = `
    <section class="screen form-screen">
      <header class="nav-top-bar form-top-bar">
        <button class="back-button" type="button" data-action="leave-form" aria-label="返回首页"><img src="${ICON_ARROW_LEFT}" alt="" width="20" height="20" /></button>
        <h1>${state.draft.mode === "edit" ? "修改记录" : "填写问卷"}</h1>
        <span class="form-counter">${state.formIndex + 1}/${fields.length}</span>
      </header>
      <div class="progress-block">
        <div class="progress-track"><div class="progress-fill" style="width:${progress}%"></div></div>
      </div>
      <article class="question-card">
        <div class="question-meta"><span class="question-number">Q${state.formIndex + 1}.</span><span class="requirement-chip ${field.required ? "is-required" : ""}">${requirementLabel}</span></div>
        <h2 class="question-title">${escapeHtml(field.label)}</h2>
        ${field.description ? `<p class="question-description">${escapeHtml(field.description)}</p>` : ""}
        ${field.image?.src ? `<img class="question-image" src="${escapeHtml(field.image.src)}" alt="${escapeHtml(field.image.alt || field.label)}" />` : ""}
        ${renderFieldControl(field, answer)}
        <div id="validation-message" class="validation-message"></div>
      </article>
      <div class="form-navigation">
        <button class="secondary-button" type="button" data-action="previous-question" ${state.formIndex === 0 ? "disabled" : ""}>上一题</button>
        <button class="primary-button" type="button" data-action="next-question">${isLast ? (state.draft.mode === "edit" ? "保存修改" : "保存记录") : "下一题"}</button>
      </div>
    </section>`;
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
  await putDraft(state.draft);
}

function captureCurrentField() {
  if (!state.draft || !state.currentTemplate) return;
  const field = state.currentTemplate.fields[state.formIndex];
  if (!field || field.type === "section") return;

  if (["shortText", "longText", "number"].includes(field.type)) {
    const input = app.querySelector("[data-field-input]");
    const value = input?.value ?? "";
    if (field.allowAnonymous) {
      state.draft.answers[field.id] = {
        value,
        anonymous: Boolean(app.querySelector("[data-anonymous]")?.checked)
      };
    } else {
      state.draft.answers[field.id] = value;
    }
  }

  if (field.type === "repeatedNumber") {
    state.draft.answers[field.id] = Array.from(app.querySelectorAll("[data-repeat-input]"), (input) => input.value);
  }

  if (field.type === "singleChoice") {
    const answer = state.draft.answers[field.id] || { value: "", otherText: "" };
    const other = app.querySelector("[data-other-input]");
    if (other) answer.otherText = other.value;
    state.draft.answers[field.id] = answer;
  }

  if (field.type === "multiChoice") {
    const answer = state.draft.answers[field.id] || { values: [], otherTextById: {} };
    app.querySelectorAll("[data-other-input][data-option]").forEach((input) => {
      answer.otherTextById[input.dataset.option] = input.value;
    });
    state.draft.answers[field.id] = answer;
  }
}

function fieldValidation(field, answer) {
  if (field.type === "section") return "";
  const isBlankString = (value) => typeof value !== "string" || !value.trim();

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

function showValidation(message) {
  const element = document.querySelector("#validation-message");
  if (element) element.textContent = message;
  if (message) showToast(message);
}

async function moveQuestion(direction) {
  captureCurrentField();
  const fields = state.currentTemplate.fields;
  const currentField = fields[state.formIndex];

  if (direction > 0) {
    const message = fieldValidation(currentField, state.draft.answers[currentField.id]);
    if (message) {
      showValidation(message);
      return;
    }
  }

  await persistDraft();
  if (direction < 0) {
    state.formIndex = Math.max(0, state.formIndex - 1);
    await persistDraft();
    render();
    return;
  }

  if (state.formIndex < fields.length - 1) {
    state.formIndex += 1;
    await persistDraft();
    render();
    return;
  }

  await completeRecord();
}

async function completeRecord() {
  captureCurrentField();
  const fields = state.currentTemplate.fields;
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    const message = fieldValidation(field, state.draft.answers[field.id]);
    if (message) {
      state.formIndex = index;
      await persistDraft();
      render();
      showValidation(message);
      return;
    }
  }

  const timestamp = nowIso();
  if (state.draft.mode === "edit") {
    const existing = await getRecord(state.draft.recordId);
    if (!existing) throw new Error("需要修改的原记录不存在");
    await putRecord({ ...existing, answers: deepClone(state.draft.answers), updatedAt: timestamp });
    showToast("修改已保存");
  } else {
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
  }

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

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function exportCsv() {
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
  const csv = `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
  const filename = sanitizeFilename(`${state.currentTemplate.title}_V${state.currentTemplate.version}_${compactDate()}_共${state.records.length}份.csv`);
  const file = new File([csv], filename, { type: "text/csv;charset=utf-8" });
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
  const input = JSON.parse(await file.text());
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
  await refreshContext();
  state.view = "home";
  render();
}

async function openTemplateOverview(key) {
  const template = await getTemplate(key);
  if (!template) return;
  state.selectedTemplate = template;
  state.selectedTemplateDraft = await getDraft(key);
  state.view = "templateOverview";
  render();
}

async function startSelectedTemplate(key) {
  await setSetting("currentTemplateKey", key);
  await refreshContext();
  if (state.draft) {
    state.formIndex = state.draft.currentIndex || 0;
    state.view = "form";
    render();
    return;
  }
  await startNewForm();
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
  await putDraft(state.draft);
  state.formIndex = startIndex;
  state.view = "form";
  render();
}

async function removeSelectedRecord() {
  if (!state.selectedRecord) return;
  const label = recordName(state.selectedRecord);
  const confirmed = await showConfirm({
    title: "删除记录？",
    message: `将永久删除“${label}”的记录数据，此操作不可撤销。`,
    confirmLabel: "删除记录"
  });
  if (!confirmed) return;
  await deleteRecord(state.selectedRecord.id);
  state.selectedRecord = null;
  await refreshContext();
  state.view = "records";
  render();
  showToast("记录已删除");
}

function bindSwipeRows() {
  const rows = Array.from(app.querySelectorAll("[data-template-row]"));
  const closeOthers = (current = null) => rows.forEach((row) => {
    if (row !== current) {
      row.classList.remove("revealed", "dragging");
      row.querySelector(".swipe-content")?.style.removeProperty("transform");
    }
  });

  rows.forEach((row) => {
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
      currentOffset = open ? -76 : 0;
    };

    content.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      closeOthers(row);
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      startTime = performance.now();
      baseOffset = row.classList.contains("revealed") ? -76 : 0;
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
      currentOffset = Math.max(-76, Math.min(0, baseOffset + deltaX));
      content.style.transform = `translateX(${currentOffset}px)`;
      if (Math.abs(deltaX) > 8) row.dataset.suppressClick = "true";
    });

    const finish = (event) => {
      if (pointerId !== event.pointerId) return;
      const elapsed = Math.max(1, performance.now() - startTime);
      const velocity = (event.clientX - startX) / elapsed;
      const open = axis === "x" ? (velocity < -0.45 || (velocity <= 0.45 && currentOffset < -38)) : row.classList.contains("revealed");
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

  app.querySelector(".template-content")?.addEventListener("scroll", () => closeOthers(), { passive: true });
}

async function handleAction(action, element) {
  switch (action) {
    case "home":
      await refreshContext(); state.view = "home"; render(); break;
    case "templates":
      await loadTemplateCounts(); state.view = "templates"; render(); break;
    case "open-template": await openTemplateOverview(element.dataset.key); break;
    case "start-template": await startSelectedTemplate(element.dataset.key); break;
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
      captureCurrentField(); await persistDraft(); await refreshContext(); state.view = "home"; render(); showToast("草稿已保存"); break;
    case "previous-question": await moveQuestion(-1); break;
    case "next-question": await moveQuestion(1); break;
    case "open-record": await openRecord(element.dataset.id); break;
    case "edit-record": await editSelectedRecord(); break;
    case "edit-record-at": await editSelectedRecord(Number(element.dataset.fieldIndex) || 0); break;
    case "delete-record": await removeSelectedRecord(); break;
    case "export-csv": await exportCsv(); break;
    case "check-update": await checkForUpdates(); break;
    case "export-backup": await exportBackup(); break;
    case "import-backup": backupFileInput.click(); break;
    case "select-single": await selectSingle(element.dataset.option); break;
    case "toggle-multi": await toggleMulti(element.dataset.option); break;
    case "select-rating": await selectRating(element.dataset.value); break;
  }
}

async function selectSingle(optionId) {
  captureCurrentField();
  const field = state.currentTemplate.fields[state.formIndex];
  const previous = state.draft.answers[field.id];
  state.draft.answers[field.id] = { value: optionId, otherText: previous?.value === optionId ? previous.otherText || "" : "" };
  await persistDraft();
  render();
  if (field.options.find((item) => item.id === optionId)?.textInput) requestAnimationFrame(() => app.querySelector("[data-other-input]")?.focus());
}

async function toggleMulti(optionId) {
  captureCurrentField();
  const field = state.currentTemplate.fields[state.formIndex];
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

async function selectRating(rawValue) {
  const numeric = Number(rawValue);
  const value = Number.isFinite(numeric) && rawValue.trim() !== "" ? numeric : rawValue;
  const field = state.currentTemplate.fields[state.formIndex];
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
  if (event.key === "Escape" && !confirmOverlay.hidden) closeConfirm(false);
});

app.addEventListener("click", async (event) => {
  const element = event.target.closest("[data-action]");
  if (!element || element.disabled || state.actionBusy) return;
  if (element.closest("[data-template-row]")?.dataset.suppressClick === "true") {
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

app.addEventListener("input", () => {
  if (state.view !== "form") return;
  captureCurrentField();
  const field = state.currentTemplate.fields[state.formIndex];
  if (field?.type === "repeatedNumber") {
    const summary = app.querySelector("[data-repeated-summary]");
    const answer = state.draft.answers[field.id];
    if (summary) {
      summary.innerHTML = repeatedSummaryHtml(field, answer);
      summary.hidden = validRepeatedValues(answer).length === 0;
    }
  }
  persistDraft().catch(console.error);
});

app.addEventListener("change", async (event) => {
  if (state.view !== "form" || !event.target.matches("[data-anonymous]")) return;
  captureCurrentField();
  const field = state.currentTemplate.fields[state.formIndex];
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

function askWorkerVersion(worker) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve("新版"), 1000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(event.data?.version || "新版");
    };
    worker.postMessage({ type: "GET_VERSION" }, [channel.port2]);
  });
}

async function showUpdate(worker) {
  state.waitingWorker = worker;
  const version = await askWorkerVersion(worker);
  updateMessage.textContent = `发现新版本 V${version}`;
  updateBanner.hidden = false;
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
      await showUpdate(registration.waiting);
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

updateButton.addEventListener("click", () => {
  if (state.view === "form") {
    showToast("请先返回首页，草稿保存后再更新");
    return;
  }
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
