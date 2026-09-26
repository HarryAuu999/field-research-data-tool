import assert from "node:assert/strict";
import JSZip from "jszip";
import { appendStrokePoint, blankImageRangeAnswer, clampNormalized, imageRangeStrokes, simplifyStrokePoints, strokePath } from "../js/image-range.js";
import { addBinaryMask, boxBlur } from "../js/image-range-heatmap.js";
import { createXlsxBlob } from "../js/xlsx-export.js";

assert.deepEqual(blankImageRangeAnswer(), { version: 1, strokes: [] });
assert.deepEqual(imageRangeStrokes(undefined), []);
assert.equal(clampNormalized(-0.2), 0);
assert.equal(clampNormalized(1.2), 1);
assert.equal(clampNormalized(0.1234567), 0.12346);
const stroke = { points: [[0.5, 0.5]] };
assert.equal(strokePath(stroke, 100, 200), "M50.00 100.00 L50.00 100.00");
assert.equal(appendStrokePoint(stroke, [0.5001, 0.5001]), false);
assert.equal(appendStrokePoint(stroke, [0.6, 0.7]), true);
assert.equal(strokePath(stroke, 100, 200), "M50.00 100.00 L60.00 140.00");
assert.deepEqual(simplifyStrokePoints([[0, 0], [0.1, 0.001], [0.2, 0]], 100, 100), [[0, 0], [0.2, 0]], "0.15%简化应删除近似共线点");
assert.deepEqual(simplifyStrokePoints([[0, 0], [0.1, 0.002], [0.2, 0]], 100, 100), [[0, 0], [0.1, 0.002], [0.2, 0]], "0.15%简化应保留原来0.3%容差会删除的细小转折");
assert.deepEqual(simplifyStrokePoints([[0, 0], [0.1, 0.01], [0.2, 0]], 100, 100), [[0, 0], [0.1, 0.01], [0.2, 0]], "转折不能被误删");
const counts = new Uint16Array(2);
addBinaryMask(counts, new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 0]));
addBinaryMask(counts, new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255]));
assert.deepEqual([...counts], [2, 1], "重复笔画应先在参与者内合并，再累计人数");
assert.deepEqual([...boxBlur(counts, 2, 1, 1)], [1.5, 1.5]);

const blob = createXlsxBlob([
  { name: "Responses", rows: [["姓名", "评分"], ["=1+1", 3.5]] },
  { name: "Annotations", rows: [["normalizedX", "normalizedY"], [0.2, 0.8]] }
]);
const workbook = await JSZip.loadAsync(await blob.arrayBuffer());
const responseXml = await workbook.file("xl/worksheets/sheet1.xml").async("string");
const annotationXml = await workbook.file("xl/worksheets/sheet2.xml").async("string");
assert(responseXml.includes('<dimension ref="A1:B2"/>'));
assert(responseXml.includes('<t xml:space="preserve">=1+1</t>'), "用户输入不能成为Excel公式");
assert(responseXml.includes('<c r="B2"><v>3.5</v></c>'));
assert(annotationXml.includes('<c r="A2"><v>0.2</v></c>'));
console.log(JSON.stringify({ passed: true, scenarios: ["normalized-coordinate", "stroke-path", "fixed-simplification", "binary-participant-count", "display-only-blur", "xlsx-structure", "literal-text", "numeric-cells"] }, null, 2));
