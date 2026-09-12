# AuNote 项目协作说明

## 项目定位

AuNote 是一个主要在 iPhone 上使用的本地离线 PWA，帮助研究人员逐项记录问卷数据，并导出 CSV 或完整 JSON 备份。

## 运行与测试

- 本地预览：在项目根目录运行 `python -m http.server 4173`，打开 `http://127.0.0.1:4173/`。
- 自动测试：运行 `node tests/e2e.mjs` 和 `node tests/editor-e2e.mjs`；测试需要本机 Chrome。
- 发布前核对 `js/app.js` 与 `sw.js` 的应用版本号一致。

## 技术与目录

- 使用原生 HTML、CSS、JavaScript，无构建步骤。
- `js/app.js`：页面、问卷校验、CSV、备份和简易分析。
- `js/db.js`：IndexedDB 数据读写。
- `js/default-template.js`：内置问卷和应用侧分析预设。
- `js/questionnaire-editor.js`：问卷复制、版本、题型和编辑数据操作。
- `js/question-reorder.js`：手机端长按拖动排序。
- `docs/questionnaire-template.md`：现役问卷 JSON 格式说明。
- `tests/e2e.mjs`：手机尺寸端到端回归测试。

## 数据与修改边界

- 程序更新不得清空或覆盖已保存问卷、草稿和记录。
- 问卷的 `id + version` 共同确定独立版本；不得静默覆盖同名版本。
- 不要把研究CSV、完整备份或含参与者信息的文件提交到公开仓库。
- 删除、重命名或清理文件前必须取得用户明确确认。
- 不要修改或混入独立项目 `earclip-force-curve-tool` 的文件。

## 当前状态

- 当前正式应用版本：V1.2.0。
- GitHub Pages：`https://harryauu999.github.io/field-research-data-tool/`。
- 当前问卷、支持题型和分析配置以代码及 `docs/questionnaire-template.md` 为准。
