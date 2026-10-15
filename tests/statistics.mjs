import assert from "node:assert/strict";
import {
  analysisValue,
  categoricalFrequencies,
  descriptiveStatistics,
  fieldDistribution,
  modes,
  quantile,
  sampleStandardDeviation
} from "../js/statistics.js";

function closeTo(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-10, `${message}: ${actual} !== ${expected}`);
}

const odd = descriptiveStatistics([1, 2, 3, 4, 5]);
assert.equal(odd.mean, 3, "平均数计算错误");
assert.equal(odd.median, 3, "奇数样本中位数计算错误");
assert.equal(descriptiveStatistics([1, 2, 3, 4]).median, 2.5, "偶数样本中位数计算错误");
assert.deepEqual(modes([3, 3, 3.5, 4]), [3], "唯一众数计算错误");
assert.deepEqual(modes([3, 3, 3.5, 3.5, 4]), [3, 3.5], "多众数计算错误");
assert.deepEqual(modes([3, 3.5, 4]), [], "所有值频次相同时不应报告众数");
closeTo(sampleStandardDeviation([1, 2, 3]), 1, "样本标准差计算错误");
assert.equal(sampleStandardDeviation([3]), null, "单个样本不应报告样本标准差");
assert.equal(quantile([1, 2, 3, 4, 5], 25), 2, "Q1计算错误");
assert.equal(quantile([1, 2, 3, 4, 5], 75), 4, "Q3计算错误");

const repeatedField = { id: "measure", type: "repeatedNumber" };
assert.equal(analysisValue(repeatedField, ["1", "2", "3"], "participantMean"), 2, "重复测量没有先计算参与者平均值");
assert.equal(analysisValue(repeatedField, ["", "无效", "3"], "participantMean"), 3, "重复测量没有忽略空值或无效数字");
assert.equal(analysisValue({ id: "score", type: "number" }, ""), null, "空数字不应被当作0");
assert.equal(analysisValue({ id: "score", type: "number" }, "abc"), null, "无效数字不应进入统计");

const template = { fields: [repeatedField] };
const records = [
  { answers: { measure: ["1", "3"] } },
  { answers: { measure: ["4", "6"] } },
  { answers: { measure: ["", "bad"] } }
];
assert.deepEqual(fieldDistribution(template, records, "measure", "participantMean"), [2, 5], "每名参与者应只形成一个统计样本");


const ratingField = { id: "comfort", type: "rating", min: 1, max: 3, unknownOption: { id: "unknown", label: "无法判断" } };
const rated = categoricalFrequencies(ratingField, [
  { answers: { comfort: 1 } }, { answers: { comfort: 1 } },
  { answers: { comfort: 3 } }, { answers: { comfort: "unknown" } },
  { answers: { comfort: "" } }
]);
assert.equal(rated.respondentCount, 4);
assert.deepEqual(rated.options.map((option) => option.count), [2, 0, 1, 1]);
assert.equal(rated.options[0].percentage, 50);

const selectField = { id: "favorite", type: "singleChoice", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] };
const single = categoricalFrequencies(selectField, [
  { answers: { favorite: { value: "b" } } }, { answers: { favorite: { value: "a" } } },
  { answers: { favorite: { value: "" } } }, { answers: { favorite: { value: "unlisted" } } }
]);
assert.deepEqual(single.options.map((option) => option.count), [1, 1]);
assert.equal(single.respondentCount, 2, "invalid or missing responses cannot dilute the denominator");

const multiField = { id: "reasons", type: "multiChoice", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] };
const multi = categoricalFrequencies(multiField, [
  { answers: { reasons: { values: ["a", "a", "b"] } } },
  { answers: { reasons: { values: ["a"] } } },
  { answers: { reasons: { values: [] } } }
]);
assert.equal(multi.respondentCount, 2);
assert.deepEqual(multi.options.map((option) => option.count), [2, 1], "duplicate selections by one participant count once");
assert.deepEqual(multi.options.map((option) => option.percentage), [100, 50]);
assert.equal(multi.multiple, true);

console.log(JSON.stringify({ passed: true, scenarios: [
  "mean", "odd-median", "even-median", "single-mode", "multi-mode", "no-mode",
  "sample-sd", "quartiles", "participant-mean", "empty", "invalid-number", "single-sample"
] }, null, 2));
