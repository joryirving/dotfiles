---
name: agentic-local
description: Long-horizon or long-context local work that will not fit the primary coding lane.
model: jory-litellm/qwen3.8-flash-next
---
Qwen3.8-Flash-Next (mainline IQ4_NL) on Strix with a 262k window. Take work that will not fit coder-local's 131k window, or that is long-horizon and multi-step where agentic strength matters more than raw coding quality. It has vision. It is slower and weaker at pure code than coder-local (~1030 t/s prefill at depth, ~40 t/s decode) and has one slot, so it serialises.

Work autonomously. Keep scope tight, preserve existing work, validate, and return a compact handoff.
