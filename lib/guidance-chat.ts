/**
 * Guidance chat: answers user questions in builder help panels.
 *
 * Current: curated IB/FC Q&A with keyword matching (no API).
 * Later: swap to API (e.g. POST /api/guidance-chat → OpenAI/ChatGPT) for better answers.
 * Design: getGuidanceReply(context, message) is the single entry point so we can
 * replace the implementation without changing the UI.
 */

export type GuidanceChatContext = "wc_schedule" | "general";

/** Curated Q&A for Working Capital / BS Build guidance. */
const WC_FAQ: { keywords: string[]; question: string; answer: string }[] = [
  {
    keywords: ["ar", "receivable", "receivables", "dso", "days sales"],
    question: "How do I project Accounts Receivable?",
    answer:
      "Use DSO (Days Sales Outstanding): project AR using Days on Revenue. Formula: (AR / Revenue) × 365. Select 'Days' and choose 'Revenue' as the base. This is the standard IB approach.",
  },
  {
    keywords: ["inventory", "dio", "days inventory"],
    question: "How do I project Inventory?",
    answer:
      "Use DIO (Days Inventory Outstanding): project Inventory using Days on COGS. Formula: (Inventory / COGS) × 365. Select 'Days' and choose 'COGS' as the base.",
  },
  {
    keywords: ["ap", "payable", "payables", "dpo", "days payable"],
    question: "How do I project Accounts Payable?",
    answer:
      "Use DPO (Days Payable Outstanding): project AP using Days on COGS. Formula: (AP / COGS) × 365. Select 'Days' and choose 'COGS' as the base.",
  },
  {
    keywords: ["prepaid", "prepaids"],
    question: "How do I project Prepaids?",
    answer:
      "Prepaids are typically projected as % of Revenue. Select '% of Total Revenue' and enter the percentage based on historical levels or peer benchmarks.",
  },
  {
    keywords: ["accrued", "accrued expenses"],
    question: "How do I project Accrued expenses?",
    answer:
      "Accrued expenses are usually projected as % of Revenue. Select '% of Total Revenue' and use historic percentages or industry norms.",
  },
  {
    keywords: ["deferred", "unearned", "deferred revenue"],
    question: "How do I project Deferred revenue?",
    answer:
      "Deferred (unearned) revenue is typically projected as % of Revenue. Select '% of Total Revenue' and base the percentage on historical or management guidance.",
  },
  {
    keywords: ["other current", "other ca", "other cl", "other current assets", "other current liabilities"],
    question: "How do I project Other current assets/liabilities?",
    answer:
      "Other CA and Other CL are usually projected as % of Revenue. Select '% of Total Revenue' and use historical ratios or keep flat if immaterial.",
  },
  {
    keywords: ["days", "revenue", "cogs", "base"],
    question: "When should I use Revenue vs COGS for days?",
    answer:
      "Use Revenue for receivables (DSO). Use COGS for inventory (DIO) and payables (DPO), since both tie to the cost of goods sold. The 'Days on' selector in the card lets you choose Revenue or COGS.",
  },
  {
    keywords: ["working capital", "wc", "what is"],
    question: "What is working capital?",
    answer:
      "Working capital is current assets minus current liabilities (excluding cash and short-term debt). In the model we project operating WC items (AR, inventory, AP, etc.) to drive the change in WC that flows into Cash Flow from Operations.",
  },
  {
    keywords: ["ib", "standard", "best practice", "recommend"],
    question: "What are standard IB forecast methods for WC?",
    answer:
      "AR → DSO (Days on Revenue). Inventory → DIO (Days on COGS). AP → DPO (Days on COGS). Prepaids, accrued expenses, deferred revenue, and other CA/CL → % of Revenue. Use the table above and 'Apply to your items' for a one-click setup.",
  },
];

const NO_MATCH_ANSWER =
  "We don't have a specific answer for that in our guidance. Try asking about DSO, DIO, DPO, how to project AR/inventory/AP, or % of Revenue for other WC items. Later this can be answered via an AI API (e.g. ChatGPT) for richer answers.";

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Match user message to best FAQ entry by keyword overlap. Returns answer or null. */
function matchFaq(userMessage: string): string | null {
  const normalized = normalize(userMessage);
  if (normalized.length < 2) return null;
  const words = new Set(normalized.split(" ").filter((w) => w.length > 1));
  let best = { score: 0, answer: "" };
  for (const faq of WC_FAQ) {
    let score = 0;
    for (const kw of faq.keywords) {
      if (words.has(kw) || normalized.includes(kw)) score += 1;
    }
    if (score > best.score) best = { score, answer: faq.answer };
  }
  return best.score > 0 ? best.answer : null;
}

/**
 * Get a reply for the guidance chat. Single entry point so we can swap implementation.
 *
 * Current: uses curated FAQ (keyword match).
 * Later: call API (e.g. POST /api/guidance-chat with context + message; backend uses
 * OpenAI/ChatGPT with an IB-focused system prompt). Example:
 *
 *   const res = await fetch("/api/guidance-chat", {
 *     method: "POST",
 *     headers: { "Content-Type": "application/json" },
 *     body: JSON.stringify({ context, message: userMessage, history: previousMessages }),
 *   });
 *   const data = await res.json();
 *   return data.reply ?? data.text;
 */
export async function getGuidanceReply(
  context: GuidanceChatContext,
  userMessage: string
): Promise<string> {
  const trimmed = (userMessage ?? "").trim();
  if (!trimmed) return "";

  // --- Option: use API when available (e.g. OpenAI via your ChatGPT/Pro subscription key) ---
  // if (process.env.NEXT_PUBLIC_USE_GUIDANCE_API === "true") {
  //   try {
  //     const res = await fetch("/api/guidance-chat", {
  //       method: "POST",
  //       headers: { "Content-Type": "application/json" },
  //       body: JSON.stringify({ context, message: trimmed }),
  //     });
  //     if (res.ok) {
  //       const data = await res.json();
  //       return data.reply ?? data.text ?? "";
  //     }
  //   } catch (_) { /* fallback to FAQ */ }
  // }

  const faqAnswer = matchFaq(trimmed);
  return faqAnswer ?? NO_MATCH_ANSWER;
}
