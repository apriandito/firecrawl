import { normalizeDate } from "./dates.js";

/**
 * "Tame" primitives: turn messy display strings into typed values from the
 * start. Numbers become numbers, dates become ISO, footnote refs are dropped —
 * so downstream data is analysis-ready, not a wall of strings.
 */

/** Strip footnote/citation markers: "UN projection[1][3]" -> "UN projection". */
export function stripFootnotes(s: string): string {
  return s
    .replace(/\[[^\]]*\]/g, "") // [1], [b], [note 2]
    .replace(/\((?:note|catatan)[^)]*\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse a numeric string, disambiguating thousands vs decimal separators:
 * "8,232,000,000" -> 8232000000, "2,4" -> 2.4, "1.250" -> 1250, "4.8" -> 4.8,
 * "Rp1.250.000" -> 1250000. Returns null if not numeric.
 */
export function parseNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const cleaned = v.replace(/[^\d.,-]/g, "");
  if (!cleaned || !/\d/.test(cleaned)) return null;
  const neg = /^-/.test(cleaned);
  const body = cleaned.replace(/-/g, "");
  const dots = (body.match(/\./g) ?? []).length;
  const commas = (body.match(/,/g) ?? []).length;

  let norm: string;
  if (dots && commas) {
    norm =
      body.lastIndexOf(",") > body.lastIndexOf(".")
        ? body.replace(/\./g, "").replace(",", ".")
        : body.replace(/,/g, "");
  } else if (dots + commas === 1) {
    const sep = dots ? "." : ",";
    const frac = body.slice(body.indexOf(sep) + 1);
    norm = frac.length === 3 ? body.replace(sep, "") : body.replace(sep, ".");
  } else {
    norm = body.replace(/[.,]/g, "");
  }
  const n = Number(norm);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

/** "12,5%" -> 12.5 (face value; type tag records that it's a percent). */
export function parsePercent(v: string): number | null {
  if (!/%/.test(v)) return null;
  return parseNumber(v.replace(/%/g, ""));
}

export type CellType = "number" | "percent" | "date" | "text";

/** Classify a single cleaned value. Order matters: percent > date > number. */
export function classifyValue(raw: string): CellType {
  const s = stripFootnotes(raw);
  if (!s) return "text";
  if (/%\s*$/.test(s) && parsePercent(s) !== null) return "percent";
  if (normalizeDate(s)) return "date";
  if (parseNumber(s) !== null) return "number";
  return "text";
}

/** Infer a column type from its values (majority vote over non-empty cells). */
export function inferColumnType(values: string[], threshold = 0.7): CellType {
  const nonEmpty = values.map((v) => stripFootnotes(v)).filter(Boolean);
  if (nonEmpty.length === 0) return "text";
  const counts: Record<CellType, number> = { number: 0, percent: 0, date: 0, text: 0 };
  for (const v of nonEmpty) counts[classifyValue(v)]++;
  const n = nonEmpty.length;
  if (counts.percent / n >= threshold) return "percent";
  if (counts.date / n >= threshold) return "date";
  // numbers and percents are both numeric evidence for a number column
  if ((counts.number + counts.percent) / n >= threshold) return "number";
  return "text";
}

/** Coerce a raw cell to the column's type. Unparseable -> null. */
export function coerceCell(raw: string, type: CellType): string | number | null {
  const s = stripFootnotes(raw);
  if (s === "") return null;
  switch (type) {
    case "number":
      return parseNumber(s);
    case "percent":
      return parsePercent(s) ?? parseNumber(s);
    case "date":
      return normalizeDate(s)?.date ?? null;
    default:
      return s;
  }
}
