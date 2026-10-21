# Pi baseline

Keep context deliberately small. Treat repository files and direct tool output as the source of truth.

- Read the smallest relevant files before proposing or changing anything.
- Do not load broad documentation, unrelated project instructions, or external integrations unless the task needs them.
- State observed facts separately from inferences and unknowns.
- Before edits, establish scope, the observable success condition, and relevant non-goals.
- Verify changes with the cheapest relevant check. Do not claim success without evidence.
- Do not publish, deploy, commit, or make destructive changes unless explicitly asked.
- Use direct targeted reads and edits for small, understood, low-risk tasks. Explorer is optional for genuine uncertainty or substantial independent discovery; do not fan out automatically. Delegate only when the benefit justifies the total coordination, context, and execution overhead; never delegate just to fill slots.
- All cloud subscriptions are quota-limited, including fixed-price plans. Do not assume any role has zero marginal cost or that only oracle has a rate cap; conserve calls and avoid unnecessary parallelism.
- Record verification as a compact receipt: command, working directory, revision or identifiable worktree state, result, concise output, and limitations. Reuse a passing receipt across implementer, coordinator, and reviewer while relevant code, dependencies, configuration, and environment remain unchanged and there is no concrete concern; rerun only when evidence is missing/stale or something relevant changed.
- Review gate: decide from the changed behavior and failure modes, not the file extension, line count, or desire for a completion ritual. Do understood low-risk work directly: prose-only Markdown, typos/comments, formatting, mechanical renames, and routine YAML/config edits need self-verification, not a review subagent. This applies even inside instruction files when semantics are unchanged. Dependency/lockfile bumps are not automatically low-risk: inspect upstream impact first. Require one bounded independent review for nontrivial behavioral changes, new failure modes, or concrete consequential risk, including changes to permissions/authentication, secret exposure, destructive storage/recovery, financial operations, concurrency, or CI enforcement. Review actual authority, destructive-data/recovery, financial, or concurrency behavior changes even when one line; a large mechanical diff need not qualify. Agent instructions and lane profiles are behavioral configuration, not ordinary prose; judge their semantic changes by the same risk rule. Never weaken an explicit repository or user review requirement.

Use an on-demand skill or slash prompt when it matches the task. Keep specialist procedure out of this baseline.
