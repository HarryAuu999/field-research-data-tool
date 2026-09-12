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
  "fields": []
}
```

- `id`：同一研究使用相同英文编号；
- `version`：不同版本使用不同版本号；
- `title`：手机首页显示的中文名称；
- `description`：问卷背景信息；首页显示前几行，问卷概览显示完整内容；
- `fields`：按填写顺序排列的问题。

## 手机内编辑与版本

- 问卷概览同时是编辑入口：轻点标题或问题进行修改；点击加号后从弹窗选择题型；也可以删除和长按排序问题；
- 基础问题可以在编辑页切换题型；问题名称、说明和必填状态会保留，原题型的选项、单位或评分设置会在确认后重置；用于简易分析的字段和专用交互题不能切换题型；
- 单个问题只有点击“完成”才写入问卷修改稿；直接返回会询问放弃更改或继续编辑。问卷修改稿尚未保存为新版本时，离开问卷概览也会再次提醒；
- 没有记录且没有填写草稿的问卷，保存后自动增加版本号并替换原来的空模板；
- 已有记录的问卷，保存后建立同一问卷ID的新版本。旧版本、旧问题和旧记录保持原样，新版本自动成为当前问卷；
- 每个版本分别查看和导出CSV。旧版本CSV继续使用采集时的原问题名称，新版本已删除的问题不会出现在新版本CSV中；
- 图片和专用交互题会被保留，但当前通用编辑器不修改其内部结构。

## 支持的题型

- `shortText`：短文字；
- `longText`：长文字；
- `number`：数字，`integer: true` 时只接受整数；
- `repeatedNumber`：同一道题填写多次数字，可设置最多次数和最少填写数量；
- `singleChoice`：单选；
- `multiChoice`：多选；
- `rating`：评分；
- `section`：只显示标题或说明，不导出答案。

所有问题均使用唯一的 `id`，并可设置 `required: true` 或 `false`。

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
- 必须从第1次开始按顺序填写，不能跳过中间一次；
- CSV会分别导出每次原始值、平均值和最大差值；只有1个数据时，最大差值留空。

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

CSV中会导出为一个答案，例如：`其他：接近垂直佩戴`。

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

带有 `exclusive: true` 的选项会与其他选项互斥。多个选择在CSV中使用中文分号连接。

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

CSV的同一列中保存 `1`～`5` 或文字“无法判断”。

## 图片

为了保证离线使用，导入问卷中的图片必须直接嵌入JSON，使用 `data:image/...;base64,...`：

```json
{
  "image": {
    "src": "data:image/png;base64,这里是图片内容",
    "alt": "图片说明"
  }
}
```

外部网页图片地址会被拒绝，避免现场离线后无法显示。

## 可选的简易分析

简易分析是某一份问卷的可选能力，并不是所有问卷都会显示。当前只支持对数字题或重复数字题进行分布分析：

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

分布图会同时显示实际人数柱形、KDE数据平滑曲线和深灰虚线正态分布参考。自动分箱只根据该字段的数据计算，不会因为手机屏幕大小而减少柱子数量。

如果问卷不需要简易分析，不要添加`analysis`。统计方法不应由AI自行猜测，应由研究负责人确认。
