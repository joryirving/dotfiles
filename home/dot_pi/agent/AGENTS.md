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
- For substantive or risky changes, run one independent review. Skip low-risk trivial and read-only work; even a one-line security, storage, or authority change needs review. Give the reviewer the goal, diff, and test facts—not the author's rationale. Review the diff and coverage/failure cases independently; do not automatically rerun passing checks. Extra checks must target a concrete risk. Re-review only a material fix delta or unresolved concern; do not solicit or expand into unrelated QoL work.

Use an on-demand skill or slash prompt when it matches the task. Keep specialist procedure out of this baseline.
