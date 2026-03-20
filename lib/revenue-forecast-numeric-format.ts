/**
 * Revenue Forecast builder: comma grouping on blur, plain typing while focused.
 * Parsing for Apply/commit should use stripNumberGrouping() before parseFloat.
 */

export function stripNumberGrouping(s: string): string {
  return s.replace(/,/g, "").trim();
}

/**
 * Thousands separators on the integer part; optional decimal preserved (no % inside value).
 * Trailing "." alone is dropped (e.g. "10." → "10").
 */
export function formatNumberInputDisplayOnBlur(raw: string): string {
  const t = stripNumberGrouping(raw);
  if (t === "") return "";
  if (t === "-") return "-";

  const neg = t.startsWith("-");
  let body = neg ? t.slice(1) : t;
  if (body.startsWith(".")) {
    body = "0" + body;
  }

  const dot = body.indexOf(".");
  const intRaw = dot >= 0 ? body.slice(0, dot) : body;
  const hasDot = dot >= 0;
  const decRaw = hasDot ? body.slice(dot + 1) : undefined;

  const intDigits = intRaw.replace(/\D/g, "");
  const decDigits = decRaw !== undefined ? decRaw.replace(/\D/g, "") : undefined;

  if (intDigits === "" && (decDigits === undefined || decDigits === "")) {
    return neg ? "-" : "";
  }

  const intFormatted = intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  let out = (neg ? "-" : "") + intFormatted;
  if (hasDot && decDigits !== undefined && decDigits.length > 0) {
    out += "." + decDigits;
  }
  return out;
}
