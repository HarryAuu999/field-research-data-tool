import { SUPPORTED_FIELD_TYPES } from "./questionnaire-editor.js?v=1.4.2-beta.4";
import { DESCRIPTIVE_STATISTICS } from "./statistics.js?v=1.4.2-beta.4";

const ANALYSIS_TYPES = new Set(["distribution", "descriptiveDistribution", "imageRangeHeatmap"]);
const ANALYSIS_THEMES = new Set(["blue", "orange"]);

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function normalizeTemplateImport(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  let candidate = input;
  if (candidate.schemaVersion === undefined) {
    const wrapped = ["questionnaire", "template"]
      .map((key) => candidate[key])
      .filter((value) => value && typeof value === "object" && !Array.isArray(value));
    if (wrapped.length === 1) candidate = wrapped[0];
  }
  if (candidate.schemaVersion === "1") candidate = { ...candidate, schemaVersion: 1 };
  return candidate;
}

function validateAnalysisConfig(config, fields) {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("简易分析配置必须是一个对象");
  if (!ANALYSIS_TYPES.has(config.type)) throw new Error("不支持的简易分析类型");
  if (config.type === "imageRangeHeatmap") {
    if (!Array.isArray(config.fields) || !config.fields.length) throw new Error("图片热力图至少需要一道图片标注题");
    const fieldMap = new Map(fields.map((field) => [field.id, field]));
    const seen = new Set();
    for (const item of config.fields) {
      const field = fieldMap.get(item?.id);
      if (!field || field.type !== "imageRange" || seen.has(item.id)) throw new Error(`热力图字段无效或重复：${item?.id || "未命名"}`);
      if (item.label !== undefined && (typeof item.label !== "string" || !item.label.trim())) throw new Error(`热力图字段 ${item.id} 的标题无效`);
      seen.add(item.id);
    }
    return;
  }
  if (config.aggregation !== "participantMean") throw new Error("分布分析必须按参与者平均值汇总");
  if (config.binWidth !== undefined && (!Number.isFinite(config.binWidth) || config.binWidth <= 0)) {
    throw new Error("分布分析的固定区间宽度必须大于0；不填写时将自动分箱");
  }
  if (config.type === "distribution" && (!Array.isArray(config.percentiles) || !config.percentiles.length)) {
    throw new Error("distribution 分布分析至少需要一个百分位");
  }
  if (config.percentiles !== undefined && (!Array.isArray(config.percentiles) || !config.percentiles.length || config.percentiles.some((value) => !Number.isFinite(value) || value <= 0 || value >= 100))) {
    throw new Error("分布分析的百分位设置无效");
  }
  if (config.statistics !== undefined && (!Array.isArray(config.statistics) || !config.statistics.length || new Set(config.statistics).size !== config.statistics.length || config.statistics.some((value) => !DESCRIPTIVE_STATISTICS.includes(value)))) {
    throw new Error("描述性统计项目设置无效");
  }
  if (!Array.isArray(config.fields) || !config.fields.length) throw new Error("分布分析至少需要一个数字题");
  const fieldMap = new Map(fields.map((field) => [field.id, field]));
  for (const item of config.fields) {
    const field = fieldMap.get(item?.id);
    if (!field || !["number", "repeatedNumber"].includes(field.type)) throw new Error(`简易分析字段无效：${item?.id || "未命名"}`);
    if (item.label !== undefined && (typeof item.label !== "string" || !item.label.trim())) throw new Error(`简易分析字段 ${item.id} 的标题无效`);
    if (item.theme !== undefined && !ANALYSIS_THEMES.has(item.theme)) throw new Error(`简易分析字段 ${item.id} 的主题色无效`);
  }
}

export function validateTemplate(input, { importedAt = new Date().toISOString() } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("问卷JSON的最外层必须是一个对象");
  if (input.schemaVersion !== 1) {
    const hasVersion = Object.prototype.hasOwnProperty.call(input, "schemaVersion");
    const received = hasVersion ? `${JSON.stringify(input.schemaVersion)}（${typeof input.schemaVersion}）` : "未找到";
    const keys = Object.keys(input).slice(0, 8).join("、") || "无";
    throw new Error(`目前只支持 schemaVersion 为数字1的问卷模板；实际读取：${received}；顶层字段：${keys}`);
  }
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
    if (field.page !== undefined && (typeof field.page !== "string" || !field.page.trim())) {
      throw new Error(`题目 ${field.id} 的 page 必须是非空字符串`);
    }
    if (["singleChoice", "multiChoice"].includes(field.type)) {
      if (!Array.isArray(field.options) || field.options.length === 0) throw new Error(`题目 ${field.label} 缺少选项`);
      const optionIds = new Set();
      for (const option of field.options) {
        if (!option.id || !option.label) throw new Error(`题目 ${field.label} 存在无效选项`);
        if (optionIds.has(option.id)) throw new Error(`题目 ${field.label} 的选项ID重复`);
        optionIds.add(option.id);
      }
    }

    if (field.type === "rating" && (!Number.isInteger(field.min) || !Number.isInteger(field.max) || field.min >= field.max)) {
      throw new Error(`评分题 ${field.label} 的分值范围无效`);
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

    if (field.type === "imageRange") {
      if (field.questionNumber !== undefined && (!Number.isInteger(field.questionNumber) || field.questionNumber < 1)) {
        throw new Error(`图片范围标注题 ${field.label} 的 questionNumber 必须是正整数`);
      }
      if (!field.image?.src || !Number.isFinite(field.image.width) || field.image.width <= 0 || !Number.isFinite(field.image.height) || field.image.height <= 0) {
        throw new Error(`图片范围标注题 ${field.label} 需要图片及正数宽高`);
      }
      if (typeof field.view !== "string" || !field.view.trim() || typeof field.annotationType !== "string" || !field.annotationType.trim()) {
        throw new Error(`图片范围标注题 ${field.label} 需要 view 和 annotationType`);
      }
      if (!Number.isFinite(field.brushSize) || field.brushSize <= 0 || field.brushSize > 0.2) {
        throw new Error(`图片范围标注题 ${field.label} 的 brushSize 必须大于0且不超过0.2`);
      }
      if (!Array.isArray(field.levels) || field.levels.length < 1 || field.levels.length > 2 || field.levels.some((level, i) => level?.id !== i + 1 || typeof level.label !== "string" || !level.label.trim())) {
        throw new Error(`图片范围标注题 ${field.label} 需要1至2个连续等级`);
      }
      if (field.page !== undefined) throw new Error(`图片范围标注题 ${field.label} 必须独占一页`);
    }

    if (field.image?.src) {
      const src = String(field.image.src);
      if (!src.startsWith("data:image/") && !src.startsWith("./assets/")) {
        throw new Error(`题目 ${field.label} 的图片必须嵌入JSON，不能依赖外部网址`);
      }
    }
  });

  if (input.recordLabelField !== undefined) {
    if (typeof input.recordLabelField !== "string" || !ids.has(input.recordLabelField)) {
      throw new Error("recordLabelField 必须引用一个现有题目ID");
    }
    if (input.fields.find((field) => field.id === input.recordLabelField)?.type === "section") {
      throw new Error("recordLabelField 不能引用 section");
    }
  }

  if (input.analysis !== undefined) validateAnalysisConfig(input.analysis, input.fields);

  const template = deepClone(input);
  template.key = `${template.id}@${template.version}`;
  template.importedAt = template.importedAt || importedAt;
  return template;
}
