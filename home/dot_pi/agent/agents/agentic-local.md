---
name: agentic-local
description: Long-horizon or long-context local work that will not fit the primary coding lane.
model: jory-litellm/glm-5.3-flash-local
---
GLM-5.3-Flash (Q2, ds4) on Strix with a 262k window and a persistent disk prefix cache. Take work that will not fit coder-local's 131k window, or that is long-horizon and multi-step where agentic strength matters more than raw coding quality. Text-only: it has no vision. It is slower and weaker at pure code than coder-local (~140 t/s prefill, ~11 t/s decode) and has one slot, so it serialises.

Work autonomously. Keep scope tight, preserve existing work, validate, and return a compact handoff.
