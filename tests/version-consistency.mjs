import assert from "node:assert/strict";
import fs from "node:fs/promises";

const [indexSource, appSource, workerSource, dbSource, manifestSource] = await Promise.all([
  fs.readFile("index.html", "utf8"),
  fs.readFile("js/app.js", "utf8"),
  fs.readFile("sw.js", "utf8"),
  fs.readFile("js/db.js", "utf8"),
  fs.readFile("manifest.webmanifest", "utf8")
]);

export const appVersion = appSource.match(/const APP_VERSION = "([^"]+)";/)?.[1];
const workerVersion = workerSource.match(/const APP_VERSION = "([^"]+)";/)?.[1];
assert.ok(appVersion && appVersion === workerVersion, "app.js 与 sw.js 的应用版本不一致");
assert.ok(indexSource.includes(`./styles.css?v=${appVersion}`), "入口样式缺少当前版本参数");
assert.ok(indexSource.includes(`./js/app.js?v=${appVersion}`), "入口脚本缺少当前版本参数");
assert.ok(indexSource.includes(`./manifest.webmanifest?v=${appVersion}`), "Manifest 引用缺少当前版本参数");
assert.ok(workerSource.includes(`./manifest.webmanifest?v=${appVersion}`), "Manifest 未按当前版本加入离线缓存");
assert.ok(dbSource.includes('const DB_NAME = "research-notebook-beta-github"'), "Beta 不得使用正式版数据库");
assert.ok(workerSource.includes('const CACHE_NAME = `aunote-beta-${APP_VERSION}`'), "Beta 不得使用正式版缓存命名");
assert.ok(workerSource.includes('key.startsWith("aunote-beta-")'), "Beta 更新不得清理正式版缓存");
assert.ok(indexSource.includes("./assets/beta-icon.svg"), "Beta 入口缺少黄色图标");
assert.ok(manifestSource.includes("./assets/beta-icon-192.png"), "Beta Manifest 缺少黄色图标");

for (const moduleName of ["db", "default-template", "questionnaire-editor", "questionnaire-schema", "question-reorder", "statistics", "image-range", "image-range-heatmap", "xlsx-export"]) {
  assert.ok(appSource.includes(`./${moduleName}.js?v=${appVersion}`), `${moduleName}.js 导入缺少当前版本参数`);
  assert.ok(workerSource.includes(`./js/${moduleName}.js?v=${appVersion}`), `${moduleName}.js 未按当前版本加入离线缓存`);
}

console.log(JSON.stringify({ passed: true, version: appVersion }, null, 2));
