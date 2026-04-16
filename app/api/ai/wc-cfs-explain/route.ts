import { NextResponse } from "next/server";

/**
 * Plain-English explanation of working-capital lines on the indirect cash flow statement.
 * Numbers are never invented by the model; optional client-supplied balances are echoed only for context.
 */

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const lineLabel = typeof body.lineLabel === "string" ? body.lineLabel.trim() : "";
    const side = body.side === "asset" || body.side === "liability" ? body.side : undefined;
    const priorBalance = typeof body.priorBalance === "number" ? body.priorBalance : undefined;
    const currentBalance = typeof body.currentBalance === "number" ? body.currentBalance : undefined;
    const cashEffect = typeof body.cashEffect === "number" ? body.cashEffect : undefined;

    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.AI_MODEL || "gpt-4o-mini";

    const staticFallback =
      "On the indirect cash flow, each WC line is the cash impact of the change in that balance sheet account year over year: " +
      "for operating assets (e.g. receivables), an increase ties up cash so the CFO line is typically the negative of the balance change; " +
      "for operating liabilities (e.g. payables), an increase is a short-term source of cash so the line is typically the positive of the balance change. " +
      "The model computes those changes from your forecasted balances; totals should reconcile to the aggregate change in net working capital.";

    if (!apiKey) {
      return NextResponse.json({ explanation: staticFallback });
    }

    const numericBlock =
      lineLabel && side && priorBalance != null && currentBalance != null && cashEffect != null
        ? `\nEXAMPLE CONTEXT (already computed by the app — do not recalculate or change these numbers): line="${lineLabel}", side=${side}, prior=${priorBalance}, current=${currentBalance}, cashEffect=${cashEffect}.\n`
        : "";

    const prompt =
      "You are an investment banking modeling coach. In at most 3 short sentences, explain how working capital line items flow into the indirect cash flow statement " +
      "(balance change vs cash effect; assets vs liabilities). Do not perform arithmetic or contradict standard CFO sign conventions. " +
      "Do not invent company-specific facts.\n" +
      numericBlock +
      "Respond with plain text only, no JSON, no markdown fences.";

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 220,
      }),
    });

    if (!res.ok) {
      return NextResponse.json({ explanation: staticFallback });
    }

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) {
      return NextResponse.json({ explanation: staticFallback });
    }

    return NextResponse.json({ explanation: text });
  } catch (e) {
    console.error("[wc-cfs-explain]", e);
    return NextResponse.json(
      {
        explanation:
          "Working capital lines on the indirect CFS reflect year-over-year changes in operating balance sheet accounts, with sign by asset vs liability. The application computes the numbers; verify drivers in Forecast Drivers if a line looks off.",
      },
      { status: 200 }
    );
  }
}
