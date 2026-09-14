# AuNote

AuNote 是一个主要在 iPhone 上使用的本地 PWA，用于让研究人员逐项记录用户研究数据，并导出 CSV。

当前状态：**正式版 V1.3.7**。本地自动化测试已通过，正式版本通过 GitHub Pages 发布。入口样式、Manifest 和 JavaScript 使用随版本变化的 URL，避免旧版 Service Worker 长期返回过期程序文件。

## 手机测试地址

- PWA：<https://harryauu999.github.io/field-research-data-tool/>
- GitHub仓库：<https://github.com/HarryAuu999/field-research-data-tool>

首次使用时请保持联网打开地址，确认页面正常后再添加到iPhone主屏幕。添加后应始终从同一个主屏幕图标进入，以免把数据记录在不同的本地存储空间中。

## 已实现

- 新安装只内置一份“佩戴耳厚数据采集 V1.1”示例问卷；程序更新不会删除设备上已有的旧问卷；该问卷支持每个位置填写1至3次最小接触厚度，并保留原始值、平均值和最大差值；
- 通过 JSON 导入、切换和删除不同问卷版本；
- 在问卷管理中复制问卷，并在问卷概览中直接打开标题、背景、基础问题和选项进行编辑；
- 问卷概览底部使用“选择此问卷”，选择后返回主页，不会直接开始填写；
- 问题修改只有点击“完成”才生效；直接返回可选择放弃更改或继续编辑，离开含未保存修改的问卷概览时也会提醒；
- 调整问题顺序后概览页会立即切换为“保存问卷”；题型选择器可点击外部关闭；问题编辑完成或放弃后会恢复概览页原来的阅读位置；
- 问卷概览中的问题支持左滑显示垃圾桶并加入删除修改稿；横向滑动成立后阻止页面上下滚动，点击左滑行之外的空白区域会收起操作；
- 手机编辑输入框使用不触发iOS自动放大的字号；
- 无记录且无草稿的问卷修改后替换原空模板；已有记录的问卷修改后保留旧版本，并将新版本设为当前问卷；
- 长按问题卡片后以浮动卡片跟随手指调整顺序，其他问题平滑让位；浮起后接管当前触摸，避免iOS继续拖动页面，靠近页面上下边缘时由工具自动滚动，并抑制文字选择放大镜；
- 按题逐项填写，并根据字段调用文字、整数或小数键盘；
- 问卷JSON可用`recordLabelField`指定样本列表名称字段，并可用相邻题目的相同`page`值按需实现多题同页；这两项配置不由手机问卷编辑器修改；
- 每份问卷保存一份草稿，可继续填写或废弃；
- 使用 IndexedDB 在本机保存问卷、草稿和记录；
- 查看、修改和删除已保存记录；
- “已记录样本”列表支持左滑显示垃圾桶并删除样本，不显示复制操作；从记录详情直接点击问题即可修改，不产生问卷草稿，返回时逐级回到记录详情和样本列表；
- 问卷管理的左滑操作只保留复制和删除，复制后停留在管理页；
- 新版本提示包含更新概况，并支持“此次不更新”和“跳过此版本”；
- “佩戴耳厚数据采集 V1.1”支持水平、倾斜两组耳厚分布简易分析，按参与者计算重复测量平均值，并以SVG矢量图显示实际人数、KDE曲线及P20/P50/P80；可在图表上移动查看P值，不锁定触摸方向或阻止页面滚动；
- 数字题和重复数字题可通过问卷JSON配置通用描述性统计，包括样本数、平均数、中位数、众数、极值、样本标准差和四分位数；
- 导出 UTF-8 CSV，一名参与者一行、一道题一列；
- 多选答案在一个单元格中用中文分号连接；
- 导出和恢复完整 JSON 备份；
- Service Worker 离线缓存和非强制版本更新提示。
- 使用自定义App-icon2应用图标，并生成iPhone与PWA所需的PNG尺寸。

## 本地打开

不能直接双击 `index.html`，需要用一个简单的本地网页服务打开。例如在本目录运行：

```powershell
python -m http.server 4173
```

然后访问：

```text
http://127.0.0.1:4173/
```

## 自动测试

测试脚本会使用本机 Chrome 模拟 iPhone 尺寸，完整走一遍填写、保存、修改、草稿、模板、导出、删除、备份恢复和离线流程：

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

## 重要的数据说明

- 问卷和记录保存在打开该 PWA 的设备及入口中；
- Safari 页面与添加到主屏幕后的 PWA 可能拥有彼此独立的本地数据；
- 正式采集前，应先添加到主屏幕，并始终从同一个图标打开；
- CSV用于电脑审查和分析；完整 JSON 用于恢复整个工具；
- 删除问卷会同时删除该问卷的本地记录和草稿。

## 问卷JSON

### 给AI的最省时转换方式

普通问卷无需研究整个项目或`js/app.js`。让AI只阅读[AI问卷转换指南](docs/questionnaire-ai-guide.md)，生成JSON后运行：

```powershell
node tools/validate-questionnaire.mjs "问卷.json"
```

可直接提供给网页版AI的原始指南地址：<https://raw.githubusercontent.com/HarryAuu999/field-research-data-tool/main/docs/questionnaire-ai-guide.md>。

推荐直接复制这句给AI，避免它扫描整个仓库：

> 只读取上述AI问卷转换指南和我提供的原问卷，不要研究整个GitHub项目；直接生成一个不带代码围栏的AuNote JSON对象。严格保留原题意和顺序，不猜必填或分析方法；用recordLabelField指定样本名称字段，仅在原问卷明确要求多题同页时使用page。输出前自行核对schemaVersion必须是数字1。

创建或由AI转换AuNote问卷时，请优先阅读：

- [AI问卷转换指南](docs/questionnaire-ai-guide.md)：Word、PDF、Markdown或自然语言问卷的转换规则；
- [JSON Schema](docs/questionnaire.schema.json)：导入前的机器校验；
- [基础示例](examples/basic-questionnaire.json)与[完整功能示例](examples/full-feature-questionnaire.json)；
- [问卷JSON模板说明](docs/questionnaire-template.md)：字段、默认行为与CSV规则的完整参考。

导入时AuNote仍会通过JavaScript检查基本结构、题型和字段配置；JSON Schema是额外的预检来源，不替代PWA内置验证。导入前仍需由研究人员预览题目、选项、必填状态、单位、评分和CSV列是否符合原问卷。
