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
import { DEFAULT_TEMPLATE, templateKey } from "./default-template.js";

const APP_VERSION = "1.0.0-beta.3";
const BACKUP_FORMAT = "research-notebook-backup";
const BACKUP_VERSION = 1;
const ICON_ARROW_LEFT = "./assets/arrow-left.svg";
const ICON_CHEVRON_RIGHT = "./assets/chevron-right.svg";
const SUPPORTED_FIELD_TYPES = new Set([
  "shortText",
  "longText",
  "number",
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
  formIndex: 0,
  templateCounts: {},
  waitingWorker: null,
  toastTimer: null,
  actionBusy: false
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

    if (field.image?.src) {
      const src = String(field.image.src);
      if (!src.startsWith("data:image/") && !src.startsWith("./assets/")) {
        throw new Error(`题目 ${field.label} 的图片必须嵌入JSON，不能依赖外部网址`);
      }
    }
  });

  const template = deepClone(input);
  template.key = templateKey(template);
  template.importedAt = template.importedAt || nowIso();
  return template;
}

async function seedDefaultTemplate() {
  const seeded = await getSetting("defaultTemplateSeeded", false);
  if (seeded) return;
  const template = validateTemplate(DEFAULT_TEMPLATE);
  await putTemplate(template);
  await setSetting("currentTemplateKey", template.key);
  await setSetting("defaultTemplateSeeded", true);
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
  switch (state.view) {
    case "templates": renderTemplates(); break;
    case "records": renderRecords(); break;
    case "recordDetail": renderRecordDetail(); break;
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
        <footer class="home-footer"><button class="text-button" data-action="backup" type="button">完整数据备份与恢复</button></footer>
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
          <button class="secondary-button" type="button" data-action="export-csv" ${state.records.length ? "" : "disabled"}>导出 CSV 数据</button>
        </div>
      </div>
      <footer class="home-footer"><button class="text-button" data-action="backup" type="button">完整数据备份与恢复</button></footer>
    </section>`;
}

function renderTemplates() {
  const items = state.templates.map((template) => {
    const isCurrent = template.key === state.currentTemplate?.key;
    const count = state.templateCounts[template.key] ?? 0;
    return `
      <div class="swipe-row" data-template-row="${escapeHtml(template.key)}">
        <button class="swipe-delete" type="button" data-action="delete-template" data-key="${escapeHtml(template.key)}">删除</button>
        <button class="swipe-content" type="button" data-action="select-template" data-key="${escapeHtml(template.key)}">
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

  const rows = state.currentTemplate.fields
    .filter((field) => field.type !== "section")
    .map((field, index) => `
      <div class="detail-row">
        <span class="detail-label">${index + 1}. ${escapeHtml(field.label)}</span>
        <span class="detail-value">${escapeHtml(formatAnswer(field, record.answers[field.id]) || "未填写")}</span>
      </div>`).join("");

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
        <h2>低频保险功能</h2>
        <p>完整JSON包含所有问卷模板、已保存记录和草稿。日常研究只需导出CSV；换手机或担心本地数据丢失时，再使用这里。</p>
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

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function exportCsv() {
  if (!state.currentTemplate || !state.records.length) return;
  const fields = state.currentTemplate.fields.filter((field) => field.type !== "section");
  const headers = ["记录编号", "首次保存时间", "最后修改时间", ...fields.map(exportHeader)];
  const rows = state.records.map((record) => [
    record.recordNumber,
    formatDateTime(record.createdAt),
    formatDateTime(record.updatedAt),
    ...fields.map((field) => formatAnswer(field, record.answers[field.id], { forExport: true }))
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
  state.view = "templates";
  render();
  showToast("问卷及其本地数据已删除");
}

async function openRecord(id) {
  state.selectedRecord = await getRecord(id);
  state.view = "recordDetail";
  render();
}

async function editSelectedRecord() {
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
    currentIndex: 0,
    answers: deepClone(state.selectedRecord.answers),
    createdAt: timestamp,
    updatedAt: timestamp
  };
  await putDraft(state.draft);
  state.formIndex = 0;
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
  app.querySelectorAll("[data-template-row]").forEach((row) => {
    let startX = 0;
    row.addEventListener("touchstart", (event) => { startX = event.changedTouches[0].clientX; }, { passive: true });
    row.addEventListener("touchend", (event) => {
      const delta = event.changedTouches[0].clientX - startX;
      if (delta < -45) row.classList.add("revealed");
      if (delta > 45) row.classList.remove("revealed");
    }, { passive: true });
  });
}

async function handleAction(action, element) {
  switch (action) {
    case "home":
      await refreshContext(); state.view = "home"; render(); break;
    case "templates":
      await loadTemplateCounts(); state.view = "templates"; render(); break;
    case "records":
      await refreshContext(); state.view = "records"; render(); break;
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
    case "delete-record": await removeSelectedRecord(); break;
    case "export-csv": await exportCsv(); break;
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

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  const registration = await navigator.serviceWorker.register("./sw.js");
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
