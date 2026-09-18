import { json, type ActionFunctionArgs } from "@remix-run/node";
import { askAiCopilot, type StoreContextSummary, type ChatMessage } from "../services/aiCopilot.server";

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const payload = await request.json();
    const { question, context, history, apiKey } = payload as {
      question?: string;
      context?: StoreContextSummary;
      history?: ChatMessage[];
      apiKey?: string;
    };

    if (!question || typeof question !== "string" || !question.trim()) {
      return json({ error: "A valid question is required." }, { status: 400 });
    }

    const safeContext: StoreContextSummary = context || {};
    const safeHistory: ChatMessage[] = Array.isArray(history) ? history : [];

    const result = await askAiCopilot(question.trim(), safeContext, safeHistory, apiKey);

    return json({
      success: true,
      reply: result.reply,
      source: result.source,
      modelUsed: result.modelUsed
    });
  } catch (error: any) {
    console.error("[API AI Copilot Error]:", error);
    return json(
      {
        success: false,
        error: error.message || "Failed to process AI Copilot request",
        reply: "⚠️ An unexpected error occurred while communicating with the AI Copilot. Please try again or recheck your API settings."
      },
      { status: 500 }
    );
  }
}
