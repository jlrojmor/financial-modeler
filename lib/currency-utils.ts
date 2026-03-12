/**
 * Currency Unit Utilities
 * 
 * Handles conversion between display values (what user sees/enters) and stored values (actual numbers).
 * 
 * Example: If unit is "millions", user enters "1" but we store 1,000,000
 */

export type CurrencyUnit = "units" | "thousands" | "millions";

const UNIT_MULTIPLIERS: Record<CurrencyUnit, number> = {
  units: 1,
  thousands: 1_000,
  millions: 1_000_000,
};

/**
 * Convert display value (what user enters) to stored value (actual number)
 */
export function displayToStored(displayValue: number, unit: CurrencyUnit): number {
  return displayValue * UNIT_MULTIPLIERS[unit];
}

/**
 * Convert stored value (actual number) to display value (what user sees)
 */
export function storedToDisplay(storedValue: number, unit: CurrencyUnit): number {
  return storedValue / UNIT_MULTIPLIERS[unit];
}

/**
 * Get the unit label for display
 */
export function getUnitLabel(unit: CurrencyUnit): string {
  switch (unit) {
    case "millions":
      return "M";
    case "thousands":
      return "K";
    case "units":
      return "";
    default:
      return "";
  }
}

/**
 * Format a stored value for display with unit
 */
export function formatCurrencyDisplay(
  storedValue: number,
  unit: CurrencyUnit,
  currency: string = "USD"
): string {
  const displayValue = storedToDisplay(storedValue, unit);
  const unitLabel = getUnitLabel(unit);
  
  // Format with appropriate decimals
  const decimals = unit === "millions" ? 2 : unit === "thousands" ? 1 : 0;
  const formatted = displayValue.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  
  return `${formatted}${unitLabel ? ` ${unitLabel}` : ""}`;
}

/**
 * Format an integer for display: thousands separators, no decimals, negatives in parentheses.
 * Use for display-only tables (e.g. Cash Reconciliation). null/undefined → "—".
 * Examples: 1089104 → "1,089,104"; -259635 → "(259,635)".
 */
export function formatIntegerWithSeparators(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const formatter = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
    useGrouping: true,
  });
  if (value < 0) return `(${formatter.format(-value)})`;
  return formatter.format(value);
}

/**
 * Get currency symbol
 */
export function getCurrencySymbol(currency: string): string {
  const symbols: Record<string, string> = {
    USD: "$",
    EUR: "€",
    GBP: "£",
    MXN: "MX$",
    JPY: "¥",
    CAD: "C$",
    AUD: "A$",
  };
  return symbols[currency] || currency;
}

/** Supported currency codes for model setup (code -> display label with symbol) */
export const CURRENCY_OPTIONS: { value: string; label: string }[] = [
  { value: "USD", label: "US Dollar ($)" },
  { value: "EUR", label: "Euro (€)" },
  { value: "GBP", label: "British Pound (£)" },
  { value: "MXN", label: "Mexican Peso (MX$)" },
  { value: "JPY", label: "Japanese Yen (¥)" },
  { value: "CAD", label: "Canadian Dollar (C$)" },
  { value: "AUD", label: "Australian Dollar (A$)" },
];
