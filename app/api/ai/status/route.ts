import { NextResponse } from "next/server";

/**
 * GET /api/ai/status — Check if OpenAI is configured (key loaded).
 * Does not expose the key. Use to confirm .env.local is loaded and API is "connected".
 */
export async function GET() {
  const hasKey = !!process.env.OPENAI_API_KEY;
  const model = process.env.AI_MODEL || "gpt-4o-mini";
  return NextResponse.json({
    openaiConfigured: hasKey,
    model,
    message: hasKey
      ? "OpenAI API key is loaded. CF classify (Suggest AI) will use the API."
      : "OPENAI_API_KEY is missing. Add it to .env.local and restart the dev server.",
  });
}
