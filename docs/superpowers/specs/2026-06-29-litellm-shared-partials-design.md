# Design: litellm models in work configs via shared chezmoi partials

**Date:** 2026-06-29
**Status:** Approved (pending spec review)

## Goal

Give the work Zed/opencode configs access to the personal litellm model catalog
**without duplicating** the catalog between the two repos. Achieve a single source
of truth that both the personal config and the work overlay inherit.

### Scope decisions (confirmed)

- **Which models:** everything in the personal litellm catalog **except** the three
  `chatgpt/*` entries. Work already has `openai/gpt-5.5` via Bifrost, so chatgpt via
  litellm is redundant there.
- **MiniMax:** the separate `anthropic`-type / `litellm-anthropic` provider (MiniMax,
  litellm-backed) **is** included in work.
- **Placement:** litellm models are available in the model picker only. They are
  **not** added to any favorites list. Work default stays
  `bifrost/deepseek-v4-flash`; Zed default unchanged.

## Background / why this works

chezmoi merges every file under any `.chezmoitemplates/` directory — anywhere in the
source tree, **including git submodules** — into one global template namespace. The
parent dotfiles repo already calls `includeTemplate "work/opencode.json"` into the
`dotfiles-work` submodule mounted at `home/.chezmoitemplates/work/`. The reverse works
too: a `work/*` template can reference a `shared/*` partial defined in the parent repo.

Verified empirically: a probe partial placed at `home/.chezmoitemplates/_probe_shared`
rendered via `chezmoi execute-template` in the same namespace that holds the `work/*`
templates.

Auth prerequisites already confirmed:
- The `Kubernetes` 1Password vault is reachable on the work laptop (work configs
  already read `op://Kubernetes/context7/...`), so
  `op://Kubernetes/litellm/LITELLM_MASTER_KEY` is available to the work overlay.
- `litellm.jory.dev` is reachable from the work laptop (returns 401 without a key).

## Components

### New shared partials (main repo, `home/.chezmoitemplates/shared/`)

Each partial emits a **comma-joinable** JSON fragment with no leading or trailing
comma; the including template supplies separating commas.

**Key constraint:** the model-list partials emit *list entries only* — not a closed
provider object. This is what lets the personal config append its `chatgpt/*` entries
to the same list. The provider *wrapper* (name, `api_url`/`baseURL`, `options`/key,
and the `available_models: [...]` / `models: {...}` container) is written inline in
each config; only the model entries and the invariant MiniMax provider are shared.

1. **`litellm-zed-models`** — the **array items** for Zed's
   `LiteLLM.available_models` (each `{ "name", "display_name", "max_tokens", ... }`),
   all litellm models **except** the three `chatgpt/*` items. No `api_key` anywhere
   (Zed stores `openai_compatible` keys in the OS keychain; not settable from
   settings.json — the inline wrapper carries only `api_url`).

2. **`litellm-zed-anthropic`** — the complete `"anthropic": { "api_url": ..., "available_models": [ MiniMax ] }`
   block for Zed (sibling of `openai_compatible`). No per-config variance, so it is
   shared whole.

3. **`litellm-opencode-models`** — the litellm provider's `models` map **entries**
   (`"key": { "name", "limit" }`), all **except** the three `chatgpt/*` keys.
   Comma-joinable map entries, no wrapping braces.

4. **`litellm-opencode-anthropic`** — the complete `"litellm-anthropic": { ... }`
   provider object for opencode (authToken via
   `onepasswordRead "op://Kubernetes/litellm/LITELLM_MASTER_KEY"`). No per-config
   variance, so it is shared whole.

The `litellm` provider wrapper for opencode (`"litellm": { "options": { baseURL,
apiKey via onepasswordRead, timeout }, "models": { ... } }`) and the Zed `LiteLLM`
wrapper (`{ "api_url", "available_models": [ ... ] }`) are written inline in each
config. The duplicated part is only ~3-4 lines of `options`/`api_url`; the model
catalog — the part that grows and drifts — is single-source via partials 1 and 3.

### Personal config refactor (behavior-preserving)

The personal branches of `home/dot_config/zed/settings.json.tmpl` and
`home/dot_config/opencode/opencode.json.tmpl` replace their inline litellm blocks with
`{{ template "shared/..." . }}` calls, then append the personal-only `chatgpt/*`
entries:

- **Zed:** the `LiteLLM` wrapper's `available_models` array becomes
  `[ {{ template "shared/litellm-zed-models" . }}, <3 chatgpt array items> ]`; the
  `anthropic` block becomes `{{ template "shared/litellm-zed-anthropic" . }}`.
- **opencode:** the `litellm` provider's `models` map becomes
  `{ {{ template "shared/litellm-opencode-models" . }}, <3 chatgpt map entries> }`; the
  separate `litellm-anthropic` provider becomes `{{ template "shared/litellm-opencode-anthropic" . }}`.

**Net effect on personal:** functionally identical. The only change is that the three
`chatgpt/*` entries move from the middle of the list to the end (picker ordering only).
This was explicitly accepted.

### Work overlay (`dotfiles-work` submodule)

- **`zed.json`:** inside `language_models.openai_compatible`, after the `Bifrost`
  entry, add a `"LiteLLM": { "api_url": ..., "available_models": [ {{ template "shared/litellm-zed-models" . }} ] }`
  wrapper. As a sibling of `openai_compatible`, add
  `, {{ template "shared/litellm-zed-anthropic" . }}`.
- **`opencode.json`:** inside `provider`, after `bifrost`, add a
  `"litellm": { "options": { baseURL, apiKey, timeout }, "models": { {{ template "shared/litellm-opencode-models" . }} } }`
  wrapper, then `, {{ template "shared/litellm-opencode-anthropic" . }}`.
- No favorites changes; `model` stays `bifrost/fireworks/accounts/fireworks/models/deepseek-v4-flash`.
- Work has no `enabled_providers` allowlist, so the new providers are enabled by default.

## Data flow

`chezmoi apply` renders both `settings.json.tmpl` and `opencode.json.tmpl`. On work
machines (`.personal` false) the `else` branch includes `work/zed.json` /
`work/opencode.json`, which in turn include the `shared/litellm-*` partials. The
partials read the litellm master key from the `Kubernetes` vault. Result: work configs
gain the litellm catalog (minus chatgpt) plus MiniMax, sourced from the same partials
the personal config uses.

## Verification

1. **Cross-repo namespace:** already proven via probe.
2. **JSON validity:** `chezmoi cat ~/.config/zed/settings.json | jq .` and the opencode
   equivalent must both parse after the change (catches comma-splice errors).
3. **Personal render unchanged:** capture `chezmoi cat` for both personal files before
   and after the refactor; diff must be empty except for the `chatgpt/*` reordering.
4. **Work render:** the litellm providers/models appear; default model unchanged;
   litellm absent from favorites.

## Rollout

Two repos:
1. **Main dotfiles** — add `shared/litellm-*` partials + refactor personal templates. Commit, push.
2. **dotfiles-work submodule** — edit `zed.json` + `opencode.json`. Commit, push.
3. Bump the submodule pointer in main dotfiles; `chezmoi update`.

One-time, out of band: paste the litellm key into the Zed UI on the work laptop
(Zed `openai_compatible` keychain requirement, same as Bifrost). Not a config change.

## Out of scope

- The `grafana-stackadapt-sdm` SDM/DNS issue (separate, environmental).
- Any change to favorites or default models.
- Zed keychain key entry (manual, one-time, user action).
