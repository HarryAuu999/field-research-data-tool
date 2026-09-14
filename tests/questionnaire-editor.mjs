import assert from "node:assert/strict";
import {
  changeQuestionType,
  duplicateTemplate,
  makeQuestion,
  nextQuestionnaireVersion,
  questionUsesAnalysis,
  reorderFields
} from "../js/questionnaire-editor.js";

assert.equal(nextQuestionnaireVersion("1.0"), "1.1", "常规问卷版本递增错误");
assert.equal(nextQuestionnaireVersion("2"), "2.1", "整数问卷版本递增错误");
assert.equal(nextQuestionnaireVersion("draft"), "draft.1", "非数字问卷版本递增错误");

const number = makeQuestion("number");
assert.equal(number.type, "number");
assert.equal(number.integer, false);
assert.equal(number.required, false);

const repeated = makeQuestion("repeatedNumber", [number]);
assert.equal(repeated.repeatCount, 3);
assert.equal(repeated.minEntries, 1);
assert.notEqual(repeated.id, number.id, "新问题ID发生冲突");

const choice = makeQuestion("singleChoice");
assert.equal(choice.options.length, 2);
assert.notEqual(choice.options[0].id, choice.options[1].id, "选项ID发生冲突");

const original = {
  id: "comfort",
  type: "number",
  label: "舒适度",
  description: "请填写",
  required: true,
  page: "scores",
  image: { src: "./example.png", alt: "示例" }
};
const changed = changeQuestionType(original, "rating", [original]);
assert.equal(changed.id, original.id);
assert.equal(changed.label, original.label);
assert.equal(changed.required, true);
assert.equal(changed.page, "scores", "题型转换不应丢失JSON中的同页配置");
assert.deepEqual(changed.image, original.image);
assert.notEqual(changed.image, original.image, "题型转换应复制图片配置");

const source = { id: "survey", version: "2.4", title: "测试问卷", fields: [original] };
const analysis = { type: "distribution", fields: [{ id: "comfort" }] };
const copy = duplicateTemplate(source, analysis);
assert.notEqual(copy.id, source.id);
assert.equal(copy.version, "1.0");
assert.equal(copy.title, "测试问卷（副本）");
assert.deepEqual(copy.analysis, analysis);

const fields = [{ id: "a" }, { id: "b" }, { id: "c" }];
assert.deepEqual(reorderFields(fields, ["c", "a"]).map((field) => field.id), ["c", "a", "b"]);
assert.equal(questionUsesAnalysis({ analysis }, "comfort"), true);
assert.equal(questionUsesAnalysis({ analysis }, "missing"), false);

console.log(JSON.stringify({ passed: true, scenarios: [
  "versioning", "question-defaults", "unique-ids", "type-change", "duplicate", "reorder", "analysis-reference"
] }, null, 2));
