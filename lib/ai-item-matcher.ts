/**
 * AI Item Matcher Service
 * 
 * Matches user input against glossary and provides intelligent suggestions.
 * Falls back to web search if no glossary match is found.
 */

import { 
  FINANCIAL_GLOSSARY, 
  findGlossaryItem, 
  searchGlossary,
  type GlossaryItem,
  type PrimaryStatement 
} from "./financial-glossary";

export interface MatchResult {
  matchedConcept: GlossaryItem | null;
  confidence: number; // 0-1
  suggestions: GlossaryItem[];
  description: string;
  shouldAllow: boolean;
  suggestedLabel?: string; // Best match label to use
}

/**
 * Calculate similarity score between two strings (0-1)
 */
function calculateSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();
  
  // Exact match
  if (s1 === s2) return 1.0;
  
  // Contains match
  if (s1.includes(s2) || s2.includes(s1)) return 0.8;
  
  // Word overlap
  const words1 = s1.split(/\s+/);
  const words2 = s2.split(/\s+/);
  const commonWords = words1.filter(w => words2.includes(w));
  if (commonWords.length > 0) {
    return Math.min(0.7, commonWords.length / Math.max(words1.length, words2.length));
  }
  
  // Character similarity (simple Levenshtein-like)
  let matches = 0;
  const minLen = Math.min(s1.length, s2.length);
  for (let i = 0; i < minLen; i++) {
    if (s1[i] === s2[i]) matches++;
  }
  
  return matches / Math.max(s1.length, s2.length) * 0.5;
}

/**
 * Match user input against glossary
 */
export function matchAgainstGlossary(
  userInput: string, 
  statementType: PrimaryStatement
): MatchResult {
  const normalized = userInput.toLowerCase().trim();
  
  // Try exact match first
  const exactMatch = findGlossaryItem(userInput);
  if (exactMatch && exactMatch.primaryStatement === statementType) {
    return {
      matchedConcept: exactMatch,
      confidence: 1.0,
      suggestions: [],
      description: exactMatch.description,
      shouldAllow: true,
      suggestedLabel: exactMatch.concept,
    };
  }
  
  // Search glossary for similar items
  const searchResults = searchGlossary(userInput, statementType);
  
  if (searchResults.length > 0) {
    // Calculate similarity scores
    const scored = searchResults.map(item => ({
      item,
      score: Math.max(
        calculateSimilarity(userInput, item.concept),
        ...(item.alternativeNames?.map(name => calculateSimilarity(userInput, name)) || []),
        ...item.typicalPresentation.map(p => calculateSimilarity(userInput, p))
      ),
    })).sort((a, b) => b.score - a.score);
    
    const bestMatch = scored[0];
    
    if (bestMatch.score >= 0.6) {
      // Good match
      return {
        matchedConcept: bestMatch.item,
        confidence: bestMatch.score,
        suggestions: scored.slice(1, 4).map(s => s.item), // Top 3 alternatives
        description: bestMatch.item.description,
        shouldAllow: true,
        suggestedLabel: bestMatch.item.concept,
      };
    } else if (bestMatch.score >= 0.3) {
      // Partial match - suggest but warn
      return {
        matchedConcept: bestMatch.item,
        confidence: bestMatch.score,
        suggestions: scored.slice(1, 4).map(s => s.item),
        description: bestMatch.item.description,
        shouldAllow: true,
        suggestedLabel: bestMatch.item.concept,
      };
    }
  }
  
  // No good match found
  return {
    matchedConcept: null,
    confidence: 0,
    suggestions: searchResults.slice(0, 5), // Top 5 suggestions anyway
    description: "",
    shouldAllow: false,
  };
}

/**
 * Search web for similar financial terms
 * This is a placeholder - in production, you'd use an actual search API
 */
export async function searchWebForSimilar(
  userInput: string,
  statementType: PrimaryStatement
): Promise<MatchResult> {
  // TODO: Implement actual web search API integration
  // For now, return empty result
  // In production, you might use:
  // - Google Custom Search API
  // - Bing Search API
  // - Financial term databases
  
  return {
    matchedConcept: null,
    confidence: 0,
    suggestions: [],
    description: "",
    shouldAllow: false,
  };
}

/**
 * Suggest best match for user input
 * Combines glossary matching with web search fallback
 */
export async function suggestBestMatch(
  userInput: string,
  statementType: PrimaryStatement
): Promise<MatchResult> {
  // First, try glossary match
  const glossaryMatch = matchAgainstGlossary(userInput, statementType);
  
  // If good match found, return it
  if (glossaryMatch.confidence >= 0.6) {
    return glossaryMatch;
  }
  
  // If partial match, still return it but user should review
  if (glossaryMatch.confidence >= 0.3) {
    return glossaryMatch;
  }
  
  // No glossary match - try web search
  const webMatch = await searchWebForSimilar(userInput, statementType);
  
  // If web search found something, use it
  if (webMatch.confidence > 0) {
    return webMatch;
  }
  
  // No match found - return glossary suggestions anyway
  return {
    ...glossaryMatch,
    shouldAllow: false, // Don't allow if no match
  };
}

/**
 * Validate if a concept makes sense for a statement type
 * Returns synchronously for immediate validation
 */
export function validateConceptForStatement(
  concept: string,
  statementType: PrimaryStatement
): { isValid: boolean; reason?: string } {
  const match = matchAgainstGlossary(concept, statementType);
  
  if (match.confidence >= 0.6) {
    return { isValid: true };
  }
  
  if (match.confidence >= 0.3) {
    return { 
      isValid: true, 
      reason: "Partial match found. Please verify this is correct." 
    };
  }
  
  // Check if it might belong to another statement
  const allMatches = searchGlossary(concept);
  const otherStatementMatches = allMatches.filter(m => m.primaryStatement !== statementType);
  
  if (otherStatementMatches.length > 0) {
    return {
      isValid: false,
      reason: `This item typically belongs to ${otherStatementMatches[0].primaryStatement}. Did you mean to add it there?`
    };
  }
  
  return {
    isValid: false,
    reason: "This term is not recognized. Please use standard financial terminology."
  };
}
