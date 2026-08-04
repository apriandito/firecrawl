/**
 * Deterministic date normalization. News pages express dates in many shapes and
 * languages ("16 Juni 2026", "04 August 2026 09:00", ISO with offset). We
 * collapse them all to a canonical form so a dataset column is consistent —
 * without asking an LLM (which would be non-deterministic and cost tokens).
 */

const MONTHS: Record<string, number> = {};
const register = (names: string[], idx: number) =>
  names.forEach((n) => (MONTHS[n.toLowerCase()] = idx));

// English
register(["january", "jan"], 1);
register(["february", "feb"], 2);
register(["march", "mar"], 3);
register(["april", "apr"], 4);
register(["may"], 5);
register(["june", "jun"], 6);
register(["july", "jul"], 7);
register(["august", "aug"], 8);
register(["september", "sep", "sept"], 9);
register(["october", "oct"], 10);
register(["november", "nov"], 11);
register(["december", "dec"], 12);
// Indonesian
register(["januari"], 1);
register(["februari", "pebruari"], 2);
register(["maret"], 3);
register(["april"], 4);
register(["mei"], 5);
register(["juni"], 6);
register(["juli"], 7);
register(["agustus"], 8);
register(["september"], 9);
register(["oktober"], 10);
register(["november", "nopember"], 11);
register(["desember"], 12);

export interface NormalizedDate {
  /** Canonical calendar date, always "YYYY-MM-DD". */
  date: string;
  /** Full ISO timestamp when a time (and optionally offset) was present. */
  iso: string;
  /** True if a clock time was found in the source. */
  hasTime: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Parse a messy date string into a canonical form, or null if unrecognizable.
 * Never uses `new Date(str)` heuristics (locale-dependent); every branch is
 * explicit so the output is stable across machines.
 */
export function normalizeDate(input: string | null | undefined): NormalizedDate | null {
  if (!input) return null;
  const s = input.trim();
  if (!s) return null;

  // 1. ISO 8601 (possibly with time/offset): 2026-08-04, 2026-08-04T09:00:42+07:00
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?(Z|[+-]\d{2}:?\d{2})?/.exec(s);
  if (iso) {
    const [, y, mo, d, hh, mm, ss, tz] = iso;
    return build(+y, +mo, +d, hh, mm, ss, tz);
  }

  // 2. Compact URL/slug timestamp: 20260804 or 20260804093404
  const compact = /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2})?)?$/.exec(s);
  if (compact) {
    const [, y, mo, d, hh, mm, ss] = compact;
    return build(+y, +mo, +d, hh, mm, ss);
  }

  // 3. "DD MonthName YYYY [HH:MM[:SS]]" (English or Indonesian month)
  const named = /^(\d{1,2})\s+([A-Za-zÀ-ɏ]+)\.?\s+(\d{4})(?:[,\s]+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?)?/.exec(s);
  if (named) {
    const [, d, monName, y, hh, mm, ss] = named;
    const mo = MONTHS[monName.toLowerCase()];
    if (mo) return build(+y, mo, +d, hh, mm, ss);
  }

  // 4. "MonthName DD, YYYY" (English-first order)
  const named2 = /^([A-Za-zÀ-ɏ]+)\.?\s+(\d{1,2}),?\s+(\d{4})(?:[,\s]+(\d{1,2})[:.](\d{2}))?/.exec(s);
  if (named2) {
    const [, monName, d, y, hh, mm] = named2;
    const mo = MONTHS[monName.toLowerCase()];
    if (mo) return build(+y, mo, +d, hh, mm);
  }

  // 5. Numeric DD/MM/YYYY or DD-MM-YYYY (day-first; the Indonesian convention).
  const numeric = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})(?:[,\s]+(\d{1,2})[:.](\d{2}))?/.exec(s);
  if (numeric) {
    const [, d, mo, y, hh, mm] = numeric;
    if (+mo >= 1 && +mo <= 12 && +d >= 1 && +d <= 31) {
      return build(+y, +mo, +d, hh, mm);
    }
  }

  return null;
}

function build(
  y: number,
  mo: number,
  d: number,
  hh?: string,
  mm?: string,
  ss?: string,
  tz?: string,
): NormalizedDate | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const date = `${y}-${pad(mo)}-${pad(d)}`;
  const hasTime = hh !== undefined && mm !== undefined;
  const time = hasTime ? `T${pad(+hh!)}:${pad(+mm!)}:${pad(ss ? +ss : 0)}` : "T00:00:00";
  const offset = tz ? (tz === "Z" ? "Z" : tz.replace(/(\d{2})(\d{2})$/, "$1:$2")) : "";
  return { date, iso: `${date}${time}${offset}`, hasTime };
}
