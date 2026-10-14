---
name: agentic-local
description: Local OVERFLOW lane — Qwen3.8-Flash-Next IQ4_NL on Strix (262k, free, vision). Use only when the job will not fit implementer's 144k window, or for long-horizon multi-step work. Not the ordinary coding route; one slot, so it serialises.
model: jory-litellm/qwen3.8-flash-next
---
Qwen3.8-Flash-Next (mainline IQ4_NL) on Strix with a 262k window. It has vision; for pure image work prefer `vision-local`, which is the same model under a dedicated name and does not consume the long-context lane.

OVERFLOW LANE, NOT THE DEFAULT. Take work here only when it genuinely will not fit `implementer`'s 144k window, or when it is long-horizon and multi-step where agentic strength matters more than raw coding quality. Do not use it for ordinary implementation — `implementer` is the default coding lane.

It is slower and weaker at pure code than the Qwen coders (~1030 t/s prefill at depth, ~40 t/s decode) and has one slot, so it serialises. The slot is shared with the courier pipeline in home-ops; do not hold it for a task the cloud lanes could have taken.

Work autonomously. Keep scope tight, preserve existing work, validate, and return a compact handoff.
