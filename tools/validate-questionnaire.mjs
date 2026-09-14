import fs from "node:fs/promises";
import path from "node:path";
import { validateTemplate } from "../js/questionnaire-schema.js";

const filePath = process.argv[2];
if (!filePath) {
  console.error('用法：node tools/validate-questionnaire.mjs "问卷.json"');
  process.exit(2);
}

try {
  const source = await fs.readFile(filePath, "utf8");
  if (source.charCodeAt(0) === 0xFEFF) throw new Error("文件包含 UTF-8 BOM；请另存为不带 BOM 的 UTF-8 JSON");

  let input;
  try {
    input = JSON.parse(source);
  } catch (error) {
    throw new Error(`JSON 语法无效：${error.message}。不要包含 Markdown 代码围栏、注释或尾随逗号`);
  }

  if (input?.questionnaire && input.schemaVersion === undefined) {
    throw new Error("问卷被额外包在 questionnaire 属性中；schemaVersion、id、version、title 和 fields 必须直接位于最外层");
  }
  if (input?.format === "research-notebook-backup") {
    throw new Error("这是完整备份格式，不是单份问卷 JSON；请使用 AuNote 的“完整备份与恢复”入口");
  }

  const template = validateTemplate(input);
  console.log(JSON.stringify({
    valid: true,
    file: path.resolve(filePath),
    key: template.key,
    title: template.title,
    fields: template.fields.length,
    analysis: template.analysis?.type || null
  }, null, 2));
} catch (error) {
  console.error(`验证失败：${error.message}`);
  process.exit(1);
}
