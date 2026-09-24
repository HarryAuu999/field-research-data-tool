# 问卷 JSON 模板说明

工具可以导入 `schemaVersion: 1` 的 JSON 问卷。每个版本都是独立模板，不会覆盖旧版本。

## 最外层字段

```json
{
  "schemaVersion": 1,
  "id": "study-id",
  "version": "1.0",
  "title": "问卷名称",
  "description": "问卷说明",
  "recordLabelField": "participantName",
  "fields": []
}
```

- `id`：同一研究使用相同英文编号；
- `version`：不同版本使用不同版本号；
- `title`：手机首页显示的中文名称；
- `description`：问卷背景信息；首页显示前几行，问卷概览显示完整内容；
- `fields`：按填写顺序排列的问题。
- `recordLabelField`：可选；指定已记录样本列表中显示的姓名、编号或其他样本标识字段。

### 最外层字段参考

| 字段 | 必填 | 合法值与默认行为 | Excel Responses行为 |
| --- | --- | --- | --- |
| `schemaVersion` | 是 | 固定为整数 `1` | 不导出 |
| `id` | 是 | 非空字符串；同一研究的不同版本保持相同ID | 不导出 |
| `version` | 是 | 非空字符串；与`id`共同构成独立版本键 | 不导出 |
| `title` | 是 | 非空字符串 | 不导出 |
| `description` | 否 | 字符串，省略时不显示问卷背景 | 不导出 |
| `recordLabelField` | 否 | 必须引用一个非`section`题目的ID；优先用该答案作为样本名称。省略时依次查找ID为`name`、姓名类短文字、第一道短文字题 | 不改变Excel Responses |
| `fields` | 是 | 至少一项；按数组顺序显示和导出 | 决定答案列顺序 |
| `analysis` | 否 | 数字分布分析或图片人数热力图配置 | 不改变Excel Responses |

应用保存问卷后会添加`key`和`importedAt`内部元数据。创建导入JSON时不要自行填写它们。

## 手机内编辑与版本

- 问卷概览同时是编辑入口：轻点标题或问题进行修改；点击加号后从弹窗选择题型；也可以删除和长按排序问题；
- 基础问题可以在编辑页切换题型；问题名称、说明和必填状态会保留，原题型的选项、单位或评分设置会在确认后重置；用于简易分析的字段和专用交互题不能切换题型；
- 单个问题只有点击“完成”才写入问卷修改稿；直接返回会询问放弃更改或继续编辑。问卷修改稿尚未保存为新版本时，离开问卷概览也会再次提醒；
- 没有记录且没有填写草稿的问卷，保存后自动增加版本号并替换原来的空模板；
- 已有记录的问卷，保存后建立同一问卷ID的新版本。旧版本、旧问题和旧记录保持原样，新版本自动成为当前问卷；
- 每个版本分别查看和导出Excel Responses。旧版本Excel Responses继续使用采集时的原问题名称，新版本已删除的问题不会出现在新版本Excel Responses中；
- 图片和专用交互题会被保留，但当前通用编辑器不修改其内部结构。

## 支持的题型

- `shortText`：短文字；
- `longText`：长文字；
- `number`：数字，`integer: true` 时只接受整数；
- `repeatedNumber`：同一道题填写多次数字，可设置最多次数和最少填写数量；
- `singleChoice`：单选；
- `multiChoice`：多选；
- `rating`：评分；
- `imageRange`：在图片上自由涂画范围；仅由 JSON 配置，手机内编辑器不配置内部参数；
- `section`：只显示标题或说明，不导出答案。

所有问题均使用唯一的 `id`，并可设置 `required: true` 或 `false`。

## 问题通用字段

| 字段 | 必填 | 适用题型 | 默认行为与合法值 | Excel Responses行为 |
| --- | --- | --- | --- | --- |
| `id` | 是 | 全部 | 问卷内唯一的非空字符串；发布后不要复用或随意更名 | 用于对应答案，不直接作为表头 |
| `type` | 是 | 全部 | 上述9种题型之一 | 决定导出格式 |
| `label` | 是 | 全部 | 非空字符串；问题文字或分节标题 | 非`section`题型作为列标题 |
| `description` | 否 | 全部 | 补充说明；省略时不显示 | 不导出 |
| `required` | 否 | 除`section`外 | 布尔值，省略等同`false` | 不改变格式；只影响保存前校验 |
| `page` | 否 | 全部 | 非空字符串；连续相邻题目使用相同值时显示在同一页，省略时该题独占一页 | 不改变Excel Responses |
| `placeholder` | 否 | `shortText`、`longText`、`number`、`repeatedNumber` | 输入框内的短提示；省略为空 | 不导出 |
| `unit` | 否 | `number`、`repeatedNumber` | 如`mm`、`岁`；省略时不显示单位 | 进入Excel Responses列标题，不重复写入每个单元格 |
| `integer` | 否 | `number`、`repeatedNumber` | 布尔值；`true`只接受非负整数，省略/`false`接受非负整数或小数 | 数值原样导出 |
| `image` | `imageRange`必填，其余可选 | 全部 | 普通图片`{src, alt}`；`imageRange`还必须有原图`width`、`height` | 图片本身不导出，标注坐标进入Annotations |

AuNote当前数字输入接受非负十进制数，不接受负号、指数记法或千位分隔符。

## 样本名称与多题同页

样本列表不是按题目文字猜姓名。推荐显式设置`recordLabelField`：

```json
{
  "recordLabelField": "participantName",
  "fields": [
    { "id": "participantName", "type": "shortText", "label": "姓名" }
  ]
}
```

需要把相邻题目放在同一页时，为它们设置同一个`page`。没有`page`的题仍保持一页一题：

```json
[
  { "id": "participantName", "type": "shortText", "label": "姓名", "page": "participantInfo" },
  { "id": "age", "type": "number", "label": "年龄", "integer": true, "page": "participantInfo" },
  { "id": "comments", "type": "longText", "label": "其他反馈" }
]
```

`page`只控制手机填写布局，不合并答案、不改变字段ID、保存结构或Excel Responses列。当前手机问卷编辑器不提供该配置入口；需要在问卷JSON中由人工或AI生成。

## 当前能力边界

AI转换问卷时必须同时检查题目内容和布局、交互、校验、分析要求。JSON通过Schema只代表结构合法，不代表原问卷所有研究要求都已实现。

| 原始要求 | 当前支持状态 | 说明 |
| --- | --- | --- |
| 默认逐题显示 | 支持 | 未配置`page`时每题独占一页 |
| 两道或多道题同页 | 支持 | 连续相邻题目设置相同`page` |
| 自定义分页 | 支持基础分页 | `page`可组织连续题目的页面；没有复杂页面条件或动态分页 |
| 标题、说明和视觉分组 | 支持 | 使用`section`；与相邻题设置相同`page`时可同页显示 |
| 矩阵题 | 不支持 | 经用户确认后可拆成多道题，但交互不再是矩阵 |
| 条件跳题、题目联动 | 不支持 | 所有字段按固定顺序显示 |
| 排序题 | 不支持 | 问卷编辑器的题目排序不等于参与者作答排序题 |
| 日期、文件上传、签名 | 不支持 | 当前没有对应题型 |
| 静态图片 | 支持 | 使用内嵌data URI；内置资源可用`./assets/` |
| 图片上自由涂画范围 | Beta测试支持 | 使用`imageRange`，记录归一化笔画；底图必须内嵌或随应用缓存；可按明确配置显示人数热力图，但尚无路径约束 |
| 图片点选、沿指定曲线吸附 | 不支持 | `imageRange`不是点选或路径吸附，不能自动限制在红色轮廓上 |
| 非负整数或小数输入 | 支持 | `number`及`integer`控制整数/小数；不接受负数和科学计数法 |
| 数字最小值、最大值 | 不支持强制校验 | 可在`description`保留口径，但不能阻止越界输入 |
| 小数位数、固定步长 | 不支持强制校验 | 可提示用户，但JSON没有精度或步长配置 |
| 连续整数评分按钮 | 支持 | 使用`rating`的整数`min`至`max` |
| 重复测量 | 支持 | `repeatedNumber`支持2至10次及`minEntries` |
| 描述性统计和数字分布 | 支持 | 仅`number`和`repeatedNumber`，由`analysis`配置驱动 |
| A/B字段并列分析 | 部分支持 | 可分别显示描述统计和分布图；没有自动配对检验或项目专用比较结论 |

遇到部分支持或不支持的要求时，应在生成JSON之前向用户说明降级方式。不得用未定义的`warnings`、`unsupportedRequirements`、`conversionNotes`、`group`、`samePage`或`displayTogether`等字段保存提醒。

## 各题型字段与Excel Responses

| 题型 | 专用字段 | 默认行为与合法值 | Excel Responses行为 |
| --- | --- | --- | --- |
| `shortText` | `allowAnonymous`、`anonymousLabel` | `allowAnonymous`省略为`false`；开启后可勾选匿名，`anonymousLabel`省略显示“匿名” | 一列；匿名答案导出“匿名” |
| `longText` | `allowAnonymous`、`anonymousLabel` | 多行文字；导入JSON可开启匿名（手机内编辑器当前只为短文字显示匿名开关） | 一列；匿名答案导出“匿名”，否则保留文本内容 |
| `number` | `unit`、`integer`、`placeholder` | 单个数字 | 一列；表头可含单位，答案保留原输入 |
| `repeatedNumber` | `repeatCount`、`minEntries`、`unit`、`integer`、`placeholder` | `repeatCount`必填且为2～10；`minEntries`省略时，必填题为1、非必填题为0 | 每次测量各一列，另加平均值和最大差值列 |
| `singleChoice` | `options` | 至少一个选项 | 一列，导出选项`label`；补充文字格式为“选项：文字” |
| `multiChoice` | `options` | 至少一个选项 | 一列；多个选项用中文分号`；`连接 |
| `rating` | `min`、`max`、`unknownOption`、`labels` | `min`与`max`必须为整数且`min < max`；只能选择整数档位 | 一列，导出整数分值或未知选项文字 |
| `imageRange` | `image`、`view`、`annotationType`、`brushSize`、`levels`、`questionNumber` | 每题独占一页；底图宽高为原图像素；笔刷相对图片宽度，`0 < brushSize ≤ 0.2`；`levels`为1或2档连续ID；可选正整数`questionNumber`让多个视图共用研究问题编号 | Responses列显示已标注笔数；原始笔画坐标进入Annotations |
| `section` | 无 | 仅组织标题与说明，忽略`required` | 不生成Excel Responses列 |

### 选项对象

`singleChoice`和`multiChoice`的每个`options`成员都必须包含问卷内该题唯一的`id`和非空`label`。

- `exclusive`：仅用于`multiChoice`，布尔值，省略为`false`；选中`true`的选项会取消其他选择，选择其他项也会取消它；
- `textInput`：单选或多选均可用，选择该项后出现补充文字输入框；
- `textInput.label`：可选，补充输入的可访问名称/校验提示；
- `textInput.placeholder`：可选，补充输入框提示；
- `textInput.required`：可选布尔值，省略为`false`；只在该选项被选中时生效。

## 重复数字

```json
{
  "id": "thickness",
  "type": "repeatedNumber",
  "label": "厚度",
  "required": true,
  "repeatCount": 3,
  "minEntries": 1,
  "unit": "mm",
  "placeholder": "输入读数"
}
```

- `repeatCount`：页面显示的输入框数量，目前允许2至10个；
- `minEntries`：至少需要填写几个，本例允许只填1次、2次或完整填写3次；
- `integer`：可选；`true`时每次只接受整数，省略时允许小数；
- 必须从第1次开始按顺序填写，不能跳过中间一次；
- Excel Responses会分别导出每次原始值、平均值和最大差值；只有1个数据时，最大差值留空。

## 单选与“其他”文字

```json
{
  "id": "habit",
  "type": "singleChoice",
  "label": "佩戴习惯",
  "required": false,
  "options": [
    { "id": "a", "label": "水平" },
    {
      "id": "other",
      "label": "其他",
      "textInput": {
        "label": "请说明",
        "placeholder": "输入其他情况",
        "required": true
      }
    }
  ]
}
```

Excel Responses中会导出为一个答案，例如：`其他：接近垂直佩戴`。

## 多选

```json
{
  "id": "locations",
  "type": "multiChoice",
  "label": "不适位置",
  "required": false,
  "options": [
    { "id": "p1", "label": "点位1" },
    { "id": "p2", "label": "点位2" },
    { "id": "none", "label": "无", "exclusive": true }
  ]
}
```

带有 `exclusive: true` 的选项会与其他选项互斥。多个选择在Excel Responses中使用中文分号连接。

## 评分

```json
{
  "id": "score",
  "type": "rating",
  "label": "评分",
  "required": false,
  "min": 1,
  "max": 5,
  "unknownOption": { "id": "unknown", "label": "无法判断" },
  "labels": {
    "1": { "short": "很低", "help": "1分的解释" },
    "5": { "short": "很高", "help": "5分的解释" }
  }
}
```

Excel Responses的同一列中保存 `1`～`5` 或文字“无法判断”。

- `unknownOption`可选，必须包含唯一`id`和非空`label`；
- `labels`可选，以分值字符串为键；每档可包含`short`（按钮短标签）和`help`（选中后的解释）；
- `rating`只生成从`min`到`max`的整数按钮，不支持3.2、3.5等连续小数评分。此类题应使用`number`。

## 图片

为了保证离线使用，普通导入问卷中的图片必须直接嵌入JSON，使用 `data:image/...;base64,...`：

```json
{
  "image": {
    "src": "data:image/png;base64,这里是图片内容",
    "alt": "图片说明"
  }
}
```

`image.src`必填；`image.alt`建议填写，无障碍文本省略时回退为题目标题。项目内置问卷还可引用随应用缓存的`./assets/...`文件。外部网页图片地址会被拒绝，避免现场离线后无法显示。普通图片只在题目页显示，不进入Excel Responses。

### 图片范围标注 `imageRange`（Beta 测试）

参见 [七页 Beta 验收问卷](../examples/ear-image-range-test.json)。此题型用于直接在底图上自由涂画范围，不是点位选择；鼠标或手指笔画以相对原图宽高的归一化坐标（0～1）记录，重绘不提高同等级颜色强度。它必须独占一页，不能设置`page`。可撤销本页最后一笔；确认“清除所有标记”后会清除本页全部等级，且不能用撤销恢复。

`view`和`annotationType`是研究者提供的稳定字符串（如`side`、`contact`）；`brushSize`是相对原图宽度的正数，不超过0.2；`levels`必须为1或2个对象，ID从1连续编号，标签由研究者提供。`image`必须包含`src`、原图`width`、原图`height`，并建议提供`alt`。普通导入问卷若引用图片应使用内嵌`data:image/...`；只有资源已随AuNote一起缓存时才能使用`./assets/...`。本地测试问卷使用已内置的三张耳图。

答案保存在原有`answers[fieldId]`下：

```json
{ "version": 1, "strokes": [{ "id": "uuid", "annotationType": "pain", "level": 2, "brushSize": 0.027, "points": [[0.5, 0.4], [0.51, 0.42]] }] }
```

Excel只导出一个XLSX文件。`Responses`保持原有记录编号、时间和每题答案列；`Annotations`逐点导出`sampleId`、`recordNumber`、`questionId`、`view`、`annotationType`、`level`、`strokeId`、`pointOrder`、`normalizedX`、`normalizedY`、`brushSize`、`imageSrc`、`imageWidth`、`imageHeight`。未标注的题没有坐标行。可按相同`sampleId + questionId + strokeId`和`pointOrder`重建原始笔画，并按所需分辨率重新栅格化；同等级各笔画应做集合并集，不把同一参与者反复划过的区域当作更高疼痛等级。

Beta填写页仍按上一题／下一题切换，每张底图独占一页。画笔滑块设定之后新笔画的宽度，宽度随每笔保存；笔画结束时按图片宽度的0.3%固定容差简化坐标，界面不提供容差设置。撤销只移除当前页的最后一笔；“清除所有标记”经确认后清除当前页全部等级，不影响其他图片页。已有未简化笔画无需迁移，仍可显示和分析。

## 可选的简易分析

简易分析是某一份问卷的可选能力，并不是所有问卷都会显示。数字分析引用`number`或`repeatedNumber`题。旧版`distribution`配置继续有效：

```json
{
  "analysis": {
    "type": "distribution",
    "aggregation": "participantMean",
    "percentiles": [20, 50, 80],
    "fields": [
      { "id": "horizontalThickness", "label": "水平位置耳厚分布", "theme": "blue" },
      { "id": "tiltedThickness", "label": "倾斜位置耳厚分布", "theme": "orange" }
    ]
  }
}
```

- `participantMean`：同一参与者的重复测量先计算平均值，然后该参与者只计入一次；
- `binWidth`：可选。默认不填写，AuNote会按每个字段的实际数据自动计算直方图区间宽度；只有研究负责人明确要求固定间距时，才填写一个大于0的数字（例如`0.5`）。这项设置不会显示为调查员操作开关；
- `percentiles`：需要显示的百分位，数值必须在0至100之间；
- `fields`：只能引用当前问卷内的`number`或`repeatedNumber`字段；
- `theme`：目前可使用`blue`或`orange`。

新问卷建议使用更明确的`descriptiveDistribution`，可按需指定统计项：

```json
{
  "analysis": {
    "type": "descriptiveDistribution",
    "aggregation": "participantMean",
    "statistics": ["count", "mean", "median", "mode", "min", "max", "sd", "q1", "q3"],
    "percentiles": [20, 50, 80],
    "binWidth": 0.5,
    "fields": [
      { "id": "exampleScore", "label": "示例评分", "theme": "blue" }
    ]
  }
}
```

- `type`：必填；数字分析可用旧版`distribution`或新版`descriptiveDistribution`；图片分析可用`imageRangeHeatmap`；
- `aggregation`：必填；当前唯一合法值为`participantMean`。`repeatedNumber`会先计算每名参与者的有效重复值平均数，`number`每条有效记录直接计为一个样本；
- `statistics`：`descriptiveDistribution`可选；省略时显示全部9项。合法值为`count`、`mean`、`median`、`mode`、`min`、`max`、`sd`、`q1`、`q3`，不得重复；旧配置省略它也会显示全部描述性统计；
- `percentiles`：`distribution`必填，`descriptiveDistribution`可选；每项必须大于0且小于100；
- `binWidth`：可选正数；省略时按字段数据自动分箱；
- `fields`：必填非空数组。每项必须有`id`；`label`可覆盖题目标题；`theme`可为`blue`或`orange`；
- 样本标准差在只有一个有效样本时显示为“—”；所有值都只出现一次时显示“无明显众数”，并列众数会全部显示。
- `SD`使用样本标准差（分母为`N - 1`）；Q1、Q3及其他百分位采用基于排序位置`(N - 1) × p`的线性插值。

分布图会同时显示实际人数柱形、KDE数据平滑曲线和深灰虚线正态分布参考。自动分箱只根据该字段的数据计算，不会因为手机屏幕大小而减少柱子数量。

图片热力图须由研究方案明确要求，不会因存在图片标注题而自动开启：

```json
{
  "analysis": {
    "type": "imageRangeHeatmap",
    "fields": [
      { "id": "contactSide", "label": "接触范围 · 侧面" },
      { "id": "painSide", "label": "疼痛区域 · 侧面" }
    ]
  }
}
```

`fields`只能引用当前问卷内的`imageRange`题，`label`可选。每张图及每个等级分别计算；每位参与者的同级笔画先合成一个二值范围，同一区域最多贡献1人，两级重叠时高等级优先。再按像素累计真实人数；仅显示层做柔化，原始笔画、计数和导出的坐标都不被改变。各图片使用统一的0至最多已标注人数色标，显示整数人数而非“少/多”。不同底图、视角和问卷版本不能直接混算。当前一份问卷的`analysis`一次配置一种分析类型，数字分布与图片热力图尚不能在同一分析配置中同时显示。

如果问卷不需要简易分析，不要添加`analysis`。统计方法不应由AI自行猜测，应由研究负责人确认。
