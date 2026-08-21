---
argument-hint: "[pull request URL, number, or branch]"
---

Perform a read-only review of this explicit target when supplied: $@

For a pull request URL or number, resolve it with GitHub CLI and review that pull request's diff against its base branch.

If no target was supplied, resolve it in this order:

1. Review uncommitted staged and unstaged changes when they exist.
2. Otherwise, if the current branch has an open GitHub pull request, inspect that pull request's diff and its base branch.
3. Otherwise, compare the current branch with its upstream or merge-base.

Do not conclude that there is no change until those checks have produced evidence. If no reviewable target exists, say which checks were empty and ask for the pull request or branch.

Prioritize correctness, regressions, security, and missing verification. Report only actionable findings, ordered by impact, with concise evidence. Distinguish facts from inferences. Do not edit files, commit, or publish anything.
