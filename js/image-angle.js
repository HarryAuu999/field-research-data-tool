import { quantile, sampleStandardDeviation } from "./statistics.js?v=1.4.10";

const DEG = Math.PI / 180;
const escape = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const fmt = (value) => String(Number(value.toFixed(4)));

export function validateImageAngleField(field) {
  const c = field.angle;
  if (!field.image?.src || !Number.isFinite(field.image.width) || field.image.width <= 0 || !Number.isFinite(field.image.height) || field.image.height <= 0) {
    throw new Error(`图片角度题 ${field.label} 需要图片及正数宽高`);
  }
  if (!c || !Array.isArray(c.center) || c.center.length !== 2 || c.center.some((v) => !Number.isFinite(v) || v < 0 || v > 1)) {
    throw new Error(`图片角度题 ${field.label} 的 center 必须是两个0至1的归一化坐标`);
  }
  if (!Number.isFinite(c.min) || !Number.isFinite(c.max) || c.min >= c.max || c.max - c.min > 180) {
    throw new Error(`图片角度题 ${field.label} 需要递增且跨度不超过180°的角度范围`);
  }
  if (!Number.isFinite(c.step) || c.step <= 0 || c.step > c.max - c.min || Math.abs((c.max - c.min) / c.step - Math.round((c.max - c.min) / c.step)) > 1e-7) {
    throw new Error(`图片角度题 ${field.label} 的 step 必须为正数并能整除角度范围`);
  }
  if (!Number.isFinite(c.zeroDegrees) || c.zeroDegrees < 0 || c.zeroDegrees >= 360 || !["clockwise", "counterclockwise"].includes(c.rotation)) {
    throw new Error(`图片角度题 ${field.label} 需要 zeroDegrees 和合法 rotation`);
  }
  if (!Number.isFinite(c.radius) || c.radius <= 0 || c.radius > 1) throw new Error(`图片角度题 ${field.label} 的 radius 必须大于0且不超过1`);
  if (field.page !== undefined) throw new Error(`图片角度题 ${field.label} 必须独占一页`);
}

export function isImageAngleValue(field, value) {
  const c = field.angle;
  return typeof value === "number" && Number.isFinite(value) && value >= c.min && value <= c.max
    && Math.abs((value - c.min) / c.step - Math.round((value - c.min) / c.step)) < 1e-7;
}

export function imageAngleValidation(field, value) {
  if (value === "" || value === undefined || value === null) return field.required ? `请选择“${field.label}”` : "";
  return isImageAngleValue(field, value) ? "" : `请选择 ${field.angle.min}° 至 ${field.angle.max}° 范围内的有效角度`;
}

export function angleCenter(field) {
  return [field.angle.center[0] * field.image.width, field.angle.center[1] * field.image.height];
}

// Work in original image units, not normalized x/y space: non-square images
// must not stretch a 45° direction into a different angle.
export function anglePoint(field, value, radius = field.angle.radius * field.image.width) {
  const [x, y] = angleCenter(field);
  const theta = (field.angle.zeroDegrees + value * (field.angle.rotation === "clockwise" ? -1 : 1)) * DEG;
  return [x + radius * Math.cos(theta), y - radius * Math.sin(theta)];
}

function arc(field, from, to, radius) {
  const a = anglePoint(field, from, radius);
  const b = anglePoint(field, to, radius);
  const sweep = field.angle.rotation === "clockwise" ? 1 : 0;
  return `M ${a.map(fmt).join(" ")} A ${fmt(radius)} ${fmt(radius)} 0 ${to - from > 180 ? 1 : 0} ${sweep} ${b.map(fmt).join(" ")}`;
}

function line(field, value, radius, attributes) {
  const [x, y] = angleCenter(field);
  const [endX, endY] = anglePoint(field, value, radius);
  return `<line x1="${fmt(x)}" y1="${fmt(y)}" x2="${fmt(endX)}" y2="${fmt(endY)}" ${attributes}/>`;
}

function image(field) {
  return `<image href="${escape(field.image.src)}" width="${field.image.width}" height="${field.image.height}" preserveAspectRatio="xMidYMid meet"/>`;
}

export function imageAngleControlHtml(field, answer) {
  const selected = isImageAngleValue(field, answer);
  const value = selected ? answer : Math.max(field.angle.min, Math.min(field.angle.max, 0));
  const [x, y] = angleCenter(field);
  const radius = field.angle.radius * field.image.width;
  return `<div class="image-angle-workspace" data-angle-selected="${selected}">
    <svg class="image-angle-canvas" viewBox="0 0 ${field.image.width} ${field.image.height}" role="img" aria-label="${escape(field.image.alt || field.label)}，可旋转的角度指示线">
      ${image(field)}
      ${line(field, 0, radius, 'class="image-angle-baseline"')}
      ${line(field, value, radius, 'class="image-angle-ray" data-angle-ray')}
      <circle cx="${fmt(x)}" cy="${fmt(y)}" r="${fmt(field.image.width * 0.007)}" class="image-angle-center"/>
    </svg>
    <div class="image-angle-tools">
      <div class="image-angle-value-row"><label>角度 <output data-angle-value>${selected ? `${fmt(value)}°` : "未选择"}</output></label><button class="image-angle-clear" type="button" data-angle-clear ${selected ? "" : "disabled"}>清除</button></div>
      <input class="image-angle-slider" data-angle-slider type="range" min="${field.angle.min}" max="${field.angle.max}" step="${field.angle.step}" value="${value}" aria-label="${escape(field.label)}" aria-valuetext="${selected ? `${fmt(value)}度` : "尚未选择角度"}"/>
      <div class="image-angle-limits"><span>${field.angle.min}°</span><span>拖动或点按滑块选定角度</span><span>${field.angle.max}°</span></div>
    </div>
  </div>`;
}

export function bindImageAngle(root, field, onChange) {
  const slider = root.querySelector("[data-angle-slider]");
  const workspace = root.querySelector(".image-angle-workspace");
  const output = root.querySelector("[data-angle-value]");
  const ray = root.querySelector("[data-angle-ray]");
  const clear = root.querySelector("[data-angle-clear]");
  const paint = (selected) => {
    const value = Number(slider.value);
    const [x, y] = anglePoint(field, value);
    ray.setAttribute("x2", fmt(x)); ray.setAttribute("y2", fmt(y));
    workspace.dataset.angleSelected = String(selected);
    output.textContent = selected ? `${fmt(value)}°` : "未选择";
    slider.setAttribute("aria-valuetext", selected ? `${fmt(value)}度` : "尚未选择角度");
    slider.style.setProperty("--angle-progress", `${100 * (value - field.angle.min) / (field.angle.max - field.angle.min)}%`);
    clear.disabled = !selected;
  };
  const commit = () => {
    const wasSelected = workspace.dataset.angleSelected === "true";
    const previous = output.textContent;
    paint(true);
    if (!wasSelected || output.textContent !== previous) onChange(Number(slider.value));
  };
  slider.addEventListener("input", commit);
  // A tap on the initial thumb must be able to explicitly record 0°.
  slider.addEventListener("pointerup", commit);
  slider.addEventListener("change", commit);
  clear.addEventListener("click", () => {
    slider.value = String(Math.max(field.angle.min, Math.min(field.angle.max, 0)));
    paint(false);
    onChange("");
  });
  paint(workspace.dataset.angleSelected === "true");
}

export function angleDistribution(field, records, binWidth = 10) {
  const { min, max } = field.angle;
  const values = records.map((record) => record.answers?.[field.id]).filter((v) => isImageAngleValue(field, v)).sort((a, b) => a - b);
  // Equal-width groups, including both allowed endpoints. The final group
  // includes max; all other groups are half-open to avoid double counting.
  const count = Math.round((max - min) / binWidth);
  if (!Number.isFinite(binWidth) || binWidth <= 0 || count < 1 || count > 180 || Math.abs(count * binWidth - (max - min)) > 1e-7) {
    throw new Error("角度分布组距必须等分角度范围，且不能超过180组");
  }
  const bins = Array.from({ length: count }, (_, i) => ({ from: min + i * binWidth, to: i === count - 1 ? max : min + (i + 1) * binWidth, count: 0 }));
  for (const value of values) bins[Math.min(count - 1, Math.floor((value - min) / binWidth + 1e-10))].count += 1;
  return { values, bins, count: values.length, mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
    median: quantile(values, 50), sd: sampleStandardDeviation(values), maximum: Math.max(0, ...bins.map((bin) => bin.count)) };
}

export function imageAngleAnalysisHtml(field, result, scaleMaximum = result.maximum, label = field.label) {
  const values = result.values;
  if (!values.length) return `<section class="analysis-chart-card image-angle-analysis"><h2>${escape(label)}</h2><div class="analysis-empty">还没有可用于分析的角度</div></section>`;
  const [x, y] = angleCenter(field);
  const radius = field.angle.radius * field.image.width;
  const scale = Math.max(1, scaleMaximum);
  const innerRadius = radius * 0.35;
  const radial = (count) => innerRadius + count / scale * (radius - innerRadius);
  const grid = [...new Set([0, Math.ceil(scale / 2), scale])].map((n) => {
    const r = radial(n);
    const [tx, ty] = anglePoint(field, Math.max(field.angle.min, Math.min(field.angle.max, 0)), r);
    return `<path d="${arc(field, field.angle.min, field.angle.max, r)}" class="angle-chart-grid"/><text x="${fmt(tx)}" y="${fmt(ty - field.image.width * 0.032)}" class="angle-chart-count">${n}人</text>`;
  }).join("");
  const bars = result.bins.filter((bin) => bin.count > 0).map((bin) => {
    const gap = Math.min(1, (bin.to - bin.from) * 0.1) / 2;
    const from = bin.from + gap, to = bin.to - gap;
    const edge = arc(field, from, to, radial(bin.count));
    const end = anglePoint(field, to, innerRadius), start = anglePoint(field, from, innerRadius);
    const reverse = field.angle.rotation === "clockwise" ? 0 : 1;
    const path = `${edge} L ${end.map(fmt).join(" ")} A ${fmt(innerRadius)} ${fmt(innerRadius)} 0 0 ${reverse} ${start.map(fmt).join(" ")} Z`;
    const last = bin.to === field.angle.max;
    const text = `${fmt(bin.from)}° ≤ 角度 ${last ? "≤" : "<"} ${fmt(bin.to)}°：${bin.count}人，占${(100 * bin.count / values.length).toFixed(1)}%`;
    return `<path d="${path}" class="angle-chart-bar" data-angle-bin data-count="${bin.count}" data-bin-label="${escape(text)}" tabindex="0" role="button" aria-pressed="false" aria-label="${escape(text)}"></path>`;
  }).join("");
  const ticks = [...new Set([field.angle.min, 0, 30, 60, 90, field.angle.max])].filter((v) => v >= field.angle.min && v <= field.angle.max).map((v) => {
    const [tx, ty] = anglePoint(field, v, radius + field.image.width * 0.022);
    return `<text x="${fmt(tx)}" y="${fmt(ty)}" class="angle-chart-tick" dominant-baseline="middle" text-anchor="middle">${v}°</text>`;
  }).join("");
  const ranges = [["Min", 0], ["Max", 100], ...[5, 10, 25, 75, 90, 95].map((p) => [`P${p}`, p])].map(([name, p]) => `<div><dt>${name}</dt><dd>${fmt(quantile(values, p))}°</dd></div>`).join("");
  const statistic = (value) => value === null ? "—" : `${Number(value.toFixed(2))}°`;
  return `<section class="analysis-chart-card image-angle-analysis">
    <h2>${escape(label)}</h2>
    <div class="image-angle-statistics"><span>样本数 <strong>${values.length}</strong></span><span>平均数 <strong>${statistic(result.mean)}</strong></span><span>中位数 <strong>${statistic(result.median)}</strong></span><span>标准差 <strong>${statistic(result.sd)}</strong></span></div>
    <svg class="image-angle-chart" viewBox="0 0 ${field.image.width} ${field.image.height}" role="group" aria-label="${escape(label)}角度人数分布" style="--angle-label-size:${fmt(field.image.width * 0.03)}px;--angle-label-outline:${fmt(field.image.width * 0.005)}px">
      ${image(field)}${bars}${grid}
      ${line(field, 0, innerRadius, 'class="image-angle-baseline"')}
      ${line(field, result.mean, innerRadius, 'class="angle-chart-mean"')}
      <circle cx="${fmt(x)}" cy="${fmt(y)}" r="${fmt(field.image.width * 0.006)}" class="image-angle-center"/>${ticks}
      <text x="50%" y="${fmt(field.image.height - field.image.width * 0.035)}" text-anchor="middle" class="image-angle-bin-info" data-angle-bin-info aria-live="polite" hidden></text>
    </svg>
    <div class="image-angle-legend"><span><svg viewBox="0 0 32 12" role="img" aria-label="平均数实线"><line class="angle-chart-mean" x1="1" y1="6" x2="31" y2="6"/></svg>：平均数</span><span><svg viewBox="0 0 32 12" role="img" aria-label="0度虚线"><line class="image-angle-baseline" x1="1" y1="6" x2="31" y2="6"/></svg>：0°</span></div>
    <details class="analysis-more"><summary>详细统计数据</summary><dl class="image-angle-ranges">${ranges}</dl></details>
  </section>`;
}

const analysisBindings = new WeakMap();

export function bindAngleAnalysis(root) {
  analysisBindings.get(root)?.abort();
  const controller = new AbortController();
  analysisBindings.set(root, controller);
  const select = (bar) => {
    root.querySelectorAll('[data-angle-bin][aria-pressed="true"]').forEach((item) => item.setAttribute("aria-pressed", "false"));
    root.querySelectorAll("[data-angle-bin-info]").forEach((info) => { info.setAttribute("hidden", ""); info.textContent = ""; });
    if (!bar) return;
    bar.setAttribute("aria-pressed", "true");
    const info = bar.closest(".image-angle-analysis").querySelector("[data-angle-bin-info]");
    info.textContent = bar.dataset.binLabel;
    info.removeAttribute("hidden");
  };
  const findBar = (event) => {
    const bar = event.target.closest?.("[data-angle-bin]");
    return bar && root.contains(bar) ? bar : null;
  };
  const options = { signal: controller.signal };
  root.ownerDocument.addEventListener("click", (event) => select(findBar(event)), options);
  root.ownerDocument.addEventListener("focusin", (event) => select(findBar(event)), options);
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { select(null); return; }
    const bar = findBar(event);
    if (bar && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); select(bar); }
  }, options);
}
