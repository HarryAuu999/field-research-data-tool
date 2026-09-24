# AuNote 项目协作说明

## 项目定位

AuNote 是一个主要在 iPhone 上使用的本地离线 PWA，帮助研究人员逐项记录问卷数据，并导出 Excel 或完整 JSON 备份。

## 运行与测试

- 本地预览：在项目根目录运行 `python -m http.server 4173`，打开 `http://127.0.0.1:4173/`。
- 快速测试：统计改动运行 `node tests/statistics.mjs`；图片标注数据与XLSX运行 `node tests/image-range.mjs`；问卷编辑纯数据逻辑运行 `node tests/questionnaire-editor.mjs`；问卷 JSON 校验运行 `node tests/questionnaire-schema.mjs`；版本与缓存资源引用运行 `node tests/version-consistency.mjs`。
- 浏览器测试：顶部栏、基础手机布局和样本左滑运行 `node tests/ui-smoke.mjs`；JSON配置的多题同页和样本名称运行 `node tests/questionnaire-layout-e2e.mjs`；图片标注与XLSX运行 `node tests/image-range-e2e.mjs`；Android Manifest、图标资源和 Pixel 视口运行 `node tests/android-smoke.mjs`；问卷编辑界面与排序运行 `node tests/editor-e2e.mjs`；完整填写、样本、分析、Excel导出、备份和离线运行 `node tests/e2e.mjs`。测试需要本机 Chrome及已启动的本地预览服务。
- 开发过程中优先运行与改动范围对应的最小测试集；除非改动影响跨模块行为，不要在每个小编辑后反复运行完整 E2E。
- 修改 `js/db.js`、数据迁移、备份恢复、Service Worker、离线逻辑或跨模块状态时，必须运行全部测试。正式发布前也必须运行全部测试。
- 发布前核对 `js/app.js` 与 `sw.js` 的应用版本号一致。
- 未经用户明确要求，不得推送或发布到 GitHub；先保留本地版本供用户网页验证。

## 技术与目录

- 使用原生 HTML、CSS、JavaScript，无构建步骤。
- `js/app.js`：页面、Excel导出、备份和简易分析。
- `js/db.js`：IndexedDB 数据读写。
- `js/default-template.js`：内置问卷和应用侧分析预设。
- `js/questionnaire-editor.js`：问卷复制、版本、题型和编辑数据操作。
- `js/questionnaire-schema.js`：schemaVersion 1 问卷与分析配置校验。
- `js/question-reorder.js`：手机端长按拖动排序。
- `tools/validate-questionnaire.mjs`：用与PWA一致的校验逻辑预检AI生成问卷。
- `docs/questionnaire-template.md`：现役问卷 JSON 格式说明。
- `tests/e2e.mjs`：手机尺寸端到端回归测试。

## 数据与修改边界

- 程序更新不得清空或覆盖已保存问卷、草稿和记录。
- 问卷的 `id + version` 共同确定独立版本；不得静默覆盖同名版本。
- 不要把研究Excel文件、完整备份或含参与者信息的文件提交到公开仓库。
- 删除、重命名或清理文件前必须取得用户明确确认。
- 不要修改或混入独立项目 `earclip-force-curve-tool` 的文件。

## AI转换问卷规则

- 将Word、PDF、Markdown或自然语言问卷转换为AuNote JSON时，必须先检查原始要求能否由当前schemaVersion 1和PWA实现。
- 特别检查同页显示、分页与分组、矩阵题、条件跳题、数字范围、小数精度、特殊交互、分析和对比展示。
- 发现部分支持、不支持或信息不足的要求时，必须在交付JSON之前提醒用户，说明降级处理和实际差异；不得静默忽略，不得发明未支持字段，也不得把Schema校验通过等同于完整满足原问卷。

## 当前状态

- 新设备或新 AI 接手前先读 `docs/HANDOFF.md`，并检查当前分支与 GitHub 远端差异；不要把已部署的独立 Beta 站点误认为 Beta 源码已上传 GitHub。
- 当前正式应用版本：V1.3.8；独立测试 PWA 版本：V1.4.2-beta.3。Beta 与正式版使用不同站点，不共享浏览器本地数据。
- GitHub Pages：`https://harryauu999.github.io/field-research-data-tool/`。
- 当前问卷、支持题型和分析配置以代码及 `docs/questionnaire-template.md` 为准。
