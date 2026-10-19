---
name: dotfiles-review
description: Review this chezmoi-managed dotfiles repository, especially template and target semantics, bootstrap behavior, and AI-tool configuration safety.
---

# Dotfiles review

Use this skill when a change touches `home/`, `.chezmoi*`, `bootstrap.sh`, shell setup, or configuration for OpenCode, Zed, Pi, Codex, or other developer agents. Review the behavior the target machine will receive, not just the source diff.

## Understand the source layout first

- `.chezmoiroot` selects `home/` as the chezmoi source root. Paths under `home/` become files in the user's home directory; they are not literal repository-relative destination paths.
- Interpret chezmoi source names correctly: `dot_` represents a leading dot, `.tmpl` means Go-template rendering, and prefixes such as `private_` and `executable_` affect target metadata.
- Treat `.chezmoi.yaml.tmpl`, `.chezmoiignore`, and `.chezmoiexternal.toml` as behavior-bearing configuration. Trace the data and host/platform conditions that determine which files are rendered or ignored.
- Chezmoi script naming is easy to get wrong: `remove_` is a target type, not a script attribute. Lifecycle scripts need a valid `run_` name and the appropriate `before_` or `after_` attribute. When script classification matters, inspect `chezmoi dump`; `chezmoi apply --dry-run` does not execute scripts and cannot prove their effects.

## Review rendered behavior

1. Trace changed templates through their data sources and conditionals. Consider the relevant combinations of macOS/Linux, personal/non-personal, and optional applications where those conditions affect the change.
2. Validate the rendered output, not only the template text. For applicable files, parse rendered JSON/JSONC, YAML, TOML, or shell syntax. A template can be syntactically valid while rendering invalid configuration for one branch.
3. For lifecycle scripts and bootstrap changes, inspect quoting, error handling, idempotency, platform-specific package managers, and destructive effects. Review remote installer downloads as supply-chain decisions. Prefer fixture-based or isolated validation; do not apply a review change to a live home directory.
4. If a local tool is unavailable, state the validation limitation. Never treat a clean dry-run as evidence that a script actually ran.

## AI-tool and model configuration

Changes to agent configuration can change tool, filesystem, network, and credential authority. Inspect the effective behavior, not only descriptive comments.

- For OpenCode, Zed, Pi, and Codex configuration, check agent roles, model/provider routes, protocol/API-format compatibility, context limits, tool permissions, MCP servers, and environment-variable references. Preserve intentional distinctions between local and cloud lanes.
- For model aliases or provider changes, search all relevant consumers and shared templates under `home/.chezmoitemplates/shared/`; keep model names, API formats, and limits consistent across the configurations that intentionally share them.
- Do not introduce inline credentials or expand access to secrets without a concrete requirement. Check whether a change exposes a tool or endpoint to a broader trust boundary.
- For changes to `bootstrap.sh`, consider fresh-machine behavior, reruns, missing commands, supported operating systems, and the effect of each installer or network command.

## Upstream plugin and dependency pins

When an npm plugin pin changes (for example, an `@scope/name@<version>` in an agent config), follow `.github/ai-review-rules.md` as the canonical mandatory upstream scan policy. Review the upstream release notes or changelog and, where feasible, the shipped code. Report the package/version and evidence inspected. If upstream material cannot be fetched, say that explicitly instead of implying the dependency was audited. Do not duplicate or weaken the file's specific blocker and benign-pattern rules.

## Findings and verification

- Findings must identify the affected path/line, a concrete input or configuration state, and the resulting incorrect or unsafe behavior. Separate verified facts from inferences.
- For pin changes, inspect the upstream delta rather than treating a one-line hash/version edit as low risk.
- Reuse relevant passing evidence while the source and environment are unchanged. Run focused checks for the changed behavior; avoid broad, unrelated validation.
- A clean review should state which material risks were checked and what remains unverified. Do not invent concerns to make the review look thorough.
