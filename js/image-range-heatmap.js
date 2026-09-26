import { imageRangeStrokes } from "./image-range.js";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function addBinaryMask(counts, rgba) {
  for (let i = 0; i < counts.length; i += 1) {
    if (rgba[i * 4 + 3] >= 128) counts[i] += 1;
  }
  return counts;
}

export function boxBlur(values, width, height, radius) {
  if (!radius) return Float32Array.from(values);
  const horizontal = new Float32Array(values.length);
  const result = new Float32Array(values.length);
  for (let y = 0; y < height; y += 1) {
    let sum = 0;
    for (let x = 0; x < Math.min(width, radius + 1); x += 1) sum += values[y * width + x];
    for (let x = 0; x < width; x += 1) {
      if (x > 0) {
        if (x + radius < width) sum += values[y * width + x + radius];
        if (x - radius - 1 >= 0) sum -= values[y * width + x - radius - 1];
      }
      result[y * width + x] = sum / (Math.min(width - 1, x + radius) - Math.max(0, x - radius) + 1);
    }
  }
  // Copy the horizontal pass before the vertical pass; exact participant counts stay in `values`.
  horizontal.set(result);
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let y = 0; y < Math.min(height, radius + 1); y += 1) sum += horizontal[y * width + x];
    for (let y = 0; y < height; y += 1) {
      if (y > 0) {
        if (y + radius < height) sum += horizontal[(y + radius) * width + x];
        if (y - radius - 1 >= 0) sum -= horizontal[(y - radius - 1) * width + x];
      }
      result[y * width + x] = sum / (Math.min(height - 1, y + radius) - Math.max(0, y - radius) + 1);
    }
  }
  return result;
}

function drawStroke(ctx, stroke, width, height) {
  const points = Array.isArray(stroke.points) ? stroke.points : [];
  if (!points.length || !Number.isFinite(stroke.brushSize) || stroke.brushSize <= 0) return;
  ctx.lineWidth = stroke.brushSize * width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(points[0][0] * width, points[0][1] * height);
  if (points.length > 2) {
    for (let i = 1; i < points.length - 1; i += 1) {
      ctx.quadraticCurveTo(points[i][0] * width, points[i][1] * height,
        (points[i][0] + points[i + 1][0]) * width / 2, (points[i][1] + points[i + 1][1]) * height / 2);
    }
    ctx.lineTo(points.at(-1)[0] * width, points.at(-1)[1] * height);
  } else if (points.length === 2) ctx.lineTo(points[1][0] * width, points[1][1] * height);
  ctx.stroke();
  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0][0] * width, points[0][1] * height, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function countImageRangeParticipants(field, records, levelId, maxWidth = 480) {
  const width = Math.max(1, Math.round(Math.min(maxWidth, field.image.width)));
  const height = Math.max(1, Math.round(width * field.image.height / field.image.width));
  const counts = new Uint16Array(width * height);
  const mask = document.createElement("canvas");
  mask.width = width;
  mask.height = height;
  const ctx = mask.getContext("2d", { willReadFrequently: true });
  let participantCount = 0;
  let levelCount = 0;
  for (const record of records) {
    const strokes = imageRangeStrokes(record.answers?.[field.id]);
    if (!strokes.length) continue;
    participantCount += 1;
    const selected = strokes.filter((stroke) => stroke.level === levelId);
    if (!selected.length) continue;
    levelCount += 1;
    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = "#000";
    ctx.fillStyle = "#000";
    for (const stroke of selected) drawStroke(ctx, stroke, width, height);
    // On a two-level question, level 2 visually and analytically takes precedence.
    if (levelId === 1 && field.levels.length === 2) {
      ctx.globalCompositeOperation = "destination-out";
      for (const stroke of strokes.filter((item) => item.level === 2)) drawStroke(ctx, stroke, width, height);
    }
    addBinaryMask(counts, ctx.getImageData(0, 0, width, height).data);
  }
  let maxCount = 0;
  for (const count of counts) if (count > maxCount) maxCount = count;
  return { width, height, counts, participantCount, levelCount, maxCount };
}

function heatColor(value) {
  const stops = [
    [0, 42, 161, 215],
    [0.35, 35, 111, 211],
    [0.7, 91, 65, 191],
    [1, 174, 45, 144]
  ];
  for (let i = 1; i < stops.length; i += 1) {
    if (value <= stops[i][0]) {
      const a = stops[i - 1];
      const b = stops[i];
      const t = clamp((value - a[0]) / (b[0] - a[0]), 0, 1);
      return [1, 2, 3].map((channel) => Math.round(a[channel] + (b[channel] - a[channel]) * t));
    }
  }
  return stops.at(-1).slice(1);
}

export function paintHeatmap(canvas, result, scaleMaximum) {
  canvas.width = result.width;
  canvas.height = result.height;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(result.width, result.height);
  const blurRadius = Math.max(2, Math.round(result.width * 0.012));
  const softened = boxBlur(boxBlur(result.counts, result.width, result.height, blurRadius), result.width, result.height, blurRadius);
  const scale = Math.max(1, scaleMaximum);
  for (let i = 0; i < softened.length; i += 1) {
    const count = softened[i];
    if (count < 0.05) continue;
    const ratio = clamp(count / scale, 0, 1);
    const color = heatColor(ratio);
    const offset = i * 4;
    image.data[offset] = color[0];
    image.data[offset + 1] = color[1];
    image.data[offset + 2] = color[2];
    image.data[offset + 3] = Math.round(225 * Math.min(1, count / 0.65));
  }
  ctx.putImageData(image, 0, 0);
}
