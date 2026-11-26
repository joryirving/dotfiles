# Agent instructions

## Source comments

- Prefer clear names and straightforward code over explanatory comments. Omit comments that merely narrate what the code does.
- Keep each inline implementation comment to one concise line by default. Explain the non-obvious why, not the what; do not evade the limit with an overlong line or consecutive one-line comments.
- Use multiple lines only when needed for a complex algorithm, non-obvious invariant, security constraint, compatibility requirement, or external protocol behavior. Preserve public API documentation, required docstrings, license headers, and machine-readable directives.
- Keep issue history, PR review discussions, prior implementation narratives, and agent reasoning out of source comments; put durable explanations in appropriate documentation.
- While editing code, remove redundant comments and shorten verbose comments in the affected area. Preserve meaningful warnings, invariants, and directives; do not expand the diff into unrelated cleanup.
- Before opening or updating a PR, inspect added and modified source comments and remove or shorten unnecessary prose. Review comment quality semantically, not by mechanically counting lines.
