# AuNote 项目交接说明

更新日期：2026-09-14

当前正式版本：V1.3.7

## 项目与地址

- 本地目录：`D:\Harry\Research tool`
- GitHub仓库：<https://github.com/HarryAuu999/field-research-data-tool>
- GitHub Pages：<https://harryauu999.github.io/field-research-data-tool/>
- 产品定位：主要在iPhone上使用的本地离线PWA，供研究人员逐题记录调查数据，导出CSV，并用完整JSON备份或恢复整个工具。

## 必须遵守的边界

- 先阅读根目录 `AGENTS.md`，再修改代码。
- 程序更新不得清空、覆盖或迁移已有问卷、草稿和记录。
- 问卷以 `id + version` 区分版本，不得静默覆盖已有的同名版本。
- 研究CSV、完整备份及含参与者信息的文件不得提交到公开仓库。
- 删除、重命名、清理文件前，必须先取得用户明确确认。
- 不要修改或混入独立项目 `earclip-force-curve-tool` 的文件。
- “已编码、已测试、已提交、已推送、已部署、iPhone实机验证”是不同状态，交接时必须分开说明。

## V1.3.7 已实现

- 新安装只内置一份“佩戴耳厚数据采集 V1.1”示例问卷；更新旧设备时，不主动删除其已有V1.0或其他问卷。
- 问卷管理支持复制和删除。复制后留在管理页，用户自行打开副本。
- 点击问卷进入概览，底部固定按钮为“选择此问卷”；选择后回到主页，不会直接开始填写。
- 概览页可编辑问卷标题、背景信息和问题；支持新增、删除及长按拖动排序。拖动时使用跟手浮动卡片、原位占位和相邻问题让位动画；浮起后由触摸事件接管手势，避免iOS继续拖动页面，并抑制长按文字选择。
- 点击问题卡片进入问题编辑。题型在锚定气泡中选择；输入控件会按题型调用文字、整数或小数键盘。
- 调整问题顺序后概览底部操作会立即变为“保存问卷”；题型选择气泡不再显示“取消”，点击气泡外部或按Esc即可关闭。
- 从问题编辑完成返回或放弃修改返回时，问卷概览恢复进入问题前的滚动位置；手机编辑输入框避免触发iOS自动缩放。
- 问题修改只有点击“完成”才写入问卷编辑草稿。直接返回时提示“放弃更改／继续编辑”，再次进入编辑页时临时界面状态会重置并回到页面顶部。
- 离开有未保存改动的问卷概览时也会提示“放弃更改／继续编辑”。
- 无记录且无草稿的问卷保存编辑后替换原空模板，并更新版本号；已有记录或草稿的问卷保存后生成新版本，旧问卷和旧数据完整保留，新版本自动成为当前问卷。
- 主页显示当前问卷背景；支持草稿、记录查看与修改、CSV导出、完整JSON备份和恢复。
- 首页记录入口使用“已记录样本”，避免把一份参与者记录误称为一份问卷。
- 样本列表页标题统一为“已记录样本”；列表左滑只显示删除垃圾桶，不提供复制。记录详情无需“编辑记录”按钮，直接点击问题修改；已有样本修改不写入问卷草稿，返回时依次回到记录详情、样本列表和主页。
- 样本列表恢复为紧凑行式布局，左滑后垃圾桶显示在移动内容框外；主页与返回页顶部栏尺寸统一，并放大返回图标。
- 问卷概览保存成功提示显示在底部操作栏上方，不遮挡按钮；其他Toast仍使用默认位置。
- 特定问卷可配置简易分析；当前示例包含水平和倾斜耳厚的直方图、KDE曲线、正态参考曲线、P20/P50/P80及触摸查看P值。
- `distribution`继续兼容；新增通用`descriptiveDistribution`配置与描述性统计摘要，并提供AI转换指南、JSON Schema和两份示例问卷。
- 应用图标改用`assets/App-icon2.svg`，并生成180、192和512像素PNG图标。
- Android安装清单使用192和512像素PNG普通图标并提供稳定PWA ID；SVG继续作为网页favicon。新增Pixel 7核心流程测试，覆盖填写、保存、修改、触摸左滑、CSV和离线重开。
- 更新提示包含版本概况，并提供“立即更新”“此次不更新”“跳过此版本”。
- 入口样式、主模块及其依赖使用随版本变化的URL；即使设备仍由V1.0.0等旧Service Worker控制，也不会继续命中过期的静态资源缓存。
- 问卷JSON校验已从主应用拆到独立模块；统计、问卷编辑、校验、版本、基础UI和Android均有可单独运行的快速测试，开发时按改动范围选择最小测试集。
- AI转换普通问卷时只需读取`docs/questionnaire-ai-guide.md`，不必扫描整个仓库或主应用代码；新增`tools/validate-questionnaire.mjs`，可用与PWA一致的校验逻辑快速预检JSON。
- 问卷导入兼容常见AI输出中的字符串`"1"`和单层`questionnaire`/`template`包装；无效JSON或结构错误会显示文件名、实际schemaVersion类型和顶层字段，标准问卷规范仍要求数字`schemaVersion: 1`。
- 顶层可选`recordLabelField`用于明确指定样本列表名称字段；旧问卷未配置时兼容识别`name`、`participantName`、姓名类短文字或第一道短文字题，不迁移记录数据。
- 相邻题目可在JSON中设置相同`page`值实现多题同页；未配置的旧问卷继续一页一题。该配置只影响填写布局，不改变答案、IndexedDB或CSV，手机问卷编辑器不提供配置入口但会保留现有值。
- 新增多题同页与样本名称的独立浏览器测试；AI指南、完整模板规范、JSON Schema和示例问卷已同步上述规则。
- AI转换任何来源问卷前必须执行通用能力差距检查，覆盖布局、交互、输入校验和分析要求；部分支持、不支持或信息不足时先向用户说明降级差异，不能把Schema通过等同于原问卷完整实现。
- 问卷概览的问题和说明支持左滑显示单个删除垃圾桶；删除先进入问卷修改稿，仍需点击“保存问卷”才生成新版本或替换无记录模板。横向手势确认后阻止纵向页面滚动，点击已展开行之外的空白区域会收起操作；问卷和样本列表共用相同的外部收起规则。

## 代码结构

- `index.html`：应用入口和通用弹窗。
- `styles.css`：全局界面与手机响应式样式。
- `js/app.js`：页面路由、填写、记录、CSV、备份、更新提示和简易分析。
- `js/db.js`：IndexedDB数据读写。
- `js/default-template.js`：内置V1.1示例问卷和分析预设。
- `js/questionnaire-editor.js`：问卷复制、编辑、题型与版本处理。
- `js/questionnaire-schema.js`：schemaVersion 1问卷与分析配置校验。
- `js/question-reorder.js`：手机端长按拖动问题排序。
- `sw.js`：离线缓存、应用版本及更新概况。
- `docs/questionnaire-template.md`：问卷JSON格式说明。
- `tests/e2e.mjs`：主要填写、数据与离线回归测试。
- `tests/editor-e2e.mjs`：问卷复制、编辑、排序和版本规则测试。
- `tests/statistics.mjs`、`tests/questionnaire-editor.mjs`、`tests/questionnaire-schema.mjs`：纯逻辑快速测试。
- `tests/version-consistency.mjs`、`tests/ui-smoke.mjs`、`tests/android-smoke.mjs`：版本缓存、基础手机UI和Android核心流程测试。

## 本地运行与测试

在项目根目录启动：

```powershell
python -m http.server 4173
```

浏览器打开 `http://127.0.0.1:4173/`。

小修改先只检查受影响模块；正式发布前运行完整测试：

```powershell
node tests/statistics.mjs
node tests/questionnaire-editor.mjs
node tests/questionnaire-schema.mjs
node tests/version-consistency.mjs
node tests/ui-smoke.mjs
node tests/questionnaire-layout-e2e.mjs
node tests/android-smoke.mjs
node tests/e2e.mjs
node tests/editor-e2e.mjs
```

发布前还必须确认 `js/app.js` 和 `sw.js` 中的应用版本一致。提交时应逐项指定文件，禁止把研究CSV或完整备份一起加入。

## 当前数据与版本规则

- IndexedDB中的本地数据与程序静态文件分开保存，正常更新Service Worker不会清空调查数据。
- 新安装只创建内置V1.1示例；旧设备若已有V1.0，升级后仍会保留，用户可以在界面中自行决定是否删除。
- 一名参与者的一条记录只占一次统计权重；同一测量位置的1至3次测量会先在参与者内部计算平均值。
- CSV用于人工审查和电脑分析；完整JSON用于换机或数据丢失风险下的低频恢复。

## 工作区中未纳入公开仓库的内容

- `analysis/`：历次阶段分析报告和脚本，不属于本次PWA发布。
- `assets/*.csv`：含研究数据，已通过 `.gitignore` 防止误提交，文件本身没有被删除。
- `design-qa.md`：早期检查记录，部分内容已经过时；目前仅列为后续确认的归档或删除候选，未经用户确认不要处理。

## 下一任务建议先做什么

1. 读取 `AGENTS.md`、本文件、`README.md` 和当前 `git status`。
2. 让用户报告V1.3.7在iPhone及Android主屏幕PWA中的更新结果与具体问题。
3. 只修改用户明确提出的部分；未变化模块做针对性而非重复性测试。
4. 每次正式发布前仍执行两套完整回归测试，并核对GitHub Pages真实访问版本。

当前代码已完成本地自动化验证、Git提交和GitHub Pages部署；iPhone实机验证仍由用户在本次发布后进行。
