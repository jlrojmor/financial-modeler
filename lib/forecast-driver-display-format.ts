/**
 * Read-only formatting for Forecast Drivers context (builder / audit).
 * Absolute currency = model currency, not statement K/M display unit.
 */

import { getCurrencySymbol } from "@/lib/currency-utils";

export function formatDriverVolumeCount(n: number): string {
  return new Intl.NumberFormat(undefined, {
    useGrouping: true,
    maximumFractionDigits: 8,
    minimumFractionDigits: 0,
  }).format(n);
}

export function formatDriverAbsoluteCurrency(n: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${getCurrencySymbol(currencyCode)}${formatDriverVolumeCount(n)}`;
  }
}

export function formatDriverPercentOneDecimal(n: number): string {
  return `${new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n)}%`;
}
