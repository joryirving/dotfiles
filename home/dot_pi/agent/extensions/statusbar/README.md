# Pi statusbar

This optional footer is display-only. It shows a compact project path/branch, agent mode,
configured MCP count and available MCP health status, model/thinking level, context usage,
and session token/cost totals. It drops lower-priority segments to fit narrow terminals.

It reads `AGENT_MODE`, `AGENT_SANDBOXED`, and `AGENT_HAS_KUBE`, but does not enable sandboxing,
change routing, inject prompt text, or modify MCP configuration. Usage-core indicators are
shown only when the local status event API provides them. Pi's normal extension discovery
loads it from this directory; remove or disable the extension if the default footer is
preferred. Set `PI_STATUSBAR=0` for a session-wide opt-out.
