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
- `fields`：按填写顺序排列的问题。

## V1.0支持的题型

- `shortText`：短文字；
- `longText`：长文字；
- `number`：数字，`integer: true` 时只接受整数；
- `singleChoice`：单选；
- `multiChoice`：多选；
- `rating`：评分；
- `section`：只显示标题或说明，不导出答案。

所有问题均使用唯一的 `id`，并可设置 `required: true` 或 `false`。

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
