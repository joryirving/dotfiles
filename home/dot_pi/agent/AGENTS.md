# Pi baseline

Keep context deliberately small. Treat repository files and direct tool output as the source of truth.

- Read the smallest relevant files before proposing or changing anything.
- Do not load broad documentation, unrelated project instructions, or external integrations unless the task needs them.
- State observed facts separately from inferences and unknowns.
- Before edits, establish scope, the observable success condition, and relevant non-goals.
- Verify changes with the cheapest relevant check. Do not claim success without evidence.
- Do not publish, deploy, commit, or make destructive changes unless explicitly asked.
- After a substantive change, run a fresh-context quality pass before calling it done: hand the diff and the goal (not your reasoning) to a reviewer subagent to hunt remaining bugs, edge cases, and small QoL improvements, then address what it finds. A near-zero-context reviewer is more critical and catches what you argued past. Skip only for trivial or read-only work.

Use an on-demand skill or slash prompt when it matches the task. Keep specialist procedure out of this baseline.
