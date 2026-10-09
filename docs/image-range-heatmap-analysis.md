# 从 AuNote Excel 复现图片范围热力图

这份说明给分析 AuNote `imageRange` 导出数据的 AI 和研究人员使用。无需通读 `js/app.js`：先读本文件，再运行 [`tools/render-image-range-heatmaps.py`](../tools/render-image-range-heatmaps.py)。脚本只读 Excel 和底图，在本地生成匿名 PNG；不会修改问卷或记录。

## 最短流程

1. 在 AuNote 当前问卷点击“导出数据”，取得含 `Responses` 和 `Annotations` 工作表的 `.xlsx`。不要仅用截图或把逐点记录复制成文字。
2. 保留采集时的底图构图与原始尺寸。内置耳部问卷的侧面、截面、背面图均在 [`assets/`](../assets/)；`ear-side-section.png` 已换为用户选定的黑色截线版本，仍是 4788 × 5700。不要裁切、镜像或拉伸，否则坐标会错位。
3. 在仓库根目录运行：

   ```powershell
   python tools/render-image-range-heatmaps.py "D:\path\to\AuNote导出.xlsx" --output-dir outputs/heatmaps
   ```

   需要 Python 的 `numpy`、`openpyxl`、`Pillow`。脚本按 `imageSrc` 文件名从 `assets/` 取底图；自定义问卷可把原图放入单独目录并传入 `--assets 目录`。不要将含参与者信息的 Excel、备份或分析输出提交到公开仓库。

脚本每个视角输出一张 PNG，并排显示接触范围、一般疼痛、较为疼痛。未标注的层明确写“没有标注”；所有视角使用同一人数色标。

## 计数规则

`Annotations` 每行是一笔中的**一个点**，不是一个样本或一个热区。用 `sampleId + questionId + view + annotationType + level + strokeId` 重组笔画，按 `pointOrder` 排序。`normalizedX/Y` 相对原图宽高，`brushSize` 是相对原图**宽度**的画笔直径。`imageSrc` 和原始 `imageWidth/Height` 用于核对底图。

先把同一人在同级的所有笔画重绘并合成一个二值 mask：同一区域反复涂画仍只算这**一人**。随后逐人相加，得到每个位置的整数人数。对同一人的疼痛标注，Level 2“较为疼痛”覆盖 Level 1“一般疼痛”，应从该人的 Level 1 mask 扣除。跨参与者的两级统计分别保留，不得把笔画次数或颜色当成疼痛强度。

## 当前出图标准（V1.4.3）

- 色标是连续的**重叠人数**，所有图片共用 `0–M`，`M` 为该问卷中单张图片最多的已标注样本数。5 人显示 0–5，50 人显示 0–50；不为每多一人发明一个离散颜色。
- 色阶按人数比例线性插值：`0 #ffffff`、`20% #66cacc`、`40% #279ec2`、`60% #3369bb`、`80% #7046a4`、`100% #aa2d7a`。
- B“收紧羽化”：以分析图宽的 `0.7%` 为半径做两次边缘归一化 box blur；宽 520 像素时半径约 4 像素。羽化与透明度**只用于显示**，不能改变二值 mask、真实人数或 Excel 坐标。精确透明度公式见脚本的 `overlay()`。
- 截面使用黑线 `assets/ear-side-section.png`；侧面和背面分别使用 `ear-side.png`、`ear-back.png`。三图都已在 `assets/`，Excel 不嵌入图片。

## 核查与边界

先核对每层“有标注人数”和“最大重叠人数”，再核对热点与底图对齐。不同问卷版本、底图或视角不可直接混算。只有几名样本时，柔化边缘不是精确的解剖边界，热图也不能自动推断疼痛原因或统计显著性。

脚本复用 AuNote 的逐人计数、连续色阶与 B 羽化规则；桌面 Pillow 与浏览器 Canvas 的笔画极细边缘可能有亚像素差异。如果同一视角和标注类型对应多道题，脚本会停止，提示按 `questionId` 拆开，而非静默混算。自定义外部图片必须提供原图，只有 Excel 点坐标无法可靠还原叠加图。
