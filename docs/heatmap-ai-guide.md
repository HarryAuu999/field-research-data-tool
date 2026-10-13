# AuNote 导出数据 → 可调色热力图 HTML

这份说明给收到 AuNote XLSX 和原始底图、需要制作热力图的 AI 使用。生成物是**独立、可离线打开的 HTML 报告**，不是 AuNote 简易分析的入口。仓库里的 [`tools/heatmap-report-template.html`](../tools/heatmap-report-template.html) 只有模板和调色工具，不包含任何参与者数据。

## 输入与口径

- XLSX 的 `Responses` 工作表一行一份样本；`Annotations` 按点记录笔画。按列名读取，至少使用 `sampleId`、`questionId`、`view`、`annotationType`、`level`、`strokeId`、`pointOrder`、`normalizedX`、`normalizedY`、`brushSize`、`imageSrc`、`imageWidth`、`imageHeight`。
- 用户需要提供与问卷 `imageSrc` 对应的**原始底图**。不能靠猜测使用另一张相似图片；底图的尺寸和标注坐标系必须一致。
- 按 `sampleId → questionId → level → strokeId` 重建笔画，按 `pointOrder` 排序。每一笔使用自己的 `brushSize`，它是相对于原图宽度的比例；点的 x/y 分别相对于原图宽/高归一化。
- 在同一字段和等级内，先把每名参与者的所有笔画合并成**二值 mask**，再逐像素累加。重复涂同一位置只算 1 人。若问卷疼痛等级 2 对等级 1 有优先权，先从该人的等级 1 mask 扣除其等级 2 mask，再累计；不能用平滑后的色值当人数。
- 不同 `questionId`、视角、等级分别出图。同一组可比较图共用 `sample_total` 和连续人数色标；分母明确为 `Responses` 中的样本数。标注人数和最大重合人数另行显示。
- 显示阶段才对人数矩阵做**两次 box blur**。默认半径为图宽的 0.7%（最少 1 px），调节羽化不能改原始人数。透明度沿用 `js/image-range-heatmap.js` 的 `heatAlpha`；0 人透明。

## 套用 HTML 模板

复制 `tools/heatmap-report-template.html`，将其中唯一的 `__HEATMAP_DATA__` 替换为 JSON 对象，形成最终 HTML。不要把包含真实样本的最终 HTML 或 XLSX 提交到公开仓库。对象结构：

```json
{
  "title": "研究名称 · 接触范围热力图",
  "description": "20 份记录 · 各图片分别统计",
  "sample_total": 20,
  "fields": [
    {
      "id": "contactSide",
      "label": "接触范围 · 侧面",
      "participants": 18,
      "stroke_count": 43,
      "max_count": 7,
      "width": 480,
      "height": 571,
      "image": "data:image/png;base64,…",
      "count_mask": "data:image/png;base64,…",
      "countEncoding": "rg16"
    }
  ]
}
```

上面的数字只是**格式示意**，不能当真实研究结果。`image` 是原图的内嵌 data URI；`count_mask` 是与输出宽高一致、无损 PNG。每个像素的真实人数可以用 R 通道低字节 + G 通道高字节编码（`countEncoding: "rg16"`，B=0，A=255）；255 人以下也可只用 R 通道并省略 `countEncoding`。不要把 0–N 人归一化为 0–255 的渐变 mask，那会失去真实人数。HTML 内嵌原图和汇总 mask 后可在离线状态打开，支持羽化与 RGB 调色、保存 PNG。

默认色阶取自用户确认的 0%、25%、50%、75%、100% 五个节点：`#ACD0F1`、`#5491C9`、`#25CB75`、`#D8D32C`、`#E13737`，节点之间按 RGB 线性插值。**0 人仍透明**；在 20 份样本中这五点对应 0、5、10、15、20 人，样本数变化时按人数比例连续映射，不固定为 5 人一档。调色栏放在所有热力图下方，仅影响本 HTML 当前显示，不会改 XLSX 或 AuNote 本地数据。

交付前核对：底图和 mask 完全对齐；每人每位置最多计 1；各级独立；数值色标为人数、不是“少到多”；浏览器打开无外部请求；至少抽查一个位置的原始人数与可视化色值；不包含姓名、原始笔画或完整记录。
