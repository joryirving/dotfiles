# Pi workflows

This is an opt-in workflow layer for the local Pi setup. Definitions are discovered from
`~/.pi/agent/workflows/*.json`; normal prompts do not enter a workflow.

Commands:

- `/workflow list`
- `/workflow show NAME`
- `/workflow start NAME [short task context]`
- `/workflow status [RUN_ID]`
- `/workflow pause RUN_ID`
- `/workflow resume RUN_ID`
- `/workflow quit RUN_ID`

The same actions are available to the `workflow` tool. Keep tool calls narrow: use `list`,
`show`, and `status` before starting a run.

## `deliver-ticket`

Start it explicitly with `/workflow start deliver-ticket TICKET_ID TASK_TEXT`. The first token
is a conservative ticket id (`A-Z`, numbers, `.`, `_`, `/`, and `-`); everything after it is
task context. Task text is passed to the planner/fixer/reviewer as text only. It is never a
command, check name, branch fragment, or shell expression. Normal prompts never enter this
profile.

The profile runs this bounded path:

1. deterministic preflight checks the repository root, current branch, exact base SHA, clean
   status, Git worktree registration, `git`, `gh auth status`, and current GitHub repository
   access;
2. an `oracle` plan runs read-only in the base checkout;
3. an interactive approval is required before a per-run branch/worktree is created and the
   `fixer` receives mutation access;
4. the fixer, trusted checks, and `reviewer` run in the isolated worktree, with one bounded
   repair round and a non-decreasing blocking-finding guard;
5. a second approval is required before `gh pr create`, then fixed-argv GitHub stages record
   the PR and observe required checks at the exact head SHA;
6. the run stops at a fresh merge approval boundary. It never calls `gh pr merge`; approving
   the boundary records intent and leaves the PR open. There is no automatic merge path, and
   RPC/no-UI mode cannot merge.

Delivery worktrees and ledgers live below
`$PI_WORKFLOW_STATE_DIR/runs/RUN_ID/` (default `~/.agents/local/pi/workflows/runs/RUN_ID/`).
The ledger records ticket/task id, status, base root/branch/SHA, worktree path/branch, head
SHA, PR facts, required-check evidence, review rounds, repair count, child-agent usage/cost,
limits, approvals, and a compact event history. PR body and selected stage artifacts are kept
beside the ledger. All state and generated body files use the existing atomic write helper.

The base checkout must already be clean and at its repository root. Delivery refuses detached
HEADs, dirty files, changed base branches/SHA on resume, unsafe worktree paths, and branch or PR
identifiers that fail validation. It never stashes, resets, deletes user files, or executes
`sh -lc`; Git and GitHub helpers use fixed executable names and argv arrays with `shell: false`.
Resume reconciles the base checkout, delivery worktree, live PR state, and exact head SHA before
restarting unfinished stages. Prior approvals are revoked on resume. The default limits are six
child agents, one repair round, and an optional cost ceiling; a limit stops at a safe stage
boundary and persists `blocked` state.

The profile intentionally does not port drive-spec-delivery's Linear, Forgejo/tea, Woodpecker,
large routing matrix, shadow swarms, sandbox runtime, or automatic merge behavior. GitHub CLI
authentication and repository access are prerequisites when opening a PR; no live PR/CI/merge
operation is implied by loading or listing the definition.

Definitions are portable and Chezmoi-managed in `~/.pi/agent/workflows/`. Run state is kept
machine-local in `~/.agents/local/pi/workflows/runs/RUN_ID/state.json`; selected stage outputs
are saved under that run's `artifacts/` directory. State writes use a same-directory
temporary file, `fsync`, and rename so an interrupted write does not replace the last good
state. Handoffs are explicit per stage and capped before they are passed to another stage;
full outputs are only kept when a stage declares an artifact.

Delegation uses the existing named user agents and subagent child launcher. Parallel stages
are capped at four children. `mutation: true` stages require interactive approval, and an
explicit `approval` stage can pre-approve named mutation stages. Check stages use only a
source-controlled `check` name resolved by the extension's trusted registry; they do not
accept command arrays, shell strings, `{input}`, or other template expansion. The initial
registry contains `git-diff-check` (`git diff --check`). Add a new fixed argv entry to that
registry before using another check. Repair loops must declare `maxAttempts` and are limited
to three by the extension.

Resuming skips only passed non-approval stages and starts at the first unfinished, failed, or
approval stage. Prior approvals are revoked before execution continues, so approval stages
and mutation gates always require fresh confirmation after resume. The subagent launcher uses
Pi's `message_end` JSON events and stderr; it does not depend on an unsupported
`tool_result_end` event.

To add a workflow, copy a compact JSON definition into this directory with a matching
`name`, `description`, and `stages`. Supported stages are `delegate` (single or bounded
parallel), `check`, `approval`, `repair-loop`, `delivery-preflight`, `delivery-worktree`,
`github-pr-create`, and `github-pr-checks`. The delivery/GitHub stages are reserved for the
`deliver-ticket` profile and use fixed helper argv; they are not free-form command stages.
Delegation task strings support
`{input}`, `{handoff}`, and `{attempt}`. Set `handoffFrom` to name exactly which prior stage
outputs enter a task. Set `artifact` only for outputs worth keeping. Changes to workflow
definitions do not change the model catalog, MCP templates, or baseline context injection.
The runner has no sandbox: use a disposable worktree or container for autonomous mutation.

The `debug-until-green` input is diagnosis context only. Its check is the fixed trusted
`git-diff-check`; free-form input is never executed.

## Chezmoi ownership

The repository's `.chezmoiroot` is `home`, so these source paths are the source of truth:

- `home/dot_local/bin/executable_pi-child` -> `~/.local/bin/pi-child`
- `home/dot_local/bin/executable_pi-lean` -> `~/.local/bin/pi-lean`
- `home/dot_pi/agent/mcp.json.tmpl` -> `~/.pi/agent/mcp.json`
- `home/dot_pi/agent/models.json.tmpl` -> `~/.pi/agent/models.json`
- `home/dot_pi/agent/extensions`, `agents`, `prompts`, `workflows`, and `settings.json` -> matching `~/.pi/agent` paths

`chezmoi apply` reconciles managed destinations from this source. If a destination was
edited locally, default Chezmoi behavior prompts before overwriting it; `chezmoi apply
--force` makes the source win without that prompt. Use `chezmoi apply --dry-run --verbose`
to inspect the change first. `home/.chezmoiignore` excludes `~/.pi/agent/auth.json` and
`~/.pi/agent/models-store.json`; `chezmoi ignored` reports both, so apply does not overwrite
those machine-local runtime files.

The ToolHive endpoint is shared with the managed OpenCode and Zed configurations. A safe
unauthenticated GET to `https://mcp.jory.dev/mcp` returned HTTP 401 during validation, so
all three clients use the same 1Password-backed `x-api-key`; the secret is not stored in
this repository. OpenCode 1.18.18 reported `toolhive` as needing authentication, and Zed's
active log reported that it required OAuth, before their headers were added. OpenCode's
remote-server schema and Zed's `context_servers` schema both accept a `headers` map; Zed
uses those values verbatim, so Chezmoi renders the key rather than relying on env expansion.
Pi's template uses `lifecycle: lazy`, matching the installed `pi-mcp-adapter` 2.27.0 schema
(`keep-alive`, `lazy`, `lazy-keep-alive`, or `eager`); the redacted rendered config loaded
successfully through Pi 0.84.2 and that adapter.
