/**
 * What the phone is allowed to ask the desktop to do.
 *
 * The phone runs the desktop's own renderer — the same React app, the same components, the same
 * settings pages — and that renderer talks to `window.lyra`, an interface of some 177 methods. On
 * the desktop those are Electron IPC channels. Over the network they cannot all be: `terminal.*`
 * hands out a shell, `files.write` writes anywhere the user can, `screenshot.*` reads the display.
 * Whoever holds the pairing token would hold all of it.
 *
 * So this is an allowlist rather than a bridge. A method that is not named here does not exist for
 * the phone, and the renderer degrades on its own — a settings page whose data never arrives shows
 * its empty state, which is the right thing for a page that has no business being on a phone.
 *
 * The list is the security boundary and the product decision at once, which is why it is one file
 * you can read top to bottom rather than a rule spread across the handlers.
 */

import type { AgentSession, SessionStorage, Settings } from "@lyra/core";
import { settingsFromPhone } from "./phone-settings.ts";

/**
 * Everything a call may reach, handed in rather than imported.
 *
 * The session hub reaches Electron through its own imports, and this module is otherwise plain
 * data — importing it here would make the allowlist unloadable outside Electron, which is exactly
 * where its tests want to run. Injection keeps this file a list of decisions rather than a graph
 * of dependencies.
 */
export interface RpcDeps {
	store(): SessionStorage;
	settings(): Settings;
	saveSettings(next: Settings): Promise<void>;
	workspaceInfo(path: string): Promise<unknown>;
	/** Sessions currently warm, by id. */
	live(sessionId: string): AgentSession | undefined;
	/** Bring a stored session up, or null when there is no such session. */
	activate(projectId: string, sessionId: string): Promise<AgentSession | null>;
	getOrCreate(cwd: string, modelId: string): Promise<AgentSession>;
	snapshot(session: AgentSession): Promise<unknown>;
	touch(sessionId: string): void;
}

/**
 * Facts about the host that the renderer reads before it draws anything.
 *
 * Reported as the desktop's, not the phone's: the renderer uses `platform` to decide where window
 * controls go and which shortcut glyphs to print, and it is describing the machine the session
 * actually runs on. The phone's own platform is not a thing this app has an opinion about.
 */
export interface PlatformFacts {
	platform: NodeJS.Platform;
}

type Handler = (deps: RpcDeps, args: unknown[]) => Promise<unknown>;

const s = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * Everything the phone may call, and nothing else.
 *
 * Grouped by why each one is here rather than alphabetically — the interesting question about any
 * of these is "should a phone be able to do this", and grouping by answer makes the omissions
 * visible. What is deliberately absent: `terminal` (a shell), `files.write` (arbitrary writes),
 * `screenshot` (reads the display), `git` beyond reading, `plugins`, `updates`, `system.openPath`.
 */
export const RPC: Record<string, Handler> = {
	// -- Reading the shell -----------------------------------------------------
	"settings.get": async (deps) => deps.settings(),
	"sessions.list": async (deps) => deps.store().listSessions(),
	"workspace.info": async (deps, [path]) => deps.workspaceInfo(s(path)),

	// -- Opening and reading a conversation ------------------------------------
	"sessions.transcript": async (deps, [projectId, sessionId]) => {
		// A live session is the authority: it holds the messages of a turn still in flight.
		const warm = deps.live(s(sessionId));
		if (warm) {
			deps.touch(s(sessionId));
			return deps.snapshot(warm);
		}
		const loaded = await deps.store().load(s(projectId), s(sessionId));
		if (!loaded) return null;
		return {
			meta: loaded.meta,
			messages: loaded.messages,
			running: false,
			pendingApprovals: [],
			compactions: loaded.compactions,
		};
	},
	"sessions.open": async (deps, [projectId, sessionId]) => {
		const session = await deps.activate(s(projectId), s(sessionId));
		return session ? deps.snapshot(session) : null;
	},
	"sessions.create": async (deps, [cwd, modelId]) => {
		const session = await deps.getOrCreate(s(cwd), s(modelId));
		if (s(modelId)) await session.setModel(s(modelId));
		return deps.snapshot(session);
	},

	// -- Driving a turn --------------------------------------------------------
	"agent.prompt": async (deps, [sessionId, content, options]) => {
		const session = await live(deps, s(sessionId));
		if (!session) return null;
		await session.prompt(content as never, (options ?? {}) as never);
		return null;
	},
	"agent.abort": async (deps, [sessionId]) => {
		deps.live(s(sessionId))?.abort();
		return null;
	},
	"agent.approve": async (deps, [sessionId, requestId, decision]) => {
		deps.live(s(sessionId))?.resolveApproval(s(requestId), decision as never);
		return null;
	},
	"agent.setModel": async (deps, [sessionId, modelId]) => {
		const session = await live(deps, s(sessionId));
		await session?.setModel(s(modelId));
		return null;
	},
	"agent.setThinking": async (deps, [sessionId, thinking]) => {
		const session = await live(deps, s(sessionId));
		await session?.setThinking(thinking as never);
		return null;
	},
	"agent.editMessage": async (deps, [sessionId, index, content]) => {
		const session = await live(deps, s(sessionId));
		if (!session) return null;
		await session.editAndResend(Number(index), content as never);
		return null;
	},

	// -- Managing the list -----------------------------------------------------
	/*
	 * Writable, unlike most of the desktop's reach. Renaming, archiving and deleting a conversation
	 * are things about *this app's own data* — the kind of tidying someone does on a phone — rather
	 * than reach into the machine. Writing files or opening a shell is the line, and it is drawn
	 * by what is absent from this list.
	 */
	"sessions.rename": async (deps, [_projectId, sessionId, title]) => {
		const clean = s(title).trim();
		if (!clean) return null;
		const session = deps.live(s(sessionId));
		if (session) {
			await session.rename(clean);
			return session.meta;
		}
		const meta = (await deps.store().listSessions()).find((entry) => entry.id === s(sessionId));
		if (!meta) return null;
		const renamed = await deps.store().append(meta, { type: "title", title: clean });
		return renamed.titleSetByUser
			? renamed
			: deps.store().append(renamed, { type: "meta", meta: { ...renamed, titleSetByUser: true } });
	},
	"sessions.setArchived": async (deps, [projectId, sessionId, archived]) => {
		await deps.store().setArchived(s(projectId), s(sessionId), Boolean(archived));
		return deps.store().listSessions();
	},
	"sessions.remove": async (deps, [projectId, sessionId]) => {
		await deps.store().delete(s(projectId), s(sessionId));
		return null;
	},
	/*
	 * Merged onto what the desktop has, rather than replacing it — see `phone-settings.ts`.
	 *
	 * Taking the object as sent meant two things at once: a phone could write `hooks`, which is a
	 * list of shell commands the desktop runs, and a phone one version behind could drop every
	 * field it did not know about.
	 */
	"settings.save": async (deps, [next]) => {
		await deps.saveSettings(settingsFromPhone(deps.settings(), next));
		return deps.settings();
	},

	// -- Things the renderer asks for and can live without ---------------------
	/*
	 * Answered rather than omitted, because the renderer calls them on its startup path and an
	 * allowlist rejection would surface as an error where the honest answer is "not here".
	 * Scratch directories are a desktop concept: they are folders on that machine.
	 */
	"git.scratchRoots": async () => [],
	"git.generalScratch": async () => null,
	"subAgents.list": async (deps, [sessionId]) => deps.live(s(sessionId))?.subAgents.list() ?? [],
	/*
	 * The same shape the desktop reports, read off the live session.
	 *
	 * Null when the session is not warm, exactly as on the desktop: this is a question about a
	 * running agent, and starting one to answer it would make opening a conversation on the phone
	 * pay for skills, plugins and MCP child processes it may never use.
	 */
	"sessions.capabilities": async (deps, [sessionId]) => {
		const session = deps.live(s(sessionId));
		if (!session) return null;
		deps.touch(s(sessionId));
		const status = await session.status();
		return {
			skills: status.skills,
			skillDiagnostics: status.skillDiagnostics,
			plugins: status.plugins,
			pluginDiagnostics: status.pluginDiagnostics,
			mcp: status.mcp,
			agents: status.agents.map((agent) => ({
				name: agent.name,
				description: agent.description,
				source: agent.source,
				tools: agent.tools,
			})),
			toolNames: status.toolNames,
		};
	},
};

/** The session for an id, starting it from disk if it is only stored. */
async function live(deps: RpcDeps, sessionId: string) {
	const existing = deps.live(sessionId);
	if (existing) {
		deps.touch(sessionId);
		return existing;
	}
	const meta = (await deps.store().listSessions()).find((entry) => entry.id === sessionId);
	return meta ? deps.activate(meta.projectId, sessionId) : null;
}

export interface RpcResult {
	ok: boolean;
	value?: unknown;
	error?: string;
}

/**
 * Run one call, or say why not.
 *
 * Errors come back as a value rather than a thrown exception, so a method that fails leaves the
 * connection alone — the phone is a long-lived client and one bad call should not cost it the
 * WebSocket and the resync that follows.
 */
export async function callRpc(deps: RpcDeps, method: string, args: unknown[]): Promise<RpcResult> {
	const handler = RPC[method];
	if (!handler) return { ok: false, error: "method-not-allowed" };
	try {
		return { ok: true, value: (await handler(deps, args)) ?? null };
	} catch (cause) {
		return { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
	}
}

/** The methods the phone may call, for the bridge to expose and for tests to assert on. */
export const allowedMethods = (): string[] => Object.keys(RPC).sort();
