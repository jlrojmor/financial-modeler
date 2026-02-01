# Financial Statement Builders - Homogenization Plan

## Overview
Standardize IS, BS, and CFS builders to have identical UI patterns, interactions, and behaviors.

## Requirements Summary

### Core Features (All Builders)
1. **Common/Mandatory Suggestions**: Show only the most common items, not entire glossary
2. **Manual Addition with AI Matching**: 
   - User types item name
   - AI matches against glossary (Excel reference)
   - If no match, search internet for similar terms
   - Suggest best match before allowing addition
3. **Item Display Pattern**:
   - **Expanded State**: Shows description, input fields for all historical years, Edit/Confirm/Remove buttons
   - **Collapsed State**: Shows only item name (after confirmation)
   - Items are expandable/collapsible
4. **Item Actions**:
   - **Edit**: Expands item to show inputs
   - **Confirm**: Collapses item, marks as confirmed
   - **Remove**: Deletes item (with confirmation for non-standard items)
5. **Live Preview**: All items automatically appear in Excel preview as rows
6. **Descriptions**: Each item shows brief description from glossary

## Implementation Steps

### Phase 1: Foundation (Glossary & Core Components)

#### Step 1.1: Glossary Data Structure
- Create `lib/financial-glossary.ts`
- Structure to store:
  - Concept name
  - Primary statement (IS/BS/CFS)
  - Detailed description
  - Typical 10-K presentation examples
  - Impact on other statements
  - Forecasting method
  - CFS section (if applicable)
  - Common/mandatory flag

#### Step 1.2: Unified ItemCard Component
- Create `components/unified-item-card.tsx`
- Features:
  - Expand/collapse state management
  - Edit/Confirm/Remove buttons
  - Description display
  - Input fields for historical years
  - Visual states: editing, confirmed, locked
  - Consistent styling across all builders

#### Step 1.3: AI Matching Service
- Create `lib/ai-item-matcher.ts`
- Functions:
  - `matchAgainstGlossary(userInput: string, statementType: 'IS' | 'BS' | 'CFS'): MatchResult`
  - `searchWebForSimilar(userInput: string): Promise<MatchResult[]>`
  - `suggestBestMatch(userInput: string, statementType: 'IS' | 'BS' | 'CFS'): Promise<MatchResult>`
- Returns: matched concept, confidence, description, suggestions

#### Step 1.4: Common Suggestions System
- Create `lib/common-suggestions.ts`
- Functions:
  - `getCommonISItems(): GlossaryItem[]`
  - `getCommonBSItems(): GlossaryItem[]`
  - `getCommonCFSItems(section: 'CFO' | 'CFI' | 'CFF'): GlossaryItem[]`
- Filters glossary to show only common/mandatory items

### Phase 2: Refactor Income Statement Builder

#### Step 2.1: Create Unified IS Builder
- Replace current fragmented builders (revenue-cogs, sga, dana, etc.) with single unified builder
- Structure by sections:
  - Revenue (with breakdowns)
  - COGS (with breakdowns)
  - Gross Profit (calculated)
  - Operating Expenses (SG&A with breakdowns)
  - D&A
  - Interest & Other
  - Tax
  - Net Income (calculated)

#### Step 2.2: Implement Suggestions
- Show common IS items as suggestions
- Allow adding via suggestions or manual entry

#### Step 2.3: Implement Item Management
- Use UnifiedItemCard for all items
- Expand/collapse functionality
- Edit/Confirm/Remove actions

### Phase 3: Refactor Balance Sheet Builder

#### Step 3.1: Update BS Builder Structure
- Organize by sections:
  - Assets (Current, Fixed, Other)
  - Liabilities (Current, Non-Current)
  - Equity

#### Step 3.2: Implement Suggestions
- Show common BS items per section
- AI matching for manual additions

#### Step 3.3: Implement Item Management
- Use UnifiedItemCard
- Same expand/collapse pattern as IS

### Phase 4: Refactor Cash Flow Statement Builder

#### Step 4.1: Update CFS Builder
- Already has good structure (Operating, Investing, Financing)
- Enhance with unified item cards

#### Step 4.2: Implement Suggestions
- Already has CFF/CFI/CFO intelligence
- Enhance with glossary-based common suggestions

#### Step 4.3: Implement Item Management
- Use UnifiedItemCard
- Same expand/collapse pattern

### Phase 5: Testing & Validation

#### Step 5.1: Homogeneity Check
- Verify all builders have identical:
  - UI patterns
  - Interaction flows
  - Visual styling
  - Button placements
  - Expand/collapse behavior

#### Step 5.2: Functionality Check
- Verify items appear in Excel preview
- Verify calculations work
- Verify AI matching works
- Verify suggestions are appropriate

## Technical Details

### Glossary Data Format
```typescript
interface GlossaryItem {
  concept: string;
  primaryStatement: 'IS' | 'BS' | 'CFS';
  description: string;
  typicalPresentation: string[];
  impactOnOtherStatements: string;
  forecastingMethod: string;
  cfsSection?: 'CFO' | 'CFI' | 'CFF' | 'Supplemental' | 'Non-cash';
  isCommon: boolean; // Most common/mandatory items
  isMandatory: boolean; // Required items
  alternativeNames?: string[]; // For matching
}
```

### ItemCard State Management
```typescript
interface ItemCardState {
  isExpanded: boolean;
  isEditing: boolean;
  isConfirmed: boolean;
  values: Record<string, number>; // year -> value
}
```

### AI Matching Result
```typescript
interface MatchResult {
  matchedConcept: GlossaryItem | null;
  confidence: number; // 0-1
  suggestions: GlossaryItem[];
  description: string;
  shouldAllow: boolean;
}
```

## File Structure
```
lib/
  financial-glossary.ts (glossary data)
  ai-item-matcher.ts (matching logic)
  common-suggestions.ts (filtered suggestions)

components/
  unified-item-card.tsx (reusable item component)
  income-statement-builder.tsx (refactored)
  balance-sheet-builder.tsx (refactored)
  cash-flow-builder.tsx (enhanced)
```

## Success Criteria
1. ✅ All three builders have identical UI patterns
2. ✅ All items are expandable/collapsible
3. ✅ All items have descriptions
4. ✅ Suggestions show only common items
5. ✅ AI matching works for manual additions
6. ✅ Items appear in Excel preview
7. ✅ Edit/Confirm/Remove works consistently
8. ✅ Glossary is used as reference for all matching
