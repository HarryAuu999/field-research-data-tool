# AuNote 项目协作说明

## 项目定位

AuNote 是一个主要在 iPhone 上使用的本地离线 PWA，帮助研究人员逐项记录问卷数据，并导出 Excel 或完整 JSON 备份。

## 运行与测试

- 本地预览：在项目根目录运行 `python -m http.server 4173`，打开 `http://127.0.0.1:4173/`。
- 快速测试：统计改动运行 `node tests/statistics.mjs`；图片标注数据与XLSX运行 `node tests/image-range.mjs`；问卷编辑纯数据逻辑运行 `node tests/questionnaire-editor.mjs`；问卷 JSON 校验运行 `node tests/questionnaire-schema.mjs`；版本与缓存资源引用运行 `node tests/version-consistency.mjs`。
- 图片角度改动优先运行 `node tests/image-angle.mjs`、`node tests/image-angle-e2e.mjs`；组合分析运行 `node tests/multi-analysis-e2e.mjs`（数值、频数、热力图与角度四类共存）。
- 更新检查交互与网络超时运行 `node tests/update-check-e2e.mjs`（需要本地预览服务和 Chrome）。
- 浏览器测试：顶部栏、基础手机布局和样本左滑运行 `node tests/ui-smoke.mjs`；JSON配置的多题同页和样本名称运行 `node tests/questionnaire-layout-e2e.mjs`；图片标注与XLSX运行 `node tests/image-range-e2e.mjs`；Android Manifest、图标资源和 Pixel 视口运行 `node tests/android-smoke.mjs`；问卷编辑界面与排序运行 `node tests/editor-e2e.mjs`；完整填写、样本、分析、Excel导出、备份和离线运行 `node tests/e2e.mjs`。测试需要本机 Chrome及已启动的本地预览服务。
- 开发过程中优先运行与改动范围对应的最小测试集；除非改动影响跨模块行为，不要在每个小编辑后反复运行完整 E2E。
- 修改 `js/db.js`、数据迁移、备份恢复、Service Worker 的运行逻辑、离线逻辑或跨模块状态时，运行完整回归。仅显示层、图片资源、文档或独立纯函数的更新，优先运行对应单元测试、相关浏览器测试及版本检查；正式发布也按实际风险决定，不因单纯版本号或缓存清单更新重复跑所有无关用例。
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
- `docs/image-range-heatmap-analysis.md` 与 `tools/render-image-range-heatmaps.py`：从导出XLSX离线复现人数热力图；不要提交参与者数据或输出图。
- `docs/questionnaire-template.md`：现役问卷 JSON 格式说明。
- `js/image-angle.js` 与 `docs/image-angle-preview.md`：图片二维角度采集、极坐标直方图、Excel复现口径；示例JSON只供手动导入，不能自动安装到现有用户库。
- `tests/e2e.mjs`：手机尺寸端到端回归测试。
- `assets/base-images/README.md`：通用底图库及贡献规范。新底图按部位分类并登记来源许可；现有资源不搬动、覆盖或擅删，`ear-pain-points.png`仅为历史问卷兼容保留。仅收录资源不自动内置PWA，不为文档目录变更修改版本或SW。

## 数据与修改边界

- 后续新增或调整的滑块统一采用圆头轨道、跑道圆拖动钮；参考角度滑块35.2×22px、白底重点色描边，不改成正圆。未经单独要求，不为统一样式批量修改既有滑块。

- 程序更新不得清空或覆盖已保存问卷、草稿和记录。
- 问卷的 `id + version` 共同确定独立版本；不得静默覆盖同名版本。
- 不要把研究Excel文件、完整备份或含参与者信息的文件提交到公开仓库。
- 删除、重命名或清理文件前必须取得用户明确确认。
- 不要修改或混入独立项目 `earclip-force-curve-tool` 的文件。

## AI转换问卷规则

- 图片来源先分流：使用已随PWA发布并离线缓存的默认底图时，直接引用`./assets/...`，不重复内嵌；当前默认耳图为ear-side.png、ear-side-section.png、ear-back.png。用户自定义图片才内嵌data URI，不得为方便研究上传到公共项目，owner同样适用。仅在仓库中存在但未部署缓存的资源不能直接引用。
- 范围标注与角度导出的`imageSrc`保留内置图片路径；内嵌图片仅写“嵌入图片（见问卷JSON）”，按questionId回查原问卷。不得逐点重复写入Base64。相关修复运行`node tests/embedded-image-export-e2e.mjs`；真实研究数据不可加入测试夹具。

- **先读 [AI 问卷转换指南](docs/questionnaire-ai-guide.md)**，以其中的文案克制原则、分析自动识别规则和能力差距检查为准。必要时查阅 [问卷字段及分析配置](docs/questionnaire-template.md)。
- 转换后的题目必须简洁忠实：不得为展示专业性自动添加解释、测量免责声明、选项或冗长 `description`。原研究必需的操作与测量口径必须保留。
- 即使用户没有提出简易分析，也要主动识别可分析的数值指标、评分/选择题和图片范围标注，并在**现有 schema 支持且没有语义歧义**时自动配置基础分析。不要把姓名、编号当成统计指标，不要为了分析改变原题型。
- 旧字段 `analysis` 仍支持单一类型；新版 `analyses` 数组允许组合数值分布、评分/选择题频数和图片热力图，不能在同一问卷同时填写这两个配置字段。
- 研究涉及佩戴倾角、产品方向等二维角度时，主动建议 `imageAngle` / `angleDistribution`。先确认底图、圆心、0°、旋转正负、范围、步长及组距；不要擅用耳朵示例参数。角度可与其他分析共存；360°环绕、3D与个人角度区间尚不支持。
- 对单一合法、确定的基础分析，主动配置后仅用一句话在问卷 JSON **之外**说明，不逐题长篇解释。
- 将Word、PDF、Markdown或自然语言问卷转换为AuNote JSON时，必须先检查原始要求能否由当前schemaVersion 1和PWA实现。
- 特别检查同页显示、分页与分组、矩阵题、条件跳题、数字范围、小数精度、特殊交互、分析和对比展示。
- 发现部分支持、不支持或信息不足的要求时，必须在交付JSON之前提醒用户，说明降级处理和实际差异；不得静默忽略，不得发明未支持字段，也不得把Schema校验通过等同于完整满足原问卷。

## 当前状态

- 新设备或新 AI 接手前先读 `docs/HANDOFF.md`，并检查当前分支与 GitHub 远端差异；不要把已部署的独立 Beta 站点误认为 Beta 源码已上传 GitHub。
- 本次修复版本：V1.4.11（内嵌图片标注导出）；实时发布状态以GitHub部署及站点版本为准。独立测试 PWA 为 V1.4.2-beta.5，使用独立路径及数据库。
- 正式版 GitHub Pages：`https://harryauu999.github.io/field-research-data-tool/`；Beta GitHub Pages：`https://harryauu999.github.io/aunote-beta/`。
- 当前问卷、支持题型和分析配置以代码及 `docs/questionnaire-template.md` 为准。
