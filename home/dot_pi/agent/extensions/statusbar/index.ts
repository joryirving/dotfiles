/**
 * Optional, display-only Pi footer for low-context observability.
 *
 * It reads existing session/model/status APIs and environment/config files. It
 * does not alter prompts, tools, model routing, MCP configuration, or state.
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { relative, sep, join } from "node:path";

type AgentMode = "host" | "sandbox" | "sandbox+k8s";
type McpState = "healthy" | "degraded" | "down" | "connecting" | "none";

interface Segment {
	text: string;
	priority: number;
}

interface McpHealth {
	connected: number;
	total: number;
	state: McpState;
}

interface UsageWindow {
	label: string;
	usedPercent: number;
}

function formatTokens(count: number): string {
	if (count < 1_000) return `${count}`;
	if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
	return `${(count / 1_000_000).toFixed(1)}M`;
}

function stripAnsi(value: string): string {
	return value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

function formatProjectPath(cwd: string): string {
	const home = homedir();
	const gitRoot = join(home, "git");
	const gitRelative = relative(gitRoot, cwd);
	if (gitRelative === "") return "~/git";
	if (gitRelative !== ".." && !gitRelative.startsWith(`..${sep}`)) return gitRelative.split(sep).join("/");
	const homeRelative = relative(home, cwd);
	if (homeRelative === "") return "~";
	if (homeRelative !== ".." && !homeRelative.startsWith(`..${sep}`)) return `~/${homeRelative.split(sep).join("/")}`;
	return cwd;
}

function resolveAgentMode(): AgentMode {
	if (process.env.AGENT_MODE === "kube") return "sandbox+k8s";
	if (process.env.AGENT_MODE === "sandbox") return "sandbox";
	if (process.env.AGENT_MODE === "host") return "host";
	if (process.env.AGENT_SANDBOXED === "1") return process.env.AGENT_HAS_KUBE === "1" ? "sandbox+k8s" : "sandbox";
	return "host";
}

function configuredMcpServerCount(cwd: string): number {
	const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
	const paths = [
		join(homedir(), ".config", "mcp", "mcp.json"),
		join(agentDir, "mcp.json"),
		join(cwd, ".mcp.json"),
		join(cwd, ".pi", "mcp.json"),
	];
	const names = new Set<string>();
	for (const filePath of paths) {
		if (!existsSync(filePath)) continue;
		try {
			const parsed = JSON.parse(readFileSync(filePath, "utf8")) as { mcpServers?: Record<string, unknown> };
			for (const name of Object.keys(parsed.mcpServers ?? {})) names.add(name);
		} catch {
			// A bad config should not take the footer down.
		}
	}
	return names.size;
}

function parseMcpHealth(status: string | undefined, configuredTotal: number): McpHealth {
	if (status) {
		const plain = stripAnsi(status);
		if (/connecting/i.test(plain)) return { connected: 0, total: configuredTotal, state: "connecting" };
		const match = plain.match(/MCP:\s*(\d+)\s*\/\s*(\d+)\s*servers?/i);
		if (match) {
			const connected = Number.parseInt(match[1] ?? "0", 10);
			const total = Number.parseInt(match[2] ?? "0", 10);
			if (total === 0) return { connected: 0, total: 0, state: "none" };
			if (connected >= total) return { connected, total, state: "healthy" };
			if (connected > 0) return { connected, total, state: "degraded" };
			return { connected: 0, total, state: "down" };
		}
	}
	return configuredTotal === 0
		? { connected: 0, total: 0, state: "none" }
		: { connected: 0, total: configuredTotal, state: "connecting" };
}

function themed(theme: Theme, color: ThemeColor, text: string, icon?: string): string {
	return theme.fg(color, icon ? `${icon} ${text}` : text);
}

function fitSegments(segments: Segment[], width: number, separatorWidth: number): Segment[] {
	const fitted = [...segments];
	const totalWidth = () => fitted.reduce((sum, segment) => sum + visibleWidth(segment.text), 0) + Math.max(0, fitted.length - 1) * separatorWidth;
	while (fitted.length > 1 && totalWidth() > width) {
		let dropIndex = 0;
		for (let index = 1; index < fitted.length; index++) {
			if (fitted[index]!.priority > fitted[dropIndex]!.priority) dropIndex = index;
		}
		fitted.splice(dropIndex, 1);
	}
	return fitted;
}

export default function statusbar(pi: ExtensionAPI): void {
	if (process.env.PI_STATUSBAR === "0") return;
	let usageWindows: UsageWindow[] = [];
	let requestRender: (() => void) | undefined;

	const updateUsage = (payload: unknown): void => {
		const state = (payload as { state?: { provider?: string; usage?: { windows: UsageWindow[] } } } | undefined)?.state;
		usageWindows = state?.provider ? (state.usage?.windows ?? []) : [];
		requestRender?.();
	};

	// Usage-core is optional. The footer remains useful when these channels do not exist.
	pi.events.on("usage-core:ready", updateUsage);
	pi.events.on("usage-core:update-current", updateUsage);

	pi.on("session_start", async (_event, ctx) => {
		const project = formatProjectPath(ctx.cwd);
		const mode = resolveAgentMode();
		const mcpTotal = configuredMcpServerCount(ctx.cwd);

		ctx.ui.setFooter((tui, theme, footerData) => {
			requestRender = () => tui.requestRender();
			const unsubscribeBranch = footerData.onBranchChange(requestRender);

			return {
				dispose(): void {
					unsubscribeBranch();
					requestRender = undefined;
				},
				invalidate(): void {},
				render(width: number): string[] {
					let input = 0;
					let output = 0;
					let cost = 0;
					for (const entry of ctx.sessionManager.getBranch()) {
						if (entry.type !== "message" || entry.message.role !== "assistant") continue;
						const message = entry.message as AssistantMessage;
						input += message.usage.input;
						output += message.usage.output;
						cost += message.usage.cost.total;
					}

					const separator = theme.fg("dim", " │ ");
					const separatorWidth = visibleWidth(separator);
					const statuses = footerData.getExtensionStatuses();
					const mcp = parseMcpHealth(statuses.get("mcp"), mcpTotal);
					const branch = footerData.getGitBranch();
					const context = ctx.getContextUsage();
					const contextPercent = context?.contextWindow && context.tokens != null
						? Math.round((context.tokens / context.contextWindow) * 100)
						: undefined;
					const modeColor: ThemeColor = mode === "host" ? "success" : mode === "sandbox+k8s" ? "accent" : "warning";
					const mcpColor: ThemeColor = mcp.state === "healthy" ? "success" : mcp.state === "down" ? "error" : mcp.state === "none" ? "dim" : "warning";
					const left: Segment[] = [
						{ text: themed(theme, "accent", project, "◆"), priority: 0 },
						{ text: themed(theme, modeColor, mode, "◈"), priority: 0 },
						{ text: themed(theme, mcpColor, `MCP ${mcp.connected}/${mcp.total}`, mcp.state === "none" ? "○" : "●"), priority: 0 },
					];
					if (branch) left.push({ text: themed(theme, "muted", branch, "⎇"), priority: 5 });
					for (const [id, value] of statuses) if (id !== "mcp") left.push({ text: value, priority: 8 });

					const right: Segment[] = [];
					if (input > 0 || output > 0) right.push({ text: themed(theme, "dim", `↑${formatTokens(input)} ↓${formatTokens(output)}${cost > 0 ? ` $${cost.toFixed(2)}` : ""}`), priority: 3 });
					if (contextPercent !== undefined) {
						const color: ThemeColor = contextPercent > 80 ? "error" : contextPercent > 60 ? "warning" : "muted";
						right.push({ text: themed(theme, color, `ctx ${contextPercent}%`), priority: 2 });
					}
					if (ctx.model) {
						const thinking = ctx.model.reasoning ? ` · ${pi.getThinkingLevel()}` : "";
						right.push({ text: themed(theme, "dim", `${ctx.model.provider}/${ctx.model.id}${thinking}`), priority: 1 });
					}
					for (const window of usageWindows.slice(0, 2)) {
						const percent = Math.round(window.usedPercent);
						const color: ThemeColor = percent > 80 ? "error" : percent > 60 ? "warning" : "muted";
						right.push({ text: themed(theme, color, `${window.label} ${percent}%`), priority: 7 });
					}

					const fitted = fitSegments([...left, ...right], Math.max(1, width), separatorWidth);
					const leftSet = new Set(left.map((segment) => segment.text));
					const leftText = fitted.filter((segment) => leftSet.has(segment.text)).map((segment) => segment.text).join(separator);
					const rightText = fitted.filter((segment) => !leftSet.has(segment.text)).map((segment) => segment.text).join(separator);
					const padding = Math.max(1, width - visibleWidth(leftText) - visibleWidth(rightText));
					return [truncateToWidth(`${leftText}${" ".repeat(padding)}${rightText}`, width, "…")];
				},
			};
		});
	});

	pi.on("model_select", async (_event, ctx) => {
		if (ctx.hasUI) requestRender?.();
	});
	pi.on("thinking_level_select", async (_event, ctx) => {
		if (ctx.hasUI) requestRender?.();
	});
	pi.on("session_shutdown", async (_event, ctx) => {
		if (ctx.hasUI) ctx.ui.setFooter(undefined);
		requestRender = undefined;
	});
}
