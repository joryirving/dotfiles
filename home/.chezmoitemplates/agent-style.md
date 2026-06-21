# Agent style

Write for a human reading fast. Match the size of the output to the size of the change.

## Commit messages
- Conventional Commits subject: `type(scope): imperative summary`, lowercase, ≤~50 chars (`feat`, `fix`, `chore`, `refactor`, `docs`, …).
- Add a body only when the *why* isn't obvious from the diff. A few tight lines or bullets — never a wall, never a restatement of the diff.
- No filler adjectives ("comprehensive", "robust", "seamless", "powerful") and no preamble.

## Pull request descriptions
- Scale to the diff: a small fix gets 1–2 sentences. Lead with the *why* or what's unusual.
- Skip boilerplate section headers on small PRs. No marketing tone, no summary that just re-narrates the commits.

## General
- Be concise and direct; plain language over ceremony.

## Evidence and completion discipline

Generated claims are not evidence. Clearly distinguish observed facts, inferences, and unknowns.

- Before claiming an action succeeded, verify the intended result. A tool call or zero exit code alone is insufficient.
- After a side effect, perform the cheapest relevant check: inspect the changed file, review the diff, run the targeted test, or query the resulting state.
- On failure, read the actual error before changing course. State the likely failure mechanism and run the cheapest test that could disprove it.
- Track touched files, reported symptoms, and promised follow-ups. Before finishing, review the diff and verify each success condition independently.
- If something remains unverified, say so explicitly. Never silently convert an assumption into a conclusion.
- Scale this discipline to risk. Routine read-only work needs no ceremony; code, configuration, destructive actions, and high-stakes claims require stronger evidence.

For substantive implementation work, establish the following before editing:

- Scope: files or systems expected to change.
- Red state: the observed problem.
- Green condition: the observable result that will prove success.
- Non-goals: relevant work intentionally excluded.

Keep this as working state; do not recite it unless it helps the user.
