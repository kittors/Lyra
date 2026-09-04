/**
 * Sessions and turns, over IPC.
 *
 * Two kinds of request live here and the distinction matters: reading a transcript, which should
 * cost nothing, and running a turn, which starts an `AgentSession` with its MCP child processes and
 * its index. Opening a conversation to look at it must not pay for the second — most of the code
 * below is about keeping that line.
 */

import {
	lyraHome,
	forkSession,
	readTrajectory,
	removeSessionArtifacts,
	type AgentSession,
	type ApprovalDecision,
	type ContextBreakdown,
	type SessionMeta,
	type SessionStorage,
	type Settings,
	type ThinkingLevel,
	type UserContent,
} from "@lyra/core";
import { ipcMain } from "electron";
import { cleanOldWorktrees } from "../git-worktrees.ts";
import type { AgentCapabilities } from "../ipc-types.ts";
import {
	activateSession,
	broadcast,
	disposeSession,
	ensureLiveSession,
	getOrCreateSession,
	sessions,
	snapshot,
	touchSession,
} from "../session-hub.ts";

export interface SessionsIpcDeps {
	store(): SessionStorage;
	settings(): Settings;
	/** Persist an "always allow" answer, which is a settings change like any other. */
	saveSettings(next: Settings): Promise<void>;
}

export function registerSessionsIpc({
	store: readStore,
	settings: readSettings,
	saveSettings,
}: SessionsIpcDeps): void {
	const store = readStore();

	ipcMain.handle("sessions:list", async () => store.listSessions());

	/**
	 * Bring a session up: replay its log, load its skills, spawn its MCP servers.
	 *
	 * This is the expensive half of opening a conversation, so it only runs when something is
	 * about to be executed in it — never for a read.
	 */

	/**
	 * The session for an id, starting it if it is only on disk.
	 *
	 * Callers that act on a session — prompting, changing its model — have a session id but no
	 * project id, so the project is recovered from the index.
	 */
	async function ensureSession(
		sessionId: string,
	): Promise<AgentSession | null> {
		const existing = sessions.get(sessionId);
		if (existing) {
			touchSession(sessionId);
			return existing;
		}
		const meta = (await store.listSessions()).find((s) => s.id === sessionId);
		return meta ? activateSession(meta.projectId, sessionId) : null;
	}

	ipcMain.handle(
		"sessions:create",
		async (_event, cwd: string, modelId: string) => {
			const session = await getOrCreateSession(cwd, modelId);
			if (modelId) await session.setModel(modelId);
			return snapshot(session);
		},
	);

	/**
	 * Read a transcript without starting anything.
	 *
	 * Opening a session used to build an `AgentSession` — loading skills, spawning MCP child
	 * processes, warming the index — which costs well over a second and is pure waste when all
	 * you did was click a row to read what it says. Reading the log takes a few milliseconds;
	 * the agent is started later, by `ensureSession`, when there is actually something to run.
	 */
	/*
	 * The trajectory, and forking from a point in it.
	 *
	 * Both read the same file the turn was written to — there is no second record of what happened
	 * and no chance of the two disagreeing.
	 */
	ipcMain.handle(
		"sessions:trajectory",
		async (_event, projectId: string, sessionId: string) =>
			readTrajectory(store as never, projectId, sessionId),
	);

	ipcMain.handle(
		"sessions:fork",
		async (_event, projectId: string, sessionId: string, seq: number) =>
			forkSession(store as never, projectId, sessionId, seq),
	);

	ipcMain.handle(
		"sessions:transcript",
		async (_event, projectId: string, sessionId: string) => {
			// A live session is the authority — it holds messages from the turn in flight and
			// knows whether it is running.
			const live = sessions.get(sessionId);
			if (live) {
				touchSession(sessionId);
				return snapshot(live);
			}

			const loaded = await store.load(projectId, sessionId);
			if (!loaded) return null;
			return {
				meta: loaded.meta,
				messages: loaded.messages,
				running: false,
				pendingApprovals: [],
				compactions: loaded.compactions,
			};
		},
	);

	ipcMain.handle(
		"sessions:open",
		async (_event, projectId: string, sessionId: string) => {
			const session = await activateSession(projectId, sessionId);
			return session ? snapshot(session) : null;
		},
	);

	ipcMain.handle(
		"sessions:remove",
		async (_event, projectId: string, sessionId: string) => {
			const sessionMeta = (await store.listSessions()).find((s) => s.id === sessionId);
			await disposeSession(sessionId);
			await store.delete(projectId, sessionId);
			await removeSessionArtifacts(lyraHome(), sessionId);

			// If session was running in a dedicated worktree and autoCleanOld is enabled, clean it up
			const appSettings = readSettings();
			if (sessionMeta?.cwd && appSettings.worktrees?.autoCleanOld) {
				const liveCwds = new Set(Array.from(sessions.values()).map((s) => s.cwd));
				void cleanOldWorktrees(sessionMeta.cwd, appSettings, liveCwds).catch(() => {});
			}
		},
	);

	ipcMain.handle(
		"sessions:rename",
		async (_event, projectId: string, sessionId: string, title: string) => {
			const cleanTitle = title.trim();
			if (!cleanTitle) return null;
			const live = sessions.get(sessionId);
			if (live) {
				await live.rename(cleanTitle);
				return live.meta;
			}
			const meta = (await store.listSessions()).find((s) => s.id === sessionId);
			if (!meta) return null;
			const renamed = await store.append(meta, { type: "title", title: cleanTitle });
			// Same flag the live path sets, or the name is lost to the first prompt after this
			// session is woken up. See `SessionMeta.titleSetByUser`.
			const updated = renamed.titleSetByUser
				? renamed
				: await store.append(renamed, { type: "meta", meta: { ...renamed, titleSetByUser: true } });
			broadcast(sessionId, { type: "title", title: cleanTitle });
			return updated;
		},
	);

	ipcMain.handle(
		"sessions:setArchived",
		async (_event, projectId: string, sessionId: string, archived: boolean) => {
			// An archived session has no reason to keep its MCP servers and browser alive.
			if (archived) await disposeSession(sessionId);
			await store.setArchived(projectId, sessionId, archived);
			return store.listSessions();
		},
	);

	ipcMain.handle("sessions:removeArchived", async () => {
		const archived = (await store.listSessions()).filter((s) => s.archived);
		await Promise.all(archived.map((s) => disposeSession(s.id)));
		await store.deleteMany(
			archived.map((s) => ({ projectId: s.projectId, id: s.id })),
		);
		await Promise.all(
			archived.map((s) => removeSessionArtifacts(lyraHome(), s.id)),
		);
		return store.listSessions();
	});

	/*
	 * Starts the agent if it is not up yet, which is a real cost — skills, plugins, MCP child
	 * processes — paid to answer a question about token counts.
	 *
	 * Worth it because clicking this is deliberate, and because the alternative is worse: opening
	 * a session only reads its transcript, so on any conversation you have not yet written to,
	 * the breakdown would be permanently empty. A panel that is blank exactly when you go looking
	 * is not a cheaper panel, it is a broken one. Anyone opening it is about to use this session
	 * anyway, so the agent it warms is one that was going to start moments later regardless.
	 */
	ipcMain.handle(
		"sessions:contextBreakdown",
		async (_event, sessionId: string): Promise<ContextBreakdown | null> => {
			const session = await ensureSession(sessionId);
			return session ? session.contextBreakdown() : null;
		},
	);

	/**
	 * Summarise the conversation on request, rather than waiting for it to fill up.
	 *
	 * Answers with why it declined rather than with a bare false: "too short", "still running" and
	 * "the summariser is unreachable" all mean different things to whoever just typed `/compact`.
	 */
	ipcMain.handle("sessions:compact", async (_event, sessionId: string) => {
		/*
		 * Bring the session up if it is not already, rather than refusing.
		 *
		 * Clicking a conversation reads its transcript and deliberately does *not* start an agent
		 * for it — that costs a second of loading skills and spawning MCP servers, and "let me see
		 * what this said" should not pay it. Which left `/compact` looking at `sessions` and finding
		 * nothing, so a conversation the user was plainly looking at answered 「这个会话还没打开」.
		 *
		 * `ensureLiveSession` is the entry point for exactly this — running something on a
		 * conversation as opposed to reading it. Compaction is a model call either way, so the
		 * activation it may have to do first is not the expensive part.
		 */
		const session = await ensureLiveSession(sessionId);
		if (!session) return { ok: false as const, reason: "找不到这个会话。" };
		return session.compact();
	});

	ipcMain.handle(
		"sessions:capabilities",
		async (_event, sessionId: string): Promise<AgentCapabilities | null> => {
			const session = sessions.get(sessionId);
			if (!session) return null;
			touchSession(sessionId);
			const status = await session.status();
			return {
				skills: status.skills,
				skillDiagnostics: status.skillDiagnostics,
				plugins: status.plugins,
				pluginDiagnostics: status.pluginDiagnostics,
				mcp: status.mcp,
				agents: status.agents.map((a) => ({
					name: a.name,
					description: a.description,
					source: a.source,
					tools: a.tools,
				})),
				toolNames: status.toolNames,
			};
		},
	);

	ipcMain.handle(
		"agent:prompt",
		async (
			_event,
			sessionId: string,
			content: UserContent[],
			options?: { synthetic?: boolean; deliver?: "steer" | "followUp" },
		) => {
			const session = await ensureSession(sessionId);
			if (!session) throw new Error(`Session ${sessionId} is not open.`);
			// Deliberately not awaited: the turn streams events back over IPC and can run for minutes.
			void session.prompt(content, options).catch((error: unknown) => {
				broadcast(sessionId, {
					type: "notice",
					level: "error",
					message: error instanceof Error ? error.message : String(error),
				});
				broadcast(sessionId, {
					type: "agent_end",
					reason: "error",
					error: String(error),
				});
			});
		},
	);

	/*
	 * Sub-agents: read one, or reach into a running one.
	 *
	 * The roster arrives over `agent:event` like everything else — it is an `AgentEvent`, so a
	 * window already receiving events is already in step. Only these three need asking for: the
	 * transcript is too big to broadcast on every tool call, and the other two are actions.
	 */
	ipcMain.handle("subagents:detail", async (_event, sessionId: string, id: string) => {
		const session = sessions.get(sessionId);
		return session?.subAgents.detail(id) ?? null;
	});

	ipcMain.handle("subagents:list", async (_event, sessionId: string) => {
		const session = sessions.get(sessionId);
		return session?.subAgents.list() ?? [];
	});

	ipcMain.handle("subagents:steer", async (_event, sessionId: string, id: string, text: string) => {
		const session = sessions.get(sessionId);
		return session?.steerSubAgent(id, text) ?? false;
	});

	ipcMain.handle("subagents:abort", async (_event, sessionId: string, id: string) => {
		const session = sessions.get(sessionId);
		return session?.abortSubAgent(id) ?? false;
	});

	ipcMain.handle("subagents:dismiss", async (_event, sessionId: string, id: string) => {
		const session = sessions.get(sessionId);
		return session?.dismissSubAgent(id) ?? "unknown";
	});

	ipcMain.handle("subagents:dismissFinished", async (_event, sessionId: string) => {
		const session = sessions.get(sessionId);
		return session?.dismissFinishedSubAgents() ?? 0;
	});

	ipcMain.handle(
		"agent:editMessage",
		async (
			_event,
			sessionId: string,
			messageIndex: number,
			content: UserContent[],
		) => {
			const session = await ensureSession(sessionId);
			if (!session) throw new Error(`Session ${sessionId} is not open.`);
			// Not awaited, same as `prompt`: the re-run streams back over IPC and can take minutes.
			void session
				.editAndResend(messageIndex, content)
				.catch((error: unknown) => {
					broadcast(sessionId, {
						type: "notice",
						level: "error",
						message: error instanceof Error ? error.message : String(error),
					});
					broadcast(sessionId, {
						type: "agent_end",
						reason: "error",
						error: String(error),
					});
				});
		},
	);

	ipcMain.handle("agent:abort", async (_event, sessionId: string) => {
		sessions.get(sessionId)?.abort();
	});

	ipcMain.handle(
		"agent:approve",
		async (
			_event,
			sessionId: string,
			requestId: string,
			decision: ApprovalDecision,
		) => {
			const session = sessions.get(sessionId);
			if (!session) return;
			session.resolveApproval(requestId, decision);
			if (decision === "always") {
				const request = session
					.listPendingApprovals()
					.find((p) => p.id === requestId);
				const settings = readSettings();
				if (
					request &&
					!settings.alwaysAllow.includes(request.request.subject)
				) {
					await saveSettings({
						...settings,
						alwaysAllow: [...settings.alwaysAllow, request.request.subject],
					});
				}
			}
		},
	);

	ipcMain.handle(
		"agent:setModel",
		async (_event, sessionId: string, modelId: string) => {
			const live = sessions.get(sessionId);
			if (live) {
				// Returns false once the conversation has started; the model is settled by then.
				await live.setModel(modelId);
				return;
			}
			// Not warm: write the choice straight to the log rather than starting an agent for it.
			// The same rule applies — a stored session with messages keeps the model it ran on.
			const meta = (await store.listSessions()).find((s) => s.id === sessionId);
			if (meta && meta.messageCount === 0)
				await store.append(meta, { type: "meta", meta: { ...meta, modelId } });
		},
	);

	/*
	 * The conversation's own reasoning level.
	 *
	 * Unlike the model there is nothing to settle: no stored message carries a handle that a
	 * different level would invalidate, so this is accepted at any point in any conversation —
	 * including one that has not been started yet, where the choice is written straight to the log
	 * rather than booting an agent to hold it.
	 *
	 * `null` hands the conversation back to the app default. See `Session.setThinking`.
	 */
	ipcMain.handle(
		"agent:setThinking",
		async (_event, sessionId: string, thinking: ThinkingLevel | null) => {
			const live = sessions.get(sessionId);
			if (live) {
				await live.setThinking(thinking);
				return;
			}
			const meta = (await store.listSessions()).find((s) => s.id === sessionId);
			if (!meta) return;
			// Present-and-undefined rather than absent; see the note in `Session.setThinking`.
			const next: SessionMeta = { ...meta, thinking: thinking ?? undefined };
			await store.append(meta, { type: "meta", meta: next });
		},
	);
}
