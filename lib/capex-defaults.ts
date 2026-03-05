/**
 * IB Standard default useful lives and typical ranges for Capex Allocation Helper.
 * Source: Default Useful Life Assumptions (IB Standard).
 * These are the default amounts; the user can change them.
 */

export const CAPEX_DEFAULT_BUCKET_IDS = [
  "cap_b1",
  "cap_b2",
  "cap_b3",
  "cap_b4",
  "cap_b5",
  "cap_b6",
  "cap_b7",
  "cap_b8",
  "cap_b9",
  "cap_b10",
] as const;

/** Default useful life (years) per bucket. Land and CIP = 0 (N/A, not depreciated). */
export const CAPEX_IB_DEFAULT_USEFUL_LIVES: Record<string, number> = {
  cap_b1: 0,   // Land: ∞ (no depreciation)
  cap_b2: 30,  // Buildings & Improvements
  cap_b3: 10,  // Machinery & Equipment
  cap_b4: 3,   // Computer Hardware
  cap_b5: 5,   // Software (Capitalized)
  cap_b6: 7,   // Furniture & Fixtures
  cap_b7: 10,  // Leasehold Improvements
  cap_b8: 5,   // Vehicles
  cap_b9: 0,   // Construction in Progress (CIP): N/A until placed in service
  cap_b10: 10, // Other PP&E
};

/** Typical range (for placeholder/tooltip) per bucket. */
export const CAPEX_IB_TYPICAL_RANGE: Record<string, string> = {
  cap_b1: "N/A",
  cap_b2: "25–40",
  cap_b3: "7–15",
  cap_b4: "3–5",
  cap_b5: "3–7",
  cap_b6: "5–10",
  cap_b7: "5–15",
  cap_b8: "4–7",
  cap_b9: "N/A",
  cap_b10: "7–15",
};

export const CAPEX_HELPER_LAND_ID = "cap_b1";
export const CAPEX_HELPER_CIP_ID = "cap_b9";

/** Detect legacy/wrong saved useful lives (e.g. Buildings 2, Machinery 1.5, Computer 1) so we can replace with IB defaults. */
export function isLegacyWrongUsefulLives(byBucket: Record<string, number> | null | undefined): boolean {
  if (!byBucket || Object.keys(byBucket).length === 0) return true;
  const b2 = byBucket.cap_b2;
  const b3 = byBucket.cap_b3;
  const b4 = byBucket.cap_b4;
  if (b2 === 2 && b3 === 1.5 && b4 === 1) return true;
  if (b2 != null && b2 < 5) return true;
  if (b3 != null && b3 < 3) return true;
  if (b4 != null && b4 < 2) return true;
  return false;
}
