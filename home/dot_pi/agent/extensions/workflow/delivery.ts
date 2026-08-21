import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const COMMAND_OUTPUT_LIMIT = 16_000;
const SAFE_EXECUTABLES = new Set(["git", "gh"]);

export interface FixedCommandResult {
	executable: string;
	args: string[];
	exitCode: number | null;
	stdout: string;
	stderr: string;
	failedToStart?: string;
}

export interface DeliveryPreflight {
	root: string;
	branch: string;
	sha: string;
	gitVersion: string;
	github: {
		authenticated: boolean;
		repositoryAccessible: boolean;
	};
	evidence: Record<string, string | number | boolean>;
}

export interface WorktreeFacts {
	path: string;
	branch: string;
	baseBranch: string;
	created: boolean;
}

export interface PullRequestFacts {
	number: number;
	url: string;
	state: string;
	baseBranch: string;
	headBranch: string;
	headSha: string;
}

export interface CheckFact {
	name: string;
	state: string;
	bucket?: string;
	workflow?: string;
	link?: string;
}

export interface PullRequestChecks {
	status: "green" | "pending" | "failed";
	headSha: string;
	checks: CheckFact[];
	observedAt: string;
}

function appendLimited(current: string, chunk: Buffer): string {
	const next = current + chunk.toString();
	return next.length <= COMMAND_OUTPUT_LIMIT ? next : next.slice(-COMMAND_OUTPUT_LIMIT);
}

function validateExecutable(executable: string): void {
	if (!SAFE_EXECUTABLES.has(executable)) throw new Error(`Untrusted executable: ${executable}`);
}

function validateArgs(args: string[]): void {
	if (args.some((arg) => typeof arg !== "string")) throw new Error("Command arguments must be strings");
}

export async function runFixedCommand(executable: string, args: string[], cwd: string, timeoutMs = 20_000): Promise<FixedCommandResult> {
	validateExecutable(executable);
	validateArgs(args);
	return await new Promise<FixedCommandResult>((resolve) => {
		const child = spawn(executable, args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		let settled = false;
		const finish = (result: FixedCommandResult) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(result);
		};
		const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
		child.stdout.on("data", (chunk: Buffer) => {
			stdout = appendLimited(stdout, chunk);
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr = appendLimited(stderr, chunk);
		});
		child.on("error", (error) => {
			finish({ executable, args, exitCode: null, stdout, stderr, failedToStart: error.message });
		});
		child.on("close", (exitCode) => {
			finish({ executable, args, exitCode, stdout, stderr });
		});
	});
}

function succeeded(result: FixedCommandResult): boolean {
	return result.exitCode === 0;
}

function firstLine(value: string): string {
	return value.trim().split(/\r?\n/, 1)[0] ?? "";
}

function real(value: string): string {
	return fs.realpathSync.native(value);
}

export function validateBranchName(value: string): string {
	if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) || value.includes("..") || value.endsWith(".") || value.endsWith("/")) {
		throw new Error(`Unsafe branch name: ${value}`);
	}
	return value;
}

export function validateTicketId(value: string): string {
	if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) || value.includes("..")) throw new Error("Ticket id must use letters, numbers, dot, underscore, slash, or hyphen");
	return value;
}

export function parseDeliveryInput(input: string): { ticketId: string; task: string } {
	const match = input.trim().match(/^(\S+)\s+([\s\S]+)$/);
	if (!match) throw new Error("deliver-ticket input: TICKET_ID TASK_TEXT");
	return { ticketId: validateTicketId(match[1]), task: match[2].trim() };
}

export function deliveryBranch(ticketId: string, runId: string): string {
	const safeTicket = validateTicketId(ticketId).replaceAll("/", "-");
	return validateBranchName(`pi/delivery/${safeTicket}/${runId}`);
}

export function assertWithin(parent: string, candidate: string): void {
	const parentReal = path.resolve(parent);
	const candidateReal = path.resolve(candidate);
	const relative = path.relative(parentReal, candidateReal);
	if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
		throw new Error(`Path escapes workflow state directory: ${candidate}`);
	}
}

export async function runDeliveryPreflight(cwd: string, requireGitHub: boolean): Promise<DeliveryPreflight> {
	const absoluteCwd = real(cwd);
	const gitVersion = await runFixedCommand("git", ["--version"], absoluteCwd);
	if (!succeeded(gitVersion)) throw new Error("git is unavailable");
	const rootResult = await runFixedCommand("git", ["rev-parse", "--show-toplevel"], absoluteCwd);
	if (!succeeded(rootResult)) throw new Error("Not inside a Git repository");
	const root = real(firstLine(rootResult.stdout));
	if (root !== absoluteCwd) throw new Error("Delivery requires starting from the repository root");
	const branchResult = await runFixedCommand("git", ["branch", "--show-current"], root);
	const branch = firstLine(branchResult.stdout);
	if (!succeeded(branchResult) || !branch) throw new Error("Delivery refuses a detached HEAD");
	validateBranchName(branch);
	const statusResult = await runFixedCommand("git", ["status", "--porcelain=v1", "--untracked-files=all"], root);
	if (!succeeded(statusResult)) throw new Error("Unable to inspect Git worktree status");
	if (statusResult.stdout.trim()) throw new Error("Delivery requires a clean base checkout; no stash or reset is attempted");
	const shaResult = await runFixedCommand("git", ["rev-parse", "HEAD"], root);
	if (!succeeded(shaResult)) throw new Error("Unable to resolve base HEAD");
	const verifyBranch = await runFixedCommand("git", ["rev-parse", "--verify", `refs/heads/${branch}`], root);
	if (!succeeded(verifyBranch)) throw new Error("Unable to verify the base branch");
	const worktreeResult = await runFixedCommand("git", ["worktree", "list", "--porcelain"], root);
	if (!succeeded(worktreeResult) || !worktreeResult.stdout.includes(`worktree ${root}`)) throw new Error("Unable to verify the base worktree");

	let authenticated = true;
	let repositoryAccessible = true;
	if (requireGitHub) {
		const authResult = await runFixedCommand("gh", ["auth", "status", "--hostname", "github.com"], root);
		authenticated = succeeded(authResult);
		const repoResult = await runFixedCommand("gh", ["repo", "view", "--json", "nameWithOwner,url"], root);
		repositoryAccessible = succeeded(repoResult);
		if (!authenticated || !repositoryAccessible) throw new Error("GitHub preflight failed: gh auth or repository access is unavailable");
	}

	return {
		root,
		branch,
		sha: firstLine(shaResult.stdout),
		gitVersion: firstLine(gitVersion.stdout),
		github: { authenticated, repositoryAccessible },
		evidence: {
			root,
			branch,
			baseSha: firstLine(shaResult.stdout),
			clean: true,
			gitVersion: firstLine(gitVersion.stdout),
			githubAuthenticated: authenticated,
			repositoryAccessible,
		},
	};
}

async function worktreeRoot(worktreePath: string): Promise<string | null> {
	if (!fs.existsSync(worktreePath)) return null;
	const result = await runFixedCommand("git", ["rev-parse", "--show-toplevel"], worktreePath);
	return succeeded(result) ? real(firstLine(result.stdout)) : null;
}

export async function ensureDeliveryWorktree(
	baseCwd: string,
	baseBranch: string,
	worktreePath: string,
	branch: string,
	stateRoot: string,
): Promise<WorktreeFacts> {
	validateBranchName(baseBranch);
	validateBranchName(branch);
	assertWithin(stateRoot, worktreePath);
	const existingRoot = await worktreeRoot(worktreePath);
	if (existingRoot) {
		if (existingRoot !== path.resolve(worktreePath)) throw new Error("Existing delivery worktree resolves to another path");
		const branchResult = await runFixedCommand("git", ["branch", "--show-current"], worktreePath);
		if (!succeeded(branchResult) || firstLine(branchResult.stdout) !== branch) throw new Error("Existing delivery worktree has the wrong branch");
		return { path: worktreePath, branch, baseBranch, created: false };
	}
	if (fs.existsSync(worktreePath)) throw new Error("Delivery worktree path exists but is not a Git worktree");
	await fs.promises.mkdir(path.dirname(worktreePath), { recursive: true, mode: 0o700 });
	const result = await runFixedCommand("git", ["worktree", "add", "-b", branch, worktreePath, baseBranch], baseCwd);
	if (!succeeded(result)) throw new Error(`Unable to create delivery worktree: ${firstLine(result.stderr) || "git worktree add failed"}`);
	return { path: worktreePath, branch, baseBranch, created: true };
}

function parseJson<T>(value: string, label: string): T {
	try {
		return JSON.parse(value) as T;
	} catch {
		throw new Error(`${label} returned invalid JSON`);
	}
}

function prUrl(value: string): string {
	const match = value.trim().match(/https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/(\d+)/);
	if (!match) throw new Error("gh pr create did not return a GitHub pull request URL");
	return match[0];
}

export async function createPullRequest(
	worktreePath: string,
	baseBranch: string,
	headBranch: string,
	title: string,
	bodyFile: string,
): Promise<PullRequestFacts> {
	validateBranchName(baseBranch);
	validateBranchName(headBranch);
	if (!title.trim() || title.includes("\n")) throw new Error("PR title must be a single non-empty line");
	const created = await runFixedCommand("gh", ["pr", "create", "--base", baseBranch, "--head", headBranch, "--title", title.trim(), "--body-file", bodyFile], worktreePath);
	if (!succeeded(created)) throw new Error(`gh pr create failed: ${firstLine(created.stderr) || firstLine(created.stdout)}`);
	const url = prUrl(created.stdout);
	return await readPullRequest(worktreePath, url, baseBranch, headBranch);
}

export async function readPullRequest(worktreePath: string, target: string | number, expectedBase: string, expectedHead: string): Promise<PullRequestFacts> {
	validateBranchName(expectedBase);
	validateBranchName(expectedHead);
	const targetArg = String(target);
	if (!/^\d+$/.test(targetArg) && !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+$/.test(targetArg)) throw new Error("Unsafe pull request identifier");
	const result = await runFixedCommand("gh", ["pr", "view", targetArg, "--json", "number,url,state,baseRefName,headRefName,headRefOid"], worktreePath);
	if (!succeeded(result)) throw new Error(`gh pr view failed: ${firstLine(result.stderr) || firstLine(result.stdout)}`);
	const value = parseJson<Partial<PullRequestFacts>>(result.stdout, "gh pr view");
	if (!Number.isInteger(value.number) || typeof value.url !== "string" || typeof value.state !== "string" || typeof value.baseRefName !== "string" || typeof value.headRefName !== "string" || typeof value.headRefOid !== "string") {
		throw new Error("gh pr view returned incomplete pull request facts");
	}
	if (value.baseRefName !== expectedBase || value.headRefName !== expectedHead) throw new Error("Pull request branches do not match the delivery run");
	return { number: value.number, url: value.url, state: value.state, baseBranch: value.baseRefName, headBranch: value.headRefName, headSha: value.headRefOid };
}

export async function observePullRequestChecks(worktreePath: string, prNumber: number, expectedHeadSha: string): Promise<PullRequestChecks> {
	if (!Number.isInteger(prNumber) || prNumber < 1) throw new Error("Invalid pull request number");
	const headResult = await runFixedCommand("git", ["rev-parse", "HEAD"], worktreePath);
	if (!succeeded(headResult) || firstLine(headResult.stdout) !== expectedHeadSha) throw new Error("Delivery worktree HEAD changed after PR creation");
	const prResult = await runFixedCommand("gh", ["pr", "view", String(prNumber), "--json", "state,headRefOid"], worktreePath);
	if (!succeeded(prResult)) throw new Error(`gh pr view failed: ${firstLine(prResult.stderr) || firstLine(prResult.stdout)}`);
	const pr = parseJson<{ state?: string; headRefOid?: string }>(prResult.stdout, "gh pr view");
	if (pr.state?.toUpperCase() !== "OPEN" || pr.headRefOid !== expectedHeadSha) throw new Error("Pull request is not open at the exact delivery HEAD SHA");
	const result = await runFixedCommand("gh", ["pr", "checks", String(prNumber), "--required", "--json", "name,state,workflow,link,bucket,description"], worktreePath);
	const raw = result.stdout.trim() || "[]";
	const checks = parseJson<Array<Partial<CheckFact>>>(raw, "gh pr checks").map((check) => {
		if (typeof check.name !== "string" || typeof check.state !== "string") throw new Error("gh pr checks returned an incomplete check");
		return { name: check.name, state: check.state, bucket: check.bucket, workflow: check.workflow, link: check.link };
	});
	const failed = checks.some((check) => ["FAILURE", "ERROR", "CANCELLED"].includes(check.state.toUpperCase()) || check.bucket === "fail");
	const pending = !failed && (result.exitCode !== 0 || checks.some((check) => !["SUCCESS", "SKIPPED", "NEUTRAL"].includes(check.state.toUpperCase()) && check.bucket !== "pass"));
	return { status: failed ? "failed" : pending ? "pending" : "green", headSha: expectedHeadSha, checks, observedAt: new Date().toISOString() };
}
