import assert from "node:assert/strict";
import fs from "node:fs";
import { angleCenter, anglePoint, angleDistribution, imageAngleValidation, isImageAngleValue } from "../js/image-angle.js";
import { validateTemplate } from "../js/questionnaire-schema.js";
import { duplicateTemplate, EDITABLE_FIELD_TYPES } from "../js/questionnaire-editor.js";
import { DEFAULT_TEMPLATE } from "../js/default-template.js";

const template = JSON.parse(fs.readFileSync(new URL("../examples/ear-image-angle-test.json", import.meta.url), "utf8"));
const field = template.fields[0];
assert.equal(validateTemplate(template).key, "ear-clip-angle-preview@1.0");
assert.equal(DEFAULT_TEMPLATE.fields.find((f) => f.id === "wearHabit").type, "singleChoice", "出厂问卷尚未批准替换");
assert.equal(EDITABLE_FIELD_TYPES.some((item) => item.value === "imageAngle"), false, "专用配置由JSON定义");
assert.deepEqual(duplicateTemplate(template).fields[0].angle, field.angle);

const [cx, cy] = angleCenter(field);
const radius = field.angle.radius * field.image.width;
const zero = anglePoint(field, 0);
const down = anglePoint(field, 90);
const up = anglePoint(field, -20);
assert.ok(Math.abs(zero[0] - (cx - radius)) < 1e-8 && Math.abs(zero[1] - cy) < 1e-8);
assert.ok(Math.abs(down[0] - cx) < 1e-8 && Math.abs(down[1] - (cy + radius)) < 1e-8);
assert.ok(up[0] < cx && up[1] < cy);
const enlarged = structuredClone(field);
enlarged.image.width *= 2; enlarged.image.height *= 2;
assert.deepEqual(anglePoint(enlarged, 45), anglePoint(field, 45).map((v) => v * 2), "缩放不能改变真实角度");
const clockwise = structuredClone(field);
clockwise.angle.rotation = "clockwise";
assert.ok(anglePoint(clockwise, 90)[1] < cy, "配置可用于其他方向的底图");

for (const value of [-20, 0, 37, 90]) assert.equal(isImageAngleValue(field, value), true);
for (const value of ["", null, undefined, "0", NaN, Infinity, -21, 91, 37.5]) assert.equal(isImageAngleValue(field, value), false);
assert.equal(imageAngleValidation(field, ""), "");
assert.match(imageAngleValidation({ ...field, required: true }, ""), /请选择/);
assert.equal(imageAngleValidation({ ...field, required: true }, 0), "");

const records = [-20, -10, 0, 0, 10, 15, 20, 90, "", null, "30", 91, NaN].map((value) => ({ answers: { wearAngle: value } }));
const result = angleDistribution(field, records, 10);
assert.equal(result.count, 8);
assert.equal(result.bins.reduce((n, bin) => n + bin.count, 0), 8);
assert.equal(result.bins[0].count, 1, "最低端点归入第一组");
assert.equal(result.bins[1].count, 1, "边界只计一次");
assert.equal(result.bins[2].count, 2, "水平0°不是空值");
assert.equal(result.bins.at(-1).count, 1, "90°包含在最后一组");
assert.equal(result.median, 5);
assert.equal(result.mean, 13.125, "平均数只计算有效角度");
const simple = angleDistribution(field, [0, 10, 20].map((v) => ({ answers: { wearAngle: v } })), 10);
assert.equal(simple.mean, 10);
assert.equal(simple.sd, 10, "标准差使用n−1分母的样本标准差");
const single = angleDistribution(field, [{ answers: { wearAngle: 0 } }], 10);
assert.equal(single.mean, 0);
assert.equal(single.sd, null, "单个样本不能把标准差误显示为0");
assert.equal(angleDistribution(field, [], 10).mean, null);
assert.equal(angleDistribution(field, [], 10).sd, null);
assert.equal(angleDistribution(field, [{ answers: { wearAngle: 0 } }], 10).median, 0);
assert.equal(angleDistribution(field, [], 10).median, null);
assert.throws(() => angleDistribution(field, [], 9), /等分/);

for (const mutate of [
  (f) => { f.angle.center = [1.1, 0.5]; },
  (f) => { f.angle.min = f.angle.max; },
  (f) => { f.angle.max = 360; },
  (f) => { f.angle.step = 3; },
  (f) => { f.angle.zeroDegrees = 360; },
  (f) => { f.angle.rotation = "up"; },
  (f) => { f.angle.radius = 0; },
  (f) => { f.page = "group"; }
]) {
  const candidate = structuredClone(template);
  mutate(candidate.fields[0]);
  assert.throws(() => validateTemplate(candidate));
}
const wrongAnalysis = structuredClone(template);
wrongAnalysis.analyses[0].binWidth = 9;
assert.throws(() => validateTemplate(wrongAnalysis), /等分/);
wrongAnalysis.analyses[0].binWidth = 10;
wrongAnalysis.analyses[0].fields.push({ id: "wearAngle" });
assert.throws(() => validateTemplate(wrongAnalysis), /重复/);
console.log(JSON.stringify({ passed: true, checks: ["schema", "geometry", "direction", "scale", "empty-and-zero", "bins", "median", "copy", "unchanged-default"] }, null, 2));
