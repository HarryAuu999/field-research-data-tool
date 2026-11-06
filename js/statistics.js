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

// Lanczos approximation for the positive arguments used by the t distribution.
const LANCZOS = [676.5203681218851, -1259.1392167224028, 771.3234287776531,
  -176.6150291621406, 12.5073432786869, -0.13857109526572012,
  9.984369578019572e-6, 1.5056327351493116e-7];

function logGamma(value) {
  const z = value - 1;
  const sum = LANCZOS.reduce((total, coefficient, i) => total + coefficient / (z + i + 1), 0.9999999999998099);
  const t = z + 7.5;
  return 0.9189385332046727 + (z + 0.5) * Math.log(t) - t + Math.log(sum);
}

// Modified Lentz evaluation of the incomplete beta continued fraction (DLMF 8.17.22).
function betaFraction(a, b, x) {
  const nonzero = (value) => Math.abs(value) < 1e-30 ? (value < 0 ? -1e-30 : 1e-30) : value;
  let c = 1;
  let d = 1 / nonzero(1 - (a + b) * x / (a + 1));
  let fraction = d;
  for (let m = 1; m <= 200; m += 1) {
    const even = m * (b - m) * x / ((a + 2 * m - 1) * (a + 2 * m));
    const odd = -(a + m) * (a + b + m) * x / ((a + 2 * m) * (a + 2 * m + 1));
    for (const term of [even, odd]) {
      d = 1 / nonzero(1 + term * d);
      c = nonzero(1 + term / c);
      fraction *= d * c;
    }
    if (Math.abs(d * c - 1) < 1e-14) return fraction;
  }
  return NaN;
}

function tTwoSidedProbability(degreesOfFreedom) {
  const a = degreesOfFreedom / 2;
  const b = 0.5;
  const logNormalizer = logGamma(a + b) - logGamma(a) - logGamma(b);
  return (t) => {
    const squareRatio = t ** 2 / degreesOfFreedom;
    if (squareRatio === 0) return 1;
    const x = 1 / (1 + squareRatio);
    if (x === 0) return 0;
    const complement = squareRatio * x;
    const factor = Math.exp(logNormalizer - a * Math.log1p(squareRatio) + b * Math.log(complement));
    const probability = x < (a + 1) / (a + b + 2)
      ? factor * betaFraction(a, b, x) / a
      : 1 - factor * betaFraction(b, a, complement) / b;
    return Math.max(0, Math.min(1, probability));
  };
}

function comparisonValue(field, answer) {
  if (typeof answer !== "number" && typeof answer !== "string") return null;
  if (field.type === "rating" && field.unknownOption && answer === field.unknownOption.id) return null;
  const value = numericValue(answer);
  if (field.type === "rating" && (!Number.isInteger(value) || value < field.min || value > field.max)) return null;
  if (field.type === "number" && field.integer && !Number.isInteger(value)) return null;
  return value;
}

export function pairedTTest(fieldA, fieldB, records) {
  const differences = [];
  let roundoff = 0;
  for (const record of records) {
    const a = comparisonValue(fieldA, record.answers?.[fieldA.id]);
    const b = comparisonValue(fieldB, record.answers?.[fieldB.id]);
    if (a === null || b === null) continue;
    differences.push(b - a);
    roundoff = Math.max(roundoff, Number.EPSILON * Math.max(a, b));
  }
  const count = differences.length;
  const mean = count ? differences.reduce((sum, value) => sum + value, 0) / count : null;
  const summary = { count, excluded: records.length - count, mean };
  if (count < 2) return { ...summary, status: "insufficient" };
  const sd = sampleStandardDeviation(differences);
  if (!Number.isFinite(mean) || !Number.isFinite(sd)) return { ...summary, status: "unavailable" };
  if (sd <= roundoff) return { ...summary, status: "constant" };
  const standardError = sd / Math.sqrt(count);
  const t = mean / standardError;
  const df = count - 1;
  const probability = tTwoSidedProbability(df);
  const p = probability(t);
  // Invert the two-sided tail at 0.05 for the 95% interval.
  // The critical value is at most 12.707 for integer df >= 1.
  let lower = 0;
  let upper = 13;
  for (let step = 0; step < 48; step += 1) {
    const midpoint = (lower + upper) / 2;
    if (probability(midpoint) > 0.05) lower = midpoint;
    else upper = midpoint;
  }
  const margin = ((lower + upper) / 2) * standardError;
  const interval = [mean - margin, mean + margin];
  if (![p, ...interval].every(Number.isFinite)) return { ...summary, status: "unavailable" };
  return { ...summary, status: "ok", t, df, p, interval };
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

/**
 * Summarize categorical answers by respondent, not by number of clicks.
 * Percentages use respondents with at least one valid answer to this question.
 * For multiChoice, percentages across options may sum to more than 100%.
 */
export function categoricalFrequencies(field, records) {
  const options = field.type === "rating"
    ? [
        ...Array.from({ length: field.max - field.min + 1 }, (_, index) => ({
          id: String(field.min + index), label: String(field.min + index)
        })),
        ...(field.unknownOption ? [{ id: field.unknownOption.id, label: field.unknownOption.label }] : [])
      ]
    : (field.options || []).map((option) => ({ id: option.id, label: option.label }));
  const counts = new Map(options.map((option) => [String(option.id), 0]));
  let respondentCount = 0;
  for (const record of records) {
    const answer = record.answers?.[field.id];
    let selected = [];
    if (field.type === "rating") {
      if (answer !== "" && answer !== null && answer !== undefined) selected = [String(answer)];
    } else if (field.type === "singleChoice") {
      const value = answer && typeof answer === "object" ? answer.value : answer;
      if (value !== "" && value !== null && value !== undefined) selected = [String(value)];
    } else if (field.type === "multiChoice") {
      selected = Array.isArray(answer?.values) ? answer.values.map(String) : (Array.isArray(answer) ? answer.map(String) : []);
    }
    const valid = [...new Set(selected)].filter((id) => counts.has(id));
    if (!valid.length) continue;
    respondentCount += 1;
    valid.forEach((id) => counts.set(id, counts.get(id) + 1));
  }
  return {
    respondentCount,
    multiple: field.type === "multiChoice",
    options: options.map((option) => ({
      ...option,
      count: counts.get(String(option.id)),
      percentage: respondentCount ? counts.get(String(option.id)) / respondentCount * 100 : 0
    }))
  };
}
