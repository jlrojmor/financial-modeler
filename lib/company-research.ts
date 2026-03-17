/**
 * Lightweight company research layer: gather evidence before synthesis.
 * Input → research (entity, website guess, evidence clues) → feeds overview, subtype, comps.
 */

import type { CompanyContextUserInputs } from "@/types/company-context";
import type { CompanyResearch, ResearchConfidence, ResearchSourceType } from "@/types/company-context";

function slug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 50);
}

/** Guess likely domain from company name and HQ (e.g. Mexico → .mx). */
function guessDomain(name: string, headquartersCountry: string): string | undefined {
  const s = slug(name);
  if (!s) return undefined;
  const hq = (headquartersCountry ?? "").toLowerCase();
  const tld = hq.includes("mexico") ? "mx" : hq.includes("uk") || hq.includes("united kingdom") ? "co.uk" : "com";
  return `${s}.${tld}`;
}

/** Extract business model clues from description. */
function businessModelClues(description: string): string[] {
  if (!description?.trim()) return [];
  const d = description.toLowerCase();
  const clues: string[] = [];
  if (/\b(distribut|wholesale|mayoreo|wholesaler)\b/.test(d)) clues.push("distribution/wholesale");
  if (/\b(retail|store|tienda)\b/.test(d)) clues.push("retail");
  if (/\b(saas|software|subscription|recurring)\b/.test(d)) clues.push("SaaS/subscription");
  if (/\b(lab|laboratorio|laboratory|diagnostic|clinical|testing|prueba)\b/.test(d)) clues.push("lab/diagnostics");
  if (/\b(pharma|pharmaceutical|biotech|drug|farmac)\b/.test(d)) clues.push("pharma/biotech");
  if (/\b(device|medical device|equipo médico)\b/.test(d)) clues.push("medical device");
  if (/\b(service|servicio|healthcare|hospital)\b/.test(d)) clues.push("healthcare services");
  if (/\b(marketplace|platform|two-sided)\b/.test(d)) clues.push("marketplace");
  if (/\b(manufactur|industrial|fabricación)\b/.test(d)) clues.push("manufacturing/industrial");
  return clues;
}

/** Subtype clues for healthcare and others. */
function subtypeClues(description: string): string[] {
  if (!description?.trim()) return [];
  const d = description.toLowerCase();
  const clues: string[] = [];
  if (/\b(diagnostic|diagnóstic|lab|laboratorio)\b/.test(d)) clues.push("diagnostics_lab");
  if (/\b(clinical|testing|prueba|análisis)\b/.test(d)) clues.push("clinical_testing");
  if (/\b(contract|cro|research)\b/.test(d)) clues.push("contract_lab");
  if (/\b(device|equipo médico)\b/.test(d)) clues.push("medical_device");
  if (/\b(pharma|biotech|drug)\b/.test(d)) clues.push("pharma_biotech");
  if (/\b(service|hospital|payor|insurance)\b/.test(d)) clues.push("healthcare_services");
  return clues;
}

/** Region clues from HQ and description. */
function regionClues(inputs: CompanyContextUserInputs): string[] {
  const clues: string[] = [];
  const hq = (inputs.headquartersCountry ?? "").trim();
  if (hq) clues.push(`HQ: ${hq}`);
  const geo = inputs.mainOperatingGeography;
  if (geo && geo !== "other") clues.push(`Operating geography: ${geo}`);
  const d = (inputs.shortBusinessDescription ?? "").toLowerCase();
  if (/\bmexico|méxico|latam|latam\b/.test(d)) clues.push("Mexico/LATAM");
  if (/\bus\b|united states|usa\b/.test(d)) clues.push("US");
  if (/\bcanada\b/.test(d)) clues.push("Canada");
  if (/\beurope\b/.test(d)) clues.push("Europe");
  return clues;
}

/**
 * Run lightweight company research from user inputs.
 * Does not fetch external URLs yet; builds evidence from name + description + HQ.
 * Architecture: input → research → evidence → synthesis.
 */
export function runCompanyResearch(inputs: CompanyContextUserInputs): CompanyResearch {
  const name = (inputs.companyName ?? "").trim();
  const description = (inputs.shortBusinessDescription ?? "").trim();
  const headquartersCountry = (inputs.headquartersCountry ?? "").trim();

  const resolvedEntityName = name || "Unknown company";
  const resolvedWebsite = name ? guessDomain(name, headquartersCountry) : undefined;
  const websiteSummary: string | undefined = undefined; // Reserved for future fetch of homepage/about

  const businessModelEvidence = businessModelClues(description);
  const subtypeEvidence = subtypeClues(description);
  const regionEvidence = regionClues(inputs);

  let researchConfidence: ResearchConfidence;
  let sourceType: ResearchSourceType;

  if (websiteSummary && websiteSummary.length > 20) {
    researchConfidence = "research_backed";
    sourceType = businessModelEvidence.length > 0 || subtypeEvidence.length > 0 ? "mixed" : "website";
  } else if (description.length >= 15 && (businessModelEvidence.length > 0 || subtypeEvidence.length > 0)) {
    researchConfidence = "mixed_evidence";
    sourceType = "mixed";
  } else if (description.length >= 10) {
    researchConfidence = "limited_evidence";
    sourceType = "user_description";
  } else {
    researchConfidence = "limited_evidence";
    sourceType = "inferred";
  }

  return {
    resolvedEntityName,
    resolvedWebsite,
    websiteSummary,
    businessModelEvidence,
    subtypeEvidence,
    regionEvidence,
    researchConfidence,
    sourceType,
  };
}
