import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const headers = [
  "记录编号",
  "记录时间",
  "姓名",
  "是否匿名",
  "性别",
  "年龄（岁）",
  "左耳水平佩戴位置厚度（mm）",
  "左耳倾斜佩戴位置厚度（mm）",
  "耳夹佩戴习惯",
  "其他佩戴方式",
  "耳型大小评价",
  "开放式耳机偏好",
  "偏好原因",
  "耳朵敏感程度（1-5分）",
  "点位1",
  "点位1背面",
  "点位2",
  "点位2背面",
  "点位3",
  "点位3背面",
  "点位4",
  "点位4背面",
];

const rows = [
  ["R-20260818-A7F3-0001", "2026-08-18 09:15:00", "李明", "否", "男", 28, 5.2, 5.8, "B－倾斜约45°", "", "中", "耳夹式", "不遮挡眼镜腿，佩戴和取下更方便", 3, "否", "否", "是", "否", "否", "否", "否", "否"],
  ["R-20260818-A7F3-0002", "2026-08-18 09:28:00", "", "是", "女", 34, 4.7, 5.4, "A－水平", "", "小", "耳挂式", "耳挂更稳，走动时不容易移位", 4, "是", "是", "否", "否", "否", "否", "否", "否"],
  ["R-20260818-A7F3-0003", "2026-08-18 09:43:00", "周婷", "否", "女", 26, 5.0, 5.9, "C－倾斜大于45°", "", "中", "耳夹式", "夹在耳朵上更轻便，也不影响发型", 2, "否", "否", "否", "否", "否", "否", "否", "否"],
  ["R-20260818-A7F3-0004", "2026-08-18 10:02:00", "陈伟", "否", "男", 41, 6.1, 6.8, "D－其他", "接近垂直佩戴", "大", "耳挂式", "夹式容易压痛，耳挂式受力更分散", 5, "否", "否", "是", "是", "是", "否", "否", "是"],
  ["R-20260818-A7F3-0005", "2026-08-18 10:19:00", "徐佳", "否", "女", 31, 5.5, 6.2, "B－倾斜约45°", "", "中", "耳夹式", "体积小，收纳方便，佩戴时没有明显负担", 1, "否", "否", "否", "否", "否", "否", "否", "否"],
];

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const csvText = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
const outputDir = path.resolve("outputs", "ear-survey-sample");
await fs.mkdir(outputDir, { recursive: true });
const csvPath = path.join(outputDir, "耳部用户研究_5份模拟数据.csv");
await fs.writeFile(csvPath, `\uFEFF${csvText}`, "utf8");

const workbook = await Workbook.fromCSV(csvText, { sheetName: "模拟调查数据" });
const sheet = workbook.worksheets.getItem("模拟调查数据");
sheet.freezePanes.freezeRows(1);
sheet.getRange("A1:V6").format.wrapText = true;
sheet.getRange("A1:V1").format = {
  fill: "#DCE6F1",
  font: { bold: true, color: "#1F1F1F" },
  wrapText: true,
};
sheet.getRange("A1:V6").format.autofitColumns();
sheet.getRange("A1:V6").format.autofitRows();
for (const col of ["A", "B", "G", "H", "I", "L", "M", "N"]) {
  sheet.getRange(`${col}1:${col}6`).format.columnWidth = col === "M" ? 28 : 18;
}

const inspection = await workbook.inspect({
  kind: "table",
  range: "模拟调查数据!A1:V6",
  include: "values,formulas",
  tableMaxRows: 6,
  tableMaxCols: 22,
  maxChars: 12000,
});
await fs.writeFile(path.join(outputDir, "inspection.ndjson"), inspection.ndjson, "utf8");

const preview = await workbook.render({
  sheetName: "模拟调查数据",
  range: "A1:V6",
  scale: 1,
  format: "png",
});
await fs.writeFile(path.join(outputDir, "preview.png"), new Uint8Array(await preview.arrayBuffer()));

const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(path.join(outputDir, "verification-only.xlsx"));

console.log(JSON.stringify({ csvPath, rowCount: rows.length, columnCount: headers.length }, null, 2));
