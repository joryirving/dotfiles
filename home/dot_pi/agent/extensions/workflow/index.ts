/**
 * Small, durable workflow runner for the local Pi setup.
 *
 * Workflow definitions live in ~/.pi/agent/workflows/*.json; run state is
 * machine-local under ~/.agents/local/pi/workflows. The runner is deliberately
 * opt-in: normal prompts are unchanged, and only explicit /workflow commands
 * or calls to the workflow tool start a run.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	getFinalOutput,
	getResultOutput,
	isFailedResult,
	runSingleAgent,
	type DispatchDefaults,
	type SingleResult,
} from "../subagent/index.ts";
import { discoverAgents } from "../subagent/agents.ts";

const MAX_PARALLEL = 4;
const HANDOFF_LIMIT = 6000;
const OUTPUT_LIMIT = 24_000;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

type Status = "running" | "pausing" | "paused" | "waiting-approval" | "completed" | "failed" | "quit";
type StageResultStatus = "passed" | "failed" | "skipped";

interface BaseStage {
	id: string;
	type: string;
	handoff?: boolean;
	handoffFrom?: string[];
	artifact?: string;
	continueOnFailure?: boolean;
	failureIfContains?: string;
}

interface DelegateStage extends BaseStage {
	type: "delegate";
	agent?: string;
	task?: string;
	mode?: "single" | "parallel";
	tasks?: Array<{ agent: string; task: string }>;
	mutation?: boolean;
	parallelLimit?: number;
}

interface CheckStage extends BaseStage {
	type: "check";
	command: string[];
	label?: string;
}

interface ApprovalStage extends BaseStage {
	type: "approval";
	for: string[];
	message: string;
}

interface RepairLoopStage extends BaseStage {
	type: "repair-loop";
	maxAttempts: number;
	if: string[];
	stages: Stage[];
}

type Stage = DelegateStage | CheckStage | ApprovalStage | RepairLoopStage;

interface WorkflowDefinition {
	name: string;
	description: string;
	maxRepairAttempts?: number;
	stages: Stage[];
}

interface StoredStageResult {
	status: StageResultStatus;
	output?: string;
	error?: string;
	attempt?: number;
	updatedAt: string;
}

interface RunState {
	version: 1;
	id: string;
	workflow: string;
	cwd: string;
	input: string;
	status: Status;
	currentStage: string;
	startedAt: string;
	updatedAt: string;
	error?: string;
	artifacts: string[];
	handoffs: Record<string, string>;
	stageResults: Record<string, StoredStageResult>;
	loopAttempts: Record<string, number>;
	approvals: string[];
}

interface Control {
	abort: AbortController;
	pauseRequested: boolean;
	quitRequested: boolean;
}

interface StageOutcome {
	ok: boolean;
	output: string;
	error?: string;
}

class WorkflowControlStop extends Error {
	constructor(readonly kind: "paused" | "quit") {
		super(kind);
	}
}

const activeRuns = new Map<string, Control>();

function now(): string {
	return new Date().toISOString();
}

function workflowsDir(): string {
	return path.join(getAgentDir(), "workflows");
}

function runsDir(): string {
	return path.join(process.env.PI_WORKFLOW_STATE_DIR ?? path.join(os.homedir(), ".agents", "local", "pi", "workflows"), "runs");
}

function runDir(id: string): string {
	if (!RUN_ID.test(id)) throw new Error(`Invalid run id: ${id}`);
	return path.join(runsDir(), id);
}

function statePath(id: string): string {
	return path.join(runDir(id), "state.json");
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
	await fs.promises.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
	const temporary = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
	try {
		const handle = await fs.promises.open(temporary, "w", 0o600);
		try {
			await handle.writeFile(content, "utf8");
			await handle.sync();
		} finally {
			await handle.close();
		}
		await fs.promises.rename(temporary, filePath);
	} finally {
		await fs.promises.rm(temporary, { force: true });
	}
}

async function saveState(state: RunState): Promise<void> {
	state.updatedAt = now();
	await atomicWrite(statePath(state.id), `${JSON.stringify(state, null, 2)}\n`);
}

async function loadState(id: string): Promise<RunState> {
	const parsed = JSON.parse(await fs.promises.readFile(statePath(id), "utf8")) as RunState;
	if (parsed.version !== 1 || parsed.id !== id) throw new Error(`Unsupported workflow state: ${id}`);
	return parsed;
}

function parseJsonFile(filePath: string): unknown {
	return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateStage(value: unknown, where: string): Stage {
	if (!isRecord(value) || typeof value.id !== "string" || typeof value.type !== "string") {
		throw new Error(`${where}: stage needs string id and type`);
	}
	const base = value as BaseStage;
	if (!RUN_ID.test(base.id)) throw new Error(`${where}: invalid stage id ${base.id}`);
	if (base.type === "delegate") {
		const stage = value as unknown as DelegateStage;
		const parallel = stage.mode === "parallel" || Array.isArray(stage.tasks);
		if (parallel && (!stage.tasks?.length || stage.tasks.some((task) => !task.agent || !task.task))) {
			throw new Error(`${where}: parallel delegate needs non-empty tasks`);
		}
		if (!parallel && (!stage.agent || !stage.task)) throw new Error(`${where}: delegate needs agent and task`);
		return stage;
	}
	if (base.type === "check") {
		const stage = value as unknown as CheckStage;
		if (!Array.isArray(stage.command) || stage.command.length === 0 || stage.command.some((part) => typeof part !== "string")) {
			throw new Error(`${where}: check needs a non-empty string command array`);
		}
		return stage;
	}
	if (base.type === "approval") {
		const stage = value as unknown as ApprovalStage;
		if (!Array.isArray(stage.for) || stage.for.length === 0 || typeof stage.message !== "string") {
			throw new Error(`${where}: approval needs for and message`);
		}
		return stage;
	}
	if (base.type === "repair-loop") {
		const stage = value as unknown as RepairLoopStage;
		if (!Number.isInteger(stage.maxAttempts) || stage.maxAttempts < 1 || stage.maxAttempts > 3) {
			throw new Error(`${where}: repair-loop maxAttempts must be 1..3`);
		}
		if (!Array.isArray(stage.if) || stage.if.length === 0 || !Array.isArray(stage.stages) || stage.stages.length === 0) {
			throw new Error(`${where}: repair-loop needs if and stages`);
		}
		stage.stages = stage.stages.map((child, index) => validateStage(child, `${where}.stages[${index}]`));
		return stage;
	}
	throw new Error(`${where}: unsupported stage type ${base.type}`);
}

function loadWorkflow(name: string): WorkflowDefinition {
	if (!RUN_ID.test(name)) throw new Error(`Invalid workflow name: ${name}`);
	const filePath = path.join(workflowsDir(), `${name}.json`);
	const parsed = parseJsonFile(filePath);
	if (!isRecord(parsed) || parsed.name !== name || typeof parsed.description !== "string" || !Array.isArray(parsed.stages)) {
		throw new Error(`${name}.json: expected name, description, and stages`);
	}
	const stages = parsed.stages.map((stage, index) => validateStage(stage, `${name}.stages[${index}]`));
	return { name, description: parsed.description, stages, maxRepairAttempts: parsed.maxRepairAttempts };
}

function discoverWorkflows(): Array<{ name: string; description: string }> {
	try {
		return fs.readdirSync(workflowsDir(), { withFileTypes: true })
			.filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
			.map((entry) => entry.name.slice(0, -5))
			.filter((name) => RUN_ID.test(name))
			.map((name) => {
				try {
					const workflow = loadWorkflow(name);
					return { name: workflow.name, description: workflow.description };
				} catch {
					return null;
				}
			})
			.filter((workflow): workflow is { name: string; description: string } => workflow !== null)
			.sort((a, b) => a.name.localeCompare(b.name));
	} catch {
		return [];
	}
}

function compact(value: string, limit = HANDOFF_LIMIT): string {
	if (Buffer.byteLength(value, "utf8") <= limit) return value;
	let result = value.slice(0, limit);
	while (Buffer.byteLength(result, "utf8") > limit) result = result.slice(0, -1);
	return `${result}\n\n[handoff truncated; full output is in the run artifact]`;
}

function selectedHandoff(state: RunState, stage: BaseStage): string {
	const names = stage.handoffFrom ?? [];
	return names
		.map((name) => state.handoffs[name] ? `--- ${name} ---\n${state.handoffs[name]}` : "")
		.filter(Boolean)
		.join("\n\n");
}

function renderTemplate(value: string, state: RunState, stage: BaseStage, attempt = 0): string {
	return value
		.replaceAll("{input}", state.input)
		.replaceAll("{handoff}", selectedHandoff(state, stage))
		.replaceAll("{attempt}", String(attempt));
}

function checkControl(control: Control): void {
	if (control.quitRequested) throw new WorkflowControlStop("quit");
	if (control.pauseRequested) throw new WorkflowControlStop("paused");
}

async function writeArtifact(state: RunState, stage: BaseStage, output: string, attempt?: number): Promise<void> {
	if (!stage.artifact) return;
	const suffix = attempt ? `-${attempt}` : "";
	const name = stage.artifact.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+/, "");
	if (!name) throw new Error(`Invalid artifact name for ${stage.id}`);
	const relative = `artifacts/${name.replace(/(\.[^.]+)?$/, `${suffix}$1`)}`;
	await atomicWrite(path.join(runDir(state.id), relative), output);
	if (!state.artifacts.includes(relative)) state.artifacts.push(relative);
}

function resultKey(stage: Stage, prefix?: string): string {
	return prefix ? `${prefix}.${stage.id}` : stage.id;
}

async function runCheck(state: RunState, stage: CheckStage, control: Control): Promise<StageOutcome> {
	const command = stage.command.map((part) => renderTemplate(part, state, stage));
	return await new Promise<StageOutcome>((resolve) => {
		const child = spawn(command[0], command.slice(1), { cwd: state.cwd, stdio: ["ignore", "pipe", "pipe"] });
		let output = "";
		const append = (chunk: Buffer) => {
			output += chunk.toString();
			if (output.length > OUTPUT_LIMIT) output = output.slice(-OUTPUT_LIMIT);
		};
		child.stdout.on("data", append);
		child.stderr.on("data", append);
		const abort = () => child.kill("SIGTERM");
		control.abort.signal.addEventListener("abort", abort, { once: true });
		child.on("error", (error) => resolve({ ok: false, output, error: error.message }));
		child.on("close", (code) => resolve({ ok: code === 0, output: output || "(no output)", error: code === 0 ? undefined : `exit ${code}` }));
	});
}

async function mapBounded<T>(items: T[], limit: number, fn: (item: T, index: number) => Promise<StageOutcome>): Promise<StageOutcome[]> {
	const results = new Array<StageOutcome>(items.length);
	let next = 0;
	const workers = Array.from({ length: Math.min(Math.max(1, limit), MAX_PARALLEL, items.length) }, async () => {
		while (next < items.length) {
			const index = next++;
			results[index] = await fn(items[index], index);
		}
	});
	await Promise.all(workers);
	return results;
}

async function runDelegate(
	state: RunState,
	stage: DelegateStage,
	ctx: ExtensionContext,
	control: Control,
	attempt?: number,
): Promise<StageOutcome> {
	const discovery = discoverAgents(state.cwd, "user");
	const defaults: DispatchDefaults = {
		model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
		thinkingLevel: ctx.thinkingLevel,
	};
	const makeDetails = () => ({ mode: "single" as const, agentScope: "user" as const, projectAgentsDir: null, results: [] });
	const run = async (agent: string, task: string, step: number): Promise<SingleResult> => {
		return runSingleAgent(
			state.cwd,
			defaults,
			discovery.agents,
			agent,
			renderTemplate(task, state, stage, attempt),
			state.cwd,
			step,
			control.abort.signal,
			undefined,
			makeDetails,
		);
	};

	if (stage.mode === "parallel" || stage.tasks) {
		const results = await mapBounded(stage.tasks ?? [], stage.parallelLimit ?? MAX_PARALLEL, async (task, index) => {
			const result = await run(task.agent, task.task, index + 1);
			return { ok: !isFailedResult(result), output: `${task.agent}: ${getResultOutput(result)}`, error: result.errorMessage };
		});
		const output = results.map((result) => result.output).join("\n\n");
		return { ok: results.every((result) => result.ok), output };
	}

	const result = await run(stage.agent as string, stage.task as string, 1);
	return { ok: !isFailedResult(result), output: getResultOutput(result), error: result.errorMessage };
}

async function approveStage(state: RunState, stage: ApprovalStage, ctx: ExtensionContext): Promise<StageOutcome> {
	if (!ctx.hasUI) throw new WorkflowControlStop("paused");
	state.status = "waiting-approval";
	await saveState(state);
	const approved = await ctx.ui.confirm(
		"Approve workflow stage",
		`${renderTemplate(stage.message, state, stage)}\n\nRun: ${state.id}\nWorkflow: ${state.workflow}`,
	);
	if (!approved) throw new WorkflowControlStop("paused");
	for (const stageId of stage.for) if (!state.approvals.includes(stageId)) state.approvals.push(stageId);
	return { ok: true, output: `Approved: ${stage.for.join(", ")}` };
}

async function executeStage(
	state: RunState,
	stage: Stage,
	ctx: ExtensionContext,
	control: Control,
	key: string,
	attempt?: number,
): Promise<StageOutcome> {
	checkControl(control);
	state.currentStage = key;
	state.status = "running";
	await saveState(state);

	let outcome: StageOutcome;
	if (stage.type === "approval") {
		outcome = await approveStage(state, stage, ctx);
	} else if (stage.type === "check") {
		outcome = await runCheck(state, stage, control);
	} else if (stage.type === "delegate") {
		if (stage.mutation && !state.approvals.includes(stage.id)) {
			const approved = await approveStage(state, {
				id: `approval-${stage.id}`,
				type: "approval",
				for: [stage.id],
				message: `Allow mutation stage ${stage.id} to run?`,
			}, ctx);
			if (!approved.ok) outcome = approved;
			else outcome = await runDelegate(state, stage, ctx, control, attempt);
		} else {
			outcome = await runDelegate(state, stage, ctx, control, attempt);
		}
	} else {
		const triggered = stage.if.includes("always") || stage.if.some((id) => state.stageResults[id]?.status === "failed");
		if (!triggered) return { ok: true, output: "Repair loop skipped: referenced stages are green." };
		let last: StageOutcome = { ok: false, output: "repair loop did not run" };
		const startAttempt = state.loopAttempts[stage.id] ?? 0;
		for (let currentAttempt = Math.max(1, startAttempt); currentAttempt <= stage.maxAttempts; currentAttempt++) {
			state.loopAttempts[stage.id] = currentAttempt;
			await saveState(state);
			let attemptPassed = true;
			for (const inner of stage.stages) {
				const innerOutcome = await executeStage(state, inner, ctx, control, `${stage.id}.${currentAttempt}.${inner.id}`, currentAttempt);
				state.stageResults[resultKey(inner, `${stage.id}.${currentAttempt}`)] = {
					status: innerOutcome.ok ? "passed" : "failed",
					output: compact(innerOutcome.output),
					error: innerOutcome.error,
					attempt: currentAttempt,
					updatedAt: now(),
				};
				await saveState(state);
				last = innerOutcome;
				if (!innerOutcome.ok) {
					attemptPassed = false;
					if (!inner.continueOnFailure) break;
				}
			}
			if (attemptPassed) return { ok: true, output: `Repair loop passed on attempt ${currentAttempt}.` };
		}
		return { ok: false, output: `Repair loop exhausted after ${stage.maxAttempts} attempt(s).\n${last.output}`, error: last.error };
	}

	if (stage.type !== "repair-loop") {
		if (stage.failureIfContains && outcome.output.includes(stage.failureIfContains)) {
			outcome = { ...outcome, ok: false, error: `Output matched failure marker: ${stage.failureIfContains}` };
		}
		if (stage.handoff) state.handoffs[stage.id] = compact(outcome.output);
		await writeArtifact(state, stage, outcome.output, attempt);
	}
	return outcome;
}

async function executeRun(state: RunState, workflow: WorkflowDefinition, ctx: ExtensionContext, control: Control): Promise<void> {
	try {
		for (const stage of workflow.stages) {
			const outcome = await executeStage(state, stage, ctx, control, stage.id);
			state.stageResults[stage.id] = {
				status: outcome.ok ? "passed" : "failed",
				output: compact(outcome.output),
				error: outcome.error,
				updatedAt: now(),
			};
			await saveState(state);
			if (!outcome.ok && !stage.continueOnFailure) throw new Error(outcome.error || outcome.output);
			checkControl(control);
		}
		state.status = "completed";
		state.currentStage = "";
		await saveState(state);
		ctx.ui.notify(`Workflow ${state.workflow} completed (${state.id})`, "info");
	} catch (error) {
		const controlStop = error instanceof WorkflowControlStop ? error.kind : control.quitRequested ? "quit" : control.pauseRequested ? "paused" : undefined;
		if (controlStop) {
			state.status = controlStop === "paused" ? "paused" : "quit";
			if (controlStop === "quit") state.error = "Stopped by user.";
			await saveState(state);
			ctx.ui.notify(`Workflow ${state.id}: ${state.status}`, controlStop === "paused" ? "info" : "warning");
		} else {
			state.status = "failed";
			state.error = error instanceof Error ? error.message : String(error);
			await saveState(state);
			ctx.ui.notify(`Workflow ${state.id} failed: ${state.error}`, "error");
		}
	} finally {
		activeRuns.delete(state.id);
	}
}

function newRunId(workflow: string): string {
	return `${workflow}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function startWorkflow(name: string, input: string, cwd: string, ctx: ExtensionContext): Promise<RunState> {
	const workflow = loadWorkflow(name);
	const id = newRunId(name);
	const timestamp = now();
	const state: RunState = {
		version: 1,
		id,
		workflow: workflow.name,
		cwd,
		input,
		status: "running",
		currentStage: workflow.stages[0]?.id ?? "",
		startedAt: timestamp,
		updatedAt: timestamp,
		artifacts: [],
		handoffs: {},
		stageResults: {},
		loopAttempts: {},
		approvals: [],
	};
	const control: Control = { abort: new AbortController(), pauseRequested: false, quitRequested: false };
	activeRuns.set(id, control);
	await saveState(state);
	void executeRun(state, workflow, ctx, control);
	return state;
}

async function resumeWorkflow(id: string, ctx: ExtensionContext): Promise<RunState> {
	const state = await loadState(id);
	if (state.status !== "paused" && state.status !== "waiting-approval") throw new Error(`Run ${id} is ${state.status}; only paused runs can resume.`);
	if (activeRuns.has(id)) throw new Error(`Run ${id} is already active.`);
	const workflow = loadWorkflow(state.workflow);
	const control: Control = { abort: new AbortController(), pauseRequested: false, quitRequested: false };
	activeRuns.set(id, control);
	state.status = "running";
	state.error = undefined;
	await saveState(state);
	void executeRun(state, workflow, ctx, control);
	return state;
}

function describeState(state: RunState): string {
	const finished = Object.values(state.stageResults).filter((result) => result.status !== "skipped").length;
	return `${state.id}: ${state.workflow} ${state.status}; stage=${state.currentStage || "done"}; results=${finished}; artifacts=${state.artifacts.join(", ") || "none"}`;
}

async function command(args: string, ctx: ExtensionCommandContext): Promise<void> {
	const parts = args.trim().split(/\s+/).filter(Boolean);
	const action = parts.shift() ?? "list";
	try {
		if (action === "list") {
			const workflows = discoverWorkflows();
			ctx.ui.notify(workflows.length ? workflows.map((workflow) => `${workflow.name}: ${workflow.description}`).join("\n") : "No workflows discovered.", "info");
			return;
		}
		if (action === "show") {
			const workflow = loadWorkflow(parts[0]);
			ctx.ui.notify(`${workflow.name}: ${workflow.description}\nStages: ${workflow.stages.map((stage) => stage.id).join(" -> ")}`, "info");
			return;
		}
		if (action === "start") {
			const state = await startWorkflow(parts.shift() ?? "", parts.join(" "), ctx.cwd, ctx);
			ctx.ui.notify(`Started ${state.workflow} as ${state.id}. Use /workflow status ${state.id}.`, "info");
			return;
		}
		if (action === "status") {
			const id = parts[0];
			if (id) ctx.ui.notify(describeState(await loadState(id)), "info");
			else ctx.ui.notify([...activeRuns.keys()].join("\n") || "No active workflow runs.", "info");
			return;
		}
		if (action === "resume") {
			const state = await resumeWorkflow(parts[0], ctx);
			ctx.ui.notify(`Resumed ${state.id} at ${state.currentStage || "the next stage"}.`, "info");
			return;
		}
		if (action === "pause" || action === "quit") {
			const id = parts[0];
			if (!id) throw new Error(`${action} needs a run id`);
			const control = activeRuns.get(id);
			const state = await loadState(id);
			if (!control) throw new Error(`Run ${id} is not active.`);
			if (action === "pause") {
				control.pauseRequested = true;
				state.status = "pausing";
			} else {
				control.quitRequested = true;
				control.abort.abort();
				state.status = "quit";
			}
			await saveState(state);
			ctx.ui.notify(`${action === "pause" ? "Pause requested" : "Quit requested"} for ${id}.`, "info");
			return;
		}
		throw new Error("Usage: /workflow list|show NAME|start NAME [input]|status [RUN_ID]|pause RUN_ID|resume RUN_ID|quit RUN_ID");
	} catch (error) {
		ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
	}
}

const WorkflowParams = Type.Object({
	action: Type.Optional(Type.String({ description: "list, show, start, status, pause, resume, or quit" })),
	name: Type.Optional(Type.String({ description: "Workflow or run name" })),
	input: Type.Optional(Type.String({ description: "Narrow task context for a new run" })),
});

export default function workflowExtension(pi: ExtensionAPI) {
	pi.registerCommand("workflow", {
		description: "List or explicitly run a durable workflow",
		handler: command,
	});

	pi.registerTool({
		name: "workflow",
		label: "Workflow",
		description: "Opt-in durable workflow control. Use list/show/status before starting a run.",
		parameters: WorkflowParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const action = params.action ?? "list";
			try {
				if (action === "list") return { content: [{ type: "text", text: discoverWorkflows().map((workflow) => `${workflow.name}: ${workflow.description}`).join("\n") || "No workflows discovered." }] };
				if (action === "show") {
					const workflow = loadWorkflow(params.name ?? "");
					return { content: [{ type: "text", text: `${workflow.name}: ${workflow.description}\nStages: ${workflow.stages.map((stage) => stage.id).join(" -> ")}` }] };
				}
				if (action === "start") {
					const state = await startWorkflow(params.name ?? "", params.input ?? "", ctx.cwd, ctx);
					return { content: [{ type: "text", text: `Started ${state.workflow} as ${state.id}.` }], details: state };
				}
				if (action === "status") {
					if (!params.name) return { content: [{ type: "text", text: [...activeRuns.keys()].join("\n") || "No active workflow runs." }] };
					return { content: [{ type: "text", text: describeState(await loadState(params.name)) }] };
				}
				if (action === "resume") return { content: [{ type: "text", text: `Resumed ${(await resumeWorkflow(params.name ?? "", ctx)).id}.` }] };
				const control = activeRuns.get(params.name ?? "");
				if (!control) throw new Error(`Run ${params.name ?? ""} is not active.`);
				const state = await loadState(params.name ?? "");
				if (action === "pause") {
					control.pauseRequested = true;
					state.status = "pausing";
				} else if (action === "quit") {
					control.quitRequested = true;
					control.abort.abort();
					state.status = "quit";
				} else throw new Error("Unknown workflow action.");
				await saveState(state);
				return { content: [{ type: "text", text: `${action} requested for ${state.id}.` }] };
			} catch (error) {
				return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
			}
		},
	});
}
