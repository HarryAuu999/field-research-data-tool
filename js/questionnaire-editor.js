const TYPE_LABELS = {
  shortText: "短文字",
  longText: "长文字",
  number: "数字",
  repeatedNumber: "重复数字",
  singleChoice: "单选",
  multiChoice: "多选",
  rating: "评分",
  section: "标题与备注"
};

export const EDITABLE_FIELD_TYPES = Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }));
export const SUPPORTED_FIELD_TYPES = new Set(Object.keys(TYPE_LABELS));

export function fieldTypeName(type) {
  return TYPE_LABELS[type] || "专用题型";
}

export function nextQuestionnaireVersion(version) {
  const match = String(version || "").trim().match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) return `${String(version || "1.0").trim()}.1`;
  const major = Number(match[1]);
  const minor = Number(match[2] || 0) + 1;
  return `${major}.${minor}`;
}

function uniqueToken(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function newQuestionnaireId(sourceId = "questionnaire") {
  return uniqueToken(`${sourceId}-copy`);
}

export function newFieldId(type, fields = []) {
  const prefix = type === "section" ? "section" : "question";
  const used = new Set(fields.map((field) => field.id));
  let id = uniqueToken(prefix);
  while (used.has(id)) id = uniqueToken(prefix);
  return id;
}

export function newOptionId(field) {
  const used = new Set((field.options || []).map((option) => option.id));
  let id = uniqueToken("option");
  while (used.has(id)) id = uniqueToken("option");
  return id;
}

export function makeQuestion(type, fields = []) {
  const common = {
    id: newFieldId(type, fields),
    type,
    label: type === "section" ? "新标题" : "新问题",
    description: "",
    required: false
  };
  if (["shortText", "longText"].includes(type)) return { ...common, placeholder: "" };
  if (type === "number") return { ...common, placeholder: "", unit: "", integer: false };
  if (type === "repeatedNumber") return { ...common, repeatCount: 3, minEntries: 1, unit: "", placeholder: "" };
  if (["singleChoice", "multiChoice"].includes(type)) {
    const field = { ...common, options: [] };
    field.options = [
      { id: newOptionId(field), label: "选项1" },
      { id: newOptionId({ ...field, options: [{ id: field.options?.[0]?.id }] }), label: "选项2" }
    ];
    return field;
  }
  if (type === "rating") {
    return {
      ...common,
      min: 1,
      max: 5,
      labels: {
        "1": { short: "最低", help: "" },
        "3": { short: "中间", help: "" },
        "5": { short: "最高", help: "" }
      }
    };
  }
  if (type === "section") return { id: common.id, type, label: common.label, description: "" };
  return common;
}

export function changeQuestionType(field, type, fields = []) {
  if (!SUPPORTED_FIELD_TYPES.has(type)) throw new Error(`不支持的题型：${type}`);
  const changed = makeQuestion(type, fields.filter((item) => item.id !== field.id));
  changed.id = field.id;
  changed.label = field.label;
  changed.description = field.description || "";
  if (field.page) changed.page = field.page;
  if (type !== "section") changed.required = Boolean(field.required);
  if (field.image) changed.image = JSON.parse(JSON.stringify(field.image));
  return changed;
}

export function duplicateTemplate(source, analysis) {
  const copy = JSON.parse(JSON.stringify(source));
  delete copy.key;
  delete copy.importedAt;
  copy.id = newQuestionnaireId(source.id);
  copy.version = "1.0";
  copy.title = `${source.title}（副本）`;
  if (analysis && !copy.analysis) copy.analysis = JSON.parse(JSON.stringify(analysis));
  return copy;
}

export function reorderFields(fields, orderedIds) {
  const byId = new Map(fields.map((field) => [field.id, field]));
  const reordered = orderedIds.map((id) => byId.get(id)).filter(Boolean);
  for (const field of fields) if (!orderedIds.includes(field.id)) reordered.push(field);
  return reordered;
}

export function questionUsesAnalysis(template, fieldId) {
  return Boolean(template.analysis?.fields?.some((item) => item.id === fieldId));
}
