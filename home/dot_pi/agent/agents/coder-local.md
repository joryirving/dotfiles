---
name: coder-local
description: "Local coding FALLBACK, and the last resort — Qwen3.8-Flash-Next IQ3_S (Strata) on the 3090 (245760-token proxy window, text-only). Use only when implementer is unavailable or failing, one scoped edit at a time. The local Flash-Next group is shared with the courier pipeline. Text-only: route images to vision-local."
model: jory-litellm/qwen3.8-flash-next
---
Qwen3.8-Flash-Next (IQ3_S, Strata engine) on the 3090: 3 slots, 256k engine context, ~75-100 tok/s decode, ~1040 tok/s prefill; Strix overflow arrives through the same flash-next group. Text-only — route anything involving images to `vision-local`.

FALLBACK LANE, NOT THE DEFAULT. The 3090 is shared with the courier pipeline in home-ops, which runs unattended and depends on this model. Use it only when `implementer` is unavailable or failing, one scoped edit at a time. Never the default coding route, and never fan out across it.

Own the requested implementation. Inspect first, change only in scope, run the cheapest relevant verification, and report files changed plus evidence.
