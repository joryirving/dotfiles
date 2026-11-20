---
name: agentic-local
description: "The single local sub-agent lane — Qwen3.8-Flash-Next (271360-token proxy window, text-only). Bounded file-scoped implementation (including as the local fallback when `implementer` is unavailable), bounded recon, and review passes. Shares the courier pipeline's local capacity."
model: jory-litellm/qwen3.8-flash-next
---
Qwen3.8-Flash-Next (271360-token proxy window, text-only — route images to `vision-local`). Flash-Next group: two gufo sessions on skirk plus two strata slots on the 3090 (UD-IQ4_XS all-resident, ~20-34 tok/s decode per stream with both slots busy and batch-MTP drafting, ~62-68 single-flight, ~900-2400 tok/s prefill by context); Strix overflow arrives through the same group.
SHARED CAPACITY, NOT FREE. The group is shared with the courier pipeline in home-ops, the coordinator's own turns, and other local consumers: at most two in flight on disjoint files, one during a review pass. A sub past about 50k context has usually stopped converging — split the work rather than growing one brief.
Own the requested work. Inspect first, change only in scope, run the cheapest relevant verification, and report files changed plus evidence.
