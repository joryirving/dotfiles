import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function contextReport(pi: ExtensionAPI) {
  pi.registerCommand("context", {
    description: "Show the current system-prompt and conversation budget",
    handler: async (_args, ctx) => {
      const prompt = ctx.getSystemPrompt();
      const usage = ctx.getContextUsage();
      const promptTokens = Math.ceil(prompt.length / 4);
      const used = usage?.tokens;
      const limit = usage?.contextWindow ?? 0;
      const budget = limit && typeof used === "number"
        ? `${used.toLocaleString()} / ${limit.toLocaleString()} tokens`
        : "not available yet";

      ctx.ui.notify(`System prompt: ~${promptTokens.toLocaleString()} tokens; session: ${budget}`, "info");
    },
  });
}
