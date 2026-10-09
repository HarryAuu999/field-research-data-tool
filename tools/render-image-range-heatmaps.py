"""Rebuild anonymized AuNote imageRange heatmaps from an exported XLSX.

Usage: python tools/render-image-range-heatmaps.py export.xlsx --output-dir outputs/heatmaps
Requires: numpy, openpyxl, Pillow. No workbook or participant data is modified.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
from pathlib import Path

import numpy as np
import openpyxl
from PIL import Image, ImageDraw, ImageFont


WIDTH = 520
LAYERS = (("contact", 1, "接触范围"), ("pain", 1, "一般疼痛"), ("pain", 2, "较为疼痛"))
VIEW_NAMES = {"side": "侧面", "side-section": "截面", "back": "背面"}
PALETTE = (
    (0.0, (255, 255, 255)),
    (0.2, (102, 202, 204)),
    (0.4, (39, 158, 194)),
    (0.6, (51, 105, 187)),
    (0.8, (112, 70, 164)),
    (1.0, (170, 45, 122)),
)
REQUIRED = {"sampleId", "questionId", "view", "annotationType", "level", "strokeId",
            "pointOrder", "normalizedX", "normalizedY", "brushSize", "imageSrc",
            "imageWidth", "imageHeight"}


def font(size: int, bold: bool = False):
    candidates = [
        Path("C:/Windows/Fonts/msyhbd.ttc" if bold else "C:/Windows/Fonts/msyh.ttc"),
        Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc" if bold else
             "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default(size=size)


def read_export(path: Path):
    book = openpyxl.load_workbook(path, read_only=True, data_only=True)
    if "Annotations" not in book:
        raise ValueError("Excel 缺少 Annotations 工作表")
    rows = book["Annotations"].values
    headers = next(rows)
    if not REQUIRED.issubset(headers):
        raise ValueError(f"Annotations 缺少列：{sorted(REQUIRED - set(headers))}")
    strokes = defaultdict(list)
    images = {}
    fields = defaultdict(set)
    samples = set()
    for row_number, raw in enumerate(rows, start=2):
        row = dict(zip(headers, raw))
        try:
            sample = str(row["sampleId"] or "").strip()
            field = str(row["questionId"] or "").strip()
            view = str(row["view"] or "").strip()
            kind = str(row["annotationType"] or "").strip()
            level = int(row["level"])
            stroke = str(row["strokeId"] or "").strip()
            order = int(row["pointOrder"])
            x, y, brush = (float(row[key]) for key in ("normalizedX", "normalizedY", "brushSize"))
            image = str(row["imageSrc"] or "").strip()
            image_size = (int(row["imageWidth"]), int(row["imageHeight"]))
            if not all((sample, field, view, stroke, image)) or kind not in {"contact", "pain"}:
                raise ValueError("missing identity or unsupported annotation type")
            if image_size[0] <= 0 or image_size[1] <= 0:
                raise ValueError("invalid image size")
            if level not in {1, 2} or order < 0 or not (0 <= x <= 1 and 0 <= y <= 1 and 0 < brush <= 0.2):
                raise ValueError("invalid coordinate, level or brush size")
            if view in images and images[view] != (image, image_size):
                raise ValueError("同一视角引用不同底图")
        except (TypeError, ValueError) as error:
            raise ValueError(f"Annotations 第 {row_number} 行无效：{error}") from error
        images[view] = (image, image_size)
        fields[(view, kind)].add(field)
        samples.add(sample)
        strokes[(sample, field, view, kind, level, stroke)].append((order, x, y, brush))
    for key, field_ids in fields.items():
        if len(field_ids) != 1:
            raise ValueError(f"{key} 对应多道题；请先按 questionId 分组，不能直接混算")
    book.close()
    return strokes, images, samples


def smooth_path(points, width, height):
    xy = [(x * width, y * height) for _, x, y, _ in sorted(points)]
    if len(xy) <= 2:
        return xy
    result = [xy[0]]
    for i in range(1, len(xy) - 1):
        start, control = result[-1], xy[i]
        end = ((xy[i][0] + xy[i + 1][0]) / 2, (xy[i][1] + xy[i + 1][1]) / 2)
        steps = max(3, int(np.hypot(end[0] - start[0], end[1] - start[1]) / 2))
        for step in range(1, steps + 1):
            t = step / steps
            result.append(((1 - t) ** 2 * start[0] + 2 * (1 - t) * t * control[0] + t ** 2 * end[0],
                           (1 - t) ** 2 * start[1] + 2 * (1 - t) * t * control[1] + t ** 2 * end[1]))
    result.append(xy[-1])
    return result


def rasterize(stroke_groups, width, height):
    mask = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(mask)
    for points in stroke_groups:
        if not points:
            continue
        diameter = max(1, round(points[0][3] * width))
        radius = diameter / 2
        path = smooth_path(points, width, height)
        if len(path) >= 2:
            draw.line(path, fill=255, width=diameter, joint="curve")
        for x, y in (path[0], path[-1]):
            draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=255)
    return np.asarray(mask) >= 128


def counts_for(strokes, samples, view, kind, level, width, height):
    counts = np.zeros((height, width), dtype=np.uint16)
    marked = 0
    for sample in samples:
        selected = [points for (sid, _, v, k, lv, _), points in strokes.items()
                    if sid == sample and v == view and k == kind and lv == level]
        if not selected:
            continue
        marked += 1
        mask = rasterize(selected, width, height)
        if kind == "pain" and level == 1:
            high = [points for (sid, _, v, k, lv, _), points in strokes.items()
                    if sid == sample and v == view and k == kind and lv == 2]
            if high:
                mask &= ~rasterize(high, width, height)
        counts += mask.astype(np.uint16)
    return counts, marked


def box_blur(values, radius):
    height, width = values.shape
    x, y = np.arange(width), np.arange(height)
    left, right = np.maximum(0, x - radius), np.minimum(width, x + radius + 1)
    sums = np.pad(values.cumsum(axis=1, dtype=np.float32), ((0, 0), (1, 0)))
    horizontal = (sums[:, right] - sums[:, left]) / (right - left)
    top, bottom = np.maximum(0, y - radius), np.minimum(height, y + radius + 1)
    sums = np.pad(horizontal.cumsum(axis=0, dtype=np.float32), ((1, 0), (0, 0)))
    return (sums[bottom, :] - sums[top, :]) / (bottom - top)[:, None]


def palette(values):
    colors = np.empty((*values.shape, 3), dtype=np.uint8)
    for channel in range(3):
        colors[:, :, channel] = np.interp(values, [stop[0] for stop in PALETTE],
                                         [stop[1][channel] for stop in PALETTE]).astype(np.uint8)
    return colors


def overlay(counts, maximum):
    radius = max(1, round(counts.shape[1] * 0.007))  # B: twice-blurred, 0.7% of image width
    softened = box_blur(box_blur(counts.astype(np.float32), radius), radius)
    rgba = np.zeros((*counts.shape, 4), dtype=np.uint8)
    rgba[:, :, :3] = palette(np.clip(softened / max(1, maximum), 0, 1))
    rgba[:, :, 3] = np.where(softened >= 0.05,
                            205 * np.power(np.minimum(1, softened / 1.2), 1.35), 0).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def legend(draw, x0, y0, maximum):
    draw.text((x0, y0), "重叠人数", font=font(14, True), fill="#334353")
    bar_x, bar_width = x0 + 90, 480
    for x in range(bar_width):
        color = tuple(int(value) for value in palette(np.array([[x / (bar_width - 1)]]))[0, 0])
        draw.line((bar_x + x, y0 + 2, bar_x + x, y0 + 18), fill=color)
    ticks = range(maximum + 1) if maximum <= 8 else sorted({round(maximum * i / 5) for i in range(6)})
    for tick in ticks:
        x = bar_x + round(bar_width * tick / maximum)
        draw.line((x, y0 + 19, x, y0 + 24), fill="#586777")
        draw.text((x - 5, y0 + 28), str(tick), font=font(12), fill="#334353")


def render_view(view, image_path, strokes, samples, maximum, output_dir):
    source = Image.open(image_path).convert("RGBA")
    height = round(WIDTH * source.height / source.width)
    base = source.resize((WIDTH, height), Image.Resampling.LANCZOS)
    margin, gap, pad, top = 28, 14, 16, 105
    card_width, card_height = WIDTH + pad * 2, height + 106
    legend_y = top + card_height + 28
    canvas = Image.new("RGB", (margin * 2 + card_width * 3 + gap * 2, legend_y + 103), "#edf2f5")
    draw = ImageDraw.Draw(canvas)
    draw.text((margin, 18), f"耳部范围热力图 · {VIEW_NAMES.get(view, view)}",
              font=font(28, True), fill="#1c2b3a")
    draw.text((margin, 62), f"有标注样本 {len(samples)} 人 · 连续人数色阶 · 收紧羽化 B",
              font=font(15), fill="#536273")
    findings = []
    for index, (kind, level, title) in enumerate(LAYERS):
        x = margin + index * (card_width + gap)
        draw.rounded_rectangle((x, top, x + card_width, top + card_height), radius=12,
                               fill="white", outline="#dce3e9")
        counts, marked = counts_for(strokes, samples, view, kind, level, WIDTH, height)
        peak = int(counts.max())
        findings.append(f"{title}:{marked}人/峰值{peak}人")
        draw.text((x + pad, top + 12), title, font=font(19, True), fill="#1c2b3a")
        draw.text((x + pad, top + 45), f"有标注 {marked} 人 · 最大重叠 {peak} 人",
                  font=font(13), fill="#536273")
        picture = base.copy()
        if marked:
            picture.alpha_composite(overlay(counts, maximum))
        canvas.paste(picture.convert("RGB"), (x + pad, top + 76))
        if not marked:
            center_x, center_y = x + pad + WIDTH // 2, top + 76 + height // 2
            draw.rounded_rectangle((center_x - 70, center_y - 20, center_x + 70, center_y + 20),
                                   radius=9, fill="white", outline="#dce3e9")
            draw.text((center_x - 48, center_y - 12), "没有标注", font=font(16), fill="#536273")
    legend(draw, margin, legend_y, maximum)
    draw.text((margin, legend_y + 63),
              "颜色边缘仅作显示平滑；人数仍按原始标注逐人计数。同一人的较为疼痛区域不再计入一般疼痛。",
              font=font(13), fill="#5d6d7d")
    output = output_dir / f"{view}-heatmap.png"
    canvas.save(output, optimize=True)
    print(f"{output}: {', '.join(findings)}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbook", type=Path, help="AuNote 导出的 XLSX")
    parser.add_argument("--assets", type=Path, default=Path(__file__).resolve().parents[1] / "assets")
    parser.add_argument("--output-dir", type=Path, default=Path("outputs/heatmaps"))
    args = parser.parse_args()
    strokes, images, samples = read_export(args.workbook)
    if not samples:
        raise ValueError("Annotations 表没有有效的图片标注")
    scale = max(len({sample for (sample, _, v, k, _, _) in strokes if v == view and k == kind})
                for view in images for kind in ("contact", "pain"))
    args.output_dir.mkdir(parents=True, exist_ok=True)
    print(f"有标注样本 {len(samples)} 人；统一色标 0–{scale} 人")
    for view in sorted(images, key=lambda item: (list(VIEW_NAMES).index(item) if item in VIEW_NAMES else 99, item)):
        image_src, expected_size = images[view]
        image = args.assets / Path(image_src).name
        if not image.is_file():
            raise FileNotFoundError(f"缺少底图：{image}")
        with Image.open(image) as source:
            if source.size != expected_size:
                raise ValueError(f"底图尺寸不匹配：{image} 为 {source.size}，Excel 记录为 {expected_size}")
        render_view(view, image, strokes, samples, scale, args.output_dir)


if __name__ == "__main__":
    main()
