const DECIMAL_PATTERN = /^(?:\d+|\d*\.\d+)$/;

export const DESCRIPTIVE_STATISTICS = [
  "count",
  "mean",
  "median",
  "mode",
  "min",
  "max",
  "sd",
  "q1",
  "q3"
];

function numericValue(value) {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  const text = String(value ?? "").trim();
  if (!DECIMAL_PATTERN.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

export function quantile(sortedValues, percentile) {
  if (!sortedValues.length) return null;
  if (sortedValues.length === 1) return sortedValues[0];
  const position = (sortedValues.length - 1) * (percentile / 100);
  const lower = Math.floor(position);
  const fraction = position - lower;
  return sortedValues[lower] + (sortedValues[Math.min(lower + 1, sortedValues.length - 1)] - sortedValues[lower]) * fraction;
}

export function sampleStandardDeviation(values) {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (values.length - 1));
}

export function modes(values) {
  if (!values.length) return [];
  const frequencies = new Map();
  values.forEach((value) => frequencies.set(value, (frequencies.get(value) || 0) + 1));
  const highest = Math.max(...frequencies.values());
  if (highest <= 1) return [];
  return [...frequencies.entries()]
    .filter(([, count]) => count === highest)
    .map(([value]) => value)
    .sort((a, b) => a - b);
}

export function descriptiveStatistics(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) {
    return { count: 0, mean: null, median: null, mode: [], min: null, max: null, sd: null, q1: null, q3: null };
  }
  return {
    count: sorted.length,
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    median: quantile(sorted, 50),
    mode: modes(sorted),
    min: sorted[0],
    max: sorted.at(-1),
    sd: sampleStandardDeviation(sorted),
    q1: quantile(sorted, 25),
    q3: quantile(sorted, 75)
  };
}

export function analysisValue(field, answer, aggregation = "participantMean") {
  if (field.type === "number") return numericValue(answer);
  if (field.type !== "repeatedNumber" || aggregation !== "participantMean") return null;
  const values = (Array.isArray(answer) ? answer : []).map(numericValue).filter((value) => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function fieldDistribution(template, records, fieldId, aggregation = "participantMean") {
  const field = template.fields.find((item) => item.id === fieldId);
  if (!field) return [];
  return records
    .map((record) => analysisValue(field, record.answers?.[fieldId], aggregation))
    .filter((value) => value !== null)
    .sort((a, b) => a - b);
}

export function displayPrecision(values) {
  const decimals = values.map((value) => {
    const text = String(value);
    return text.includes(".") ? text.split(".")[1].length : 0;
  });
  return Math.min(2, Math.max(1, ...decimals));
}

export function formatStatistic(value, values = []) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(displayPrecision(values)).replace(/0+$/, "").replace(/\.$/, "");
}
