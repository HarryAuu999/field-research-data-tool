import assert from "node:assert/strict";
import fs from "node:fs";
import { normalizeTemplateImport, validateTemplate } from "../js/questionnaire-schema.js";

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
assert.equal(normalizeTemplateImport({ ...baseTemplate, schemaVersion: "1" }).schemaVersion, 1, "导入未兼容字符串版本1");
assert.equal(normalizeTemplateImport({ questionnaire: baseTemplate }), baseTemplate, "导入未兼容questionnaire单层包装");
assert.equal(normalizeTemplateImport({ template: baseTemplate }), baseTemplate, "导入未兼容template单层包装");

const layoutTemplate = structuredClone(baseTemplate);
layoutTemplate.recordLabelField = "name";
layoutTemplate.fields.push({ id: "age", type: "number", label: "年龄", page: "profile" });
layoutTemplate.fields[0].page = "profile";
assert.equal(validateTemplate(layoutTemplate, { importedAt: fixedTime }).fields[1].page, "profile");
const imageRangeTemplate = JSON.parse(fs.readFileSync(new URL("../examples/ear-image-range-test.json", import.meta.url), "utf8"));
assert.equal(validateTemplate(imageRangeTemplate, { importedAt: fixedTime }).fields.length, 7, "图片标注测试问卷无效");
assert.equal(validateTemplate(imageRangeTemplate, { importedAt: fixedTime }).analysis.type, "imageRangeHeatmap");
assert.equal(imageRangeTemplate.recordLabelField, "name", "验收问卷未用姓名命名样本");
expectInvalid((template) => {
  template.fields = [{ id: "area", type: "imageRange", label: "区域", image: { src: "./assets/ear-side.png" }, view: "side", annotationType: "pain", brushSize: 0.03, levels: [{ id: 1, label: "疼痛" }] }];
}, /正数宽高/);
expectInvalid((template) => {
  template.fields = [{ id: "area", type: "imageRange", label: "区域", image: { src: "./assets/ear-side.png", width: 1149, height: 1368 }, view: "side", annotationType: "pain", brushSize: 0.03, levels: [{ id: 2, label: "疼痛" }] }];
}, /连续等级/);
expectInvalid((template) => {
  template.fields = [{ id: "area", type: "imageRange", label: "区域", questionNumber: 0, image: { src: "./assets/ear-side.png", width: 1149, height: 1368 }, view: "side", annotationType: "pain", brushSize: 0.03, levels: [{ id: 1, label: "疼痛" }] }];
}, /questionNumber/);
expectInvalid((template) => {
  template.fields = [imageRangeTemplate.fields[1]];
  template.analysis = { type: "imageRangeHeatmap", fields: [{ id: "name" }] };
}, /热力图字段无效/);

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
expectInvalid((template) => { template.recordLabelField = "missing"; }, /recordLabelField/);

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

console.log(JSON.stringify({ passed: true, scenarios: 21 }, null, 2));
