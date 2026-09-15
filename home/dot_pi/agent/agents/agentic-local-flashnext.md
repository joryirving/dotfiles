---
name: agentic-local-flashnext
description: ALTERNATE to agentic-local (Qwen3.8-Flash-Next instead of GLM). Mutually exclusive - skirk runs one or the other, never both.
model: jory-litellm/qwen3.8-flash-next
---
Qwen3.8-Flash-Next (mainline IQ4_NL) on Strix with a 262k window, the alternate to agentic-local, which runs the same role on GLM-5.3-Flash instead. The two are never deployed together: confirm which one is actually live before reaching for this agent. Take work that will not fit coder-local's 131k window, or that is long-horizon and multi-step where agentic strength matters more than raw coding quality. Unlike GLM it has vision. Prefill and decode on the mainline quant are not yet fully characterized in production. One slot, so it serialises.

Work autonomously. Keep scope tight, preserve existing work, validate, and return a compact handoff.
