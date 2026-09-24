export function blankImageRangeAnswer() {
  return { version: 1, strokes: [] };
}

export function imageRangeStrokes(answer) {
  return Array.isArray(answer?.strokes) ? answer.strokes : [];
}

export function clampNormalized(value) {
  return Math.round(Math.max(0, Math.min(1, value)) * 100000) / 100000;
}

export function pointOnImage(svg, event, width, height) {
  const matrix = svg.getScreenCTM();
  if (!matrix) return null;
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const local = point.matrixTransform(matrix.inverse());
  return [clampNormalized(local.x / width), clampNormalized(local.y / height)];
}

export function strokePath(stroke, width, height) {
  const points = Array.isArray(stroke.points) ? stroke.points : [];
  if (!points.length) return "";
  const coord = ([x, y]) => `${(x * width).toFixed(2)} ${(y * height).toFixed(2)}`;
  const commands = [`M${coord(points[0])}`];
  if (points.length === 1) commands.push(`L${coord(points[0])}`);
  else if (points.length === 2) commands.push(`L${coord(points[1])}`);
  else {
    for (let i = 1; i < points.length - 1; i += 1) {
      const midpoint = [(points[i][0] + points[i + 1][0]) / 2, (points[i][1] + points[i + 1][1]) / 2];
      commands.push(`Q${coord(points[i])} ${coord(midpoint)}`);
    }
    commands.push(`L${coord(points.at(-1))}`);
  }
  return commands.join(" ");
}

export function appendStrokePoint(stroke, point) {
  const previous = stroke.points.at(-1);
  if (previous && Math.hypot(point[0] - previous[0], point[1] - previous[1]) < 0.0015) return false;
  stroke.points.push(point);
  return true;
}

// 0.3% of image width, measured in image coordinates so portrait images are not distorted.
export function simplifyStrokePoints(points, imageWidth, imageHeight, tolerance = 0.003) {
  if (!Array.isArray(points) || points.length < 3) return Array.isArray(points) ? points.slice() : [];
  const aspect = imageHeight / imageWidth;
  const distance = (point, start, end) => {
    const dx = end[0] - start[0];
    const dy = (end[1] - start[1]) * aspect;
    const px = point[0] - start[0];
    const py = (point[1] - start[1]) * aspect;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared ? Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSquared)) : 0;
    return Math.hypot(px - t * dx, py - t * dy);
  };
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let farthest = -1;
    let maxDistance = tolerance;
    for (let i = first + 1; i < last; i += 1) {
      const currentDistance = distance(points[i], points[first], points[last]);
      if (currentDistance > maxDistance) {
        maxDistance = currentDistance;
        farthest = i;
      }
    }
    if (farthest !== -1) {
      keep[farthest] = 1;
      stack.push([first, farthest], [farthest, last]);
    }
  }
  return points.filter((_, index) => keep[index]);
}
