# AuNote 交接说明

更新日期：2026-09-27。本文是开发交接入口；问卷字段细节以 docs/questionnaire-template.md 和 js/questionnaire-schema.js 为准，协作规则以根目录 AGENTS.md 为准。

## 先分清三种状态

| 对象 | 当前状态 | 证据与限制 |
| --- | --- | --- |
| 正式版 | V1.4.0，包含图片范围标注和人数热力图 | https://harryauu999.github.io/field-research-data-tool/；源码为本仓库 `main`。仓库还包含独立的 `earclip-force-curve-demo/`，AuNote 开发不要修改它。 |
| Beta 源码 | 独立分支 `codex/aunote-beta-1.4.2`，从 V1.4.2-beta.3 继续迭代 | https://github.com/HarryAuu999/field-research-data-tool/tree/codex/aunote-beta-1.4.2；调整容差和图片显示面积先在这里验证。 |
| Beta 网页 | 独立公开 GitHub Pages | https://harryauu999.github.io/aunote-beta/；发布仓库 https://github.com/HarryAuu999/aunote-beta。源码分支更新后，还需单独更新发布仓库。 |

正式版和 Beta 是不同 origin、不同 PWA 安装入口与 Service Worker 作用域，浏览器 IndexedDB 不共享。即便同一站点，Safari 网页和“添加到主屏幕”的 PWA 也可能出现不同本地存储空间；收集数据时始终从同一图标进入。Beta 黄色图标和“AuNote Beta”名称用于避免误开正式版。切勿把正式研究数据放入测试版。

## 项目目标与工作边界

AuNote 是面向现场用户研究的轻量、离线优先 PWA，主要在 iPhone 上逐题记录本地样本，并导出 XLSX 或完整 JSON 备份。原生 HTML、CSS、ES modules；没有构建步骤或大型框架。用户重视简洁、速度、低维护成本；不要为小功能引入重型工程体系。

程序更新不得清空或静默覆盖问卷、草稿、记录。问卷以 id + version 为独立版本。未经用户明确要求，不推送或发布 GitHub；先按任务范围修改并让用户验证。删除、重命名或清理文件前先征得明确确认。不得提交研究表格、完整备份或参与者信息，也不得混入独立项目 earclip-force-curve-tool。工作区的 analysis/、demo/、design-qa.md 是未跟踪的既有材料；未经确认不要加入提交、移动或删除。

## 用户操作与状态流

- 首页展示当前问卷、背景、该问卷的已记录样本数。无草稿时“开始填写”，有草稿时“继续填写／废弃草稿”。“简易分析”只在问卷配置了 analysis 时出现；“导出数据”仍生成 XLSX，按当前问卷导出，不是整个数据库。完整 JSON 备份在“数据备份/恢复”。
- 问卷管理可导入 JSON、切换问卷；左滑问卷出现复制和删除。打开问卷进入概览。未修改时底部为“选择此问卷”；有修改时为蓝色“保存问卷”和白色“另存为副本”。问题可左滑删除、长按跟手排序。点击问题编辑后只有“完成”才把改动写入问卷修改稿；返回会提示放弃或继续，并恢复概览滚动位置。问卷修改稿保存在 settings，而不是填写草稿。已有填写草稿时不允许编辑该问卷。
- “保存问卷”递增同一 id 的 version，并设为当前；如果旧版本没有记录和填写草稿，可原子替换该空版本；否则保留旧问卷和样本，生成独立新版本。“另存为副本”产生新 id、不带旧样本或草稿，并设为当前。保存成功提示出现在底部按钮上方。删除问卷会级联删除对应记录和草稿，必须经确认。
- 填写时默认每题一页。相邻题设置相同 page 才会同页；section 保留为说明页；imageRange 必须独占一页。前进会校验本页，结束时校验全部字段并保存一条记录。新填写的草稿按当前问卷写入 IndexedDB；返回首页保留草稿，完成后删除草稿。
- “已记录样本”列表左滑只提供删除；点击样本进入记录详情，再点击问题直接修改。编辑模式使用内存中的现有答案，不创建新样本或问卷填写草稿；返回或保存后应先回记录详情，再回样本列表，不可跳到首页并提示废弃草稿。样本标题优先取 recordLabelField，旧问卷有姓名字段的兼容兜底见 js/app.js 的 recordName。
- 横向滑动确认后应由对应手势接管，避免页面随手指上下滑动；点击展开行之外的页面区域应收起操作。不要重新引入大外框、内嵌垃圾桶或 iOS 长按放大镜。

## 问卷 JSON 与 AI 转换

规范维持 schemaVersion 数字 1。普通问卷转换首先读 docs/questionnaire-ai-guide.md，再按需读 docs/questionnaire-template.md、docs/questionnaire.schema.json 和 examples/；不要为了普通转换重读整个 135 KB 的 js/app.js。运行 node tools/validate-questionnaire.mjs 问卷.json 做与 PWA 一致的校验。导入兼容字符串 "1" 和单层 questionnaire/template 包装，但规范输出仍应是顶层数字 1 的单个 JSON 对象。

AI 必须先报告原问卷中 AuNote 部分支持、不支持或信息不足的要求，不得静默降级、猜必填、发明字段或研究统计方法。1–5 分允许小数时用 number 而非整数 rating。recordLabelField 指向样本名称字段；page 仅在明确要求同页时配置。当前一份问卷的 analysis 只能选择一个类型：旧 distribution、descriptiveDistribution 或 imageRangeHeatmap；不能假定数字分析和热力图可同时配置。

## 图片范围标注：真实实现

内置问卷“耳挂耳机接触与疼痛范围记录”（`examples/ear-image-range-test.json`）有 3 个研究问题、7 个页面：姓名；接触范围的侧面／截面／背面；疼痛区域的侧面／截面／背面。三张底图在 `assets/`。正式版 V1.4.0 会把这份问卷加入现有用户的问卷库，不覆盖任何现有问卷、草稿和记录。全新安装另外获得九题的“佩戴耳厚数据采集 V1.2”；旧版 V1.1 保留原有 Q10、Q11，不做迁移。

imageRange 答案仍放在 record.answers[字段ID]，结构为 { version: 1, strokes: [...] }；每笔包含 id、annotationType、level、brushSize、points，其中 points 是相对于原图宽高的 [x,y] 归一化坐标。原图文件没有被裁切；画面左右贴边只是 CSS 布局变化，不改变坐标。Pointer Events、pointer capture 和 touch-action: none 确保手指画线时页面不滚动。默认新笔在结束时以原图宽度 0.3% 的容差简化并做平滑路径显示；画笔大小可调，保存到每笔。支持撤销上一笔，以及确认后清除当前图片的全部等级。切换疼痛等级不会删除已有笔画，Level 2 在重叠处优先显示。

简易分析由问卷 analysis.type = imageRangeHeatmap 驱动；js/image-range-heatmap.js 将每名参与者的同级笔画栅格化为二值 mask，每个位置每人最多计 1 次，再累计真实人数。Level 2 区域从同人 Level 1 中扣除。两次 box blur 只用于可视化边缘，不能改变原始人数；色标为 0 到实际样本数，三个视图共用人数尺度。尚未实现高级报告、热力图导出或混合分析类型。

## 数据、导出与恢复

IndexedDB 名称 research-notebook，版本 1；js/db.js 中四个 store 为 templates、records、drafts、settings。记录保留 templateKey、answers、首次保存与最后修改时间。新增 imageRange 是旧答案对象中的增量字段，旧问卷和旧记录不需要迁移。

“导出数据”生成单个 XLSX：Responses 为一条样本一行；重复数字题另有每次原值、均值和最大差值列；图片题在 Responses 给出笔数摘要。Annotations 为逐点长表，包含 sampleId、recordNumber、questionId、view、annotationType、level、strokeId、pointOrder、normalizedX/Y、brushSize、imageSrc、imageWidth/Height。不是 mask 展开表；后续电脑分析可从原始笔画重新栅格化。没有 CSV 导出入口。

完整 JSON 备份涵盖全部 templates、records、drafts、settings；恢复会替换本入口的整个数据库，必须确认，且程序先生成“恢复前自动备份”。不要把“导出数据”误当作完整备份。任何公开提交之前检查 assets/*.csv、outputs/ 与其他参与者数据未被加入。Beta 部署包只包含应用运行文件；本机 .beta-site/ 是被忽略的独立发布暂存目录，不是 GitHub 项目源码的一部分，里面也不应加入个人数据。

## 代码地图与最小测试

| 功能 | 主要文件 | 优先测试 |
| --- | --- | --- |
| 页面、导航、记录、问卷编辑、导出 | js/app.js、styles.css | tests/ui-smoke.mjs、tests/editor-e2e.mjs、tests/e2e.mjs |
| IndexedDB、备份 | js/db.js、js/app.js | tests/e2e.mjs；发布前全套 |
| 问卷规范与预检 | js/questionnaire-schema.js、docs/questionnaire.schema.json、tools/validate-questionnaire.mjs | tests/questionnaire-schema.mjs |
| 统计与热力图 | js/statistics.js、js/image-range-heatmap.js | tests/statistics.mjs、tests/image-range.mjs、tests/image-range-e2e.mjs |
| 笔画、触控、画笔 UI | js/image-range.js、js/app.js、styles.css | tests/image-range.mjs、tests/image-range-e2e.mjs |
| 离线、版本、Android 图标 | sw.js、manifest.webmanifest、index.html、assets/ | tests/version-consistency.mjs、tests/android-smoke.mjs、tests/e2e.mjs |

本地在项目根目录运行 python -m http.server 4173，再打开 http://127.0.0.1:4173/ 。浏览器测试需要本机 Chrome。2026-09-27 的正式版 V1.4.0 完整 11 组测试通过：statistics、image-range、questionnaire-editor、questionnaire-schema、version-consistency、ui-smoke、questionnaire-layout-e2e、image-range-e2e、android-smoke、editor-e2e、e2e。后续小改优先跑受影响测试；DB、备份、SW、离线、跨模块状态或正式发布必须跑全套。测试通过不等于真实 iPhone 已验收。

## 接手时先做

1. 先读 AGENTS.md、本文件、README.md，并检查当前分支与远端差异。正式版从 `main` 开始；Beta 迭代从 `codex/aunote-beta-1.4.2` 开始。不要把两个发布仓库或本地数据库混用。
2. 明确本次用户要求的是本地验证、更新独立 Beta，还是正式版 GitHub 发布；不要上传真实样本来换取跨设备数据同步。
3. 只改用户提出的行为，保留旧 schemaVersion 1、问卷版本、IndexedDB 和备份兼容；针对性测试后再按风险跑回归。
4. 汇报时分开写：本地实现、测试通过、本地 Git 提交、GitHub 推送、Beta 部署成功、真实设备验证。尤其不要把独立 Beta 网页部署误称为 GitHub 正式版升级。

## 待验证与保留现场

- 待验证：真实 iPhone Safari／主屏幕安装、手指连续绘制、离线重开与热力图可读性。
- GitHub 的独立 Beta 分支包含源码和本交接文档；但本机未跟踪材料、浏览器 IndexedDB 样本、Codex Sites 账号权限和未公开的真实研究数据不会随 Git 同步。另一设备开发无需重做功能，现场样本如需迁移须经用户主动使用完整 JSON 备份／恢复。
- 不处理：analysis/、demo/、design-qa.md、已有 outputs/ 和研究文件。它们仍留在原位；没有收到删除或归档确认。
- 不适用：没有获准写入的平台长期记忆；本交接文档就是应共享的知识入口，不另造记忆副本。
