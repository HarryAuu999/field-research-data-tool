import assert from "node:assert/strict";
import { validateTemplate } from "../js/questionnaire-schema.js";

const fixedTime = "2026-09-14T00:00:00.000Z";
const baseTemplate = {
  schemaVersion: 1,
  id: "test-questionnaire",
  version: "1.0",
  title: "测试问卷",
  fields: [{ id: "name", type: "shortText", label: "姓名" }]
};

function expectInvalid(change, messagePattern) {
  const candidate = structuredClone(baseTemplate);
  change(candidate);
  assert.throws(() => validateTemplate(candidate, { importedAt: fixedTime }), messagePattern);
}

const validated = validateTemplate(baseTemplate, { importedAt: fixedTime });
assert.equal(validated.key, "test-questionnaire@1.0");
assert.equal(validated.importedAt, fixedTime);
assert.notEqual(validated, baseTemplate, "校验结果应为副本，避免修改导入来源");

expectInvalid((template) => { template.schemaVersion = 2; }, /schemaVersion/);
expectInvalid((template) => { template.fields.push({ ...template.fields[0] }); }, /题目ID重复/);
expectInvalid((template) => { template.fields[0].type = "unknown"; }, /不支持的题型/);
expectInvalid((template) => {
  template.fields = [{ id: "choice", type: "singleChoice", label: "选择", options: [] }];
}, /缺少选项/);
expectInvalid((template) => {
  template.fields = [{ id: "score", type: "rating", label: "评分", min: 5, max: 1 }];
}, /分值范围无效/);
expectInvalid((template) => {
  template.fields = [{ id: "measure", type: "repeatedNumber", label: "测量", repeatCount: 1 }];
}, /填写次数必须是2至10/);
expectInvalid((template) => {
  template.fields[0].image = { src: "https://example.com/image.png" };
}, /不能依赖外部网址/);

const analyzed = structuredClone(baseTemplate);
analyzed.fields = [{ id: "score", type: "number", label: "分数" }];
analyzed.analysis = {
  type: "descriptiveDistribution",
  aggregation: "participantMean",
  statistics: ["count", "mean", "median"],
  binWidth: 0.5,
  percentiles: [25, 50, 75],
  fields: [{ id: "score", label: "分数", theme: "blue" }]
};
assert.equal(validateTemplate(analyzed, { importedAt: fixedTime }).analysis.type, "descriptiveDistribution");

expectInvalid((template) => {
  template.analysis = { type: "distribution", aggregation: "participantMean", fields: [{ id: "name" }] };
}, /至少需要一个百分位/);
expectInvalid((template) => {
  template.analysis = { type: "descriptiveDistribution", aggregation: "raw", fields: [{ id: "name" }] };
}, /参与者平均值/);
expectInvalid((template) => {
  template.analysis = { type: "descriptiveDistribution", aggregation: "participantMean", fields: [{ id: "name" }] };
}, /简易分析字段无效/);
expectInvalid((template) => {
  template.fields = [{ id: "score", type: "number", label: "分数" }];
  template.analysis = { type: "descriptiveDistribution", aggregation: "participantMean", fields: [{ id: "score", theme: "green" }] };
}, /主题色无效/);

console.log(JSON.stringify({ passed: true, scenarios: 12 }, null, 2));
