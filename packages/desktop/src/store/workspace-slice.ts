/**
 * Which project the app is pointed at.
 *
 * Opening a workspace is not just a path: it decides which sessions are listed, which paths every
 * guard will accept, and what the sidebar shows. So these actions all end by refreshing the same
 * few pieces of state, and they are together because forgetting one of them is the bug.
 */

import type { SessionMeta } from "@lyra/core";
import type { AppState } from "./index.ts";
import { useSubAgents } from "./subAgents.ts";
import { bridge } from "../services/index.ts";

type Get = () => AppState;
type Set = (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void;

export function workspaceSlice(set: Set, get: Get) {
  return {
  async pickWorkspace() {
    const workspace = await bridge.workspace.pick();
    if (!workspace) return;
    await get().openWorkspace(workspace.path);
  },

  async openWorkspace(path: string) {
    const workspace = await bridge.workspace.info(path);
    if (!workspace) return;

    /*
     * On screen first, remembered second.
     *
     * The project list is written to disk and broadcast to every window, and none of that is
     * anything the person who just picked a folder is waiting to see. Awaiting it before touching
     * state meant the sidebar, the composer's chip and the panels all stayed on the *previous*
     * project until the write came back — a visible pause on the one click whose entire content is
     * "show me this one now".
     */
    set({
      // Leaving the project-less mode: a session opened from here belongs to the project.
      scratchCwd: null,
      workspace,
      activeSessionId: null,
      meta: null,
      messages: [],
      toolRuns: {},
      approvals: [],
      loadingSession: false,
      pendingUserMessage: null,
    });
    useSubAgents.getState().clear();

    const settings = get().settings;
    if (!settings) return;
    const projects = settings.projects.filter((p) => p.path !== path);
    await get().saveSettings({
      ...settings,
      projects: [
        {
          id: path,
          name: workspace.name,
          path,
          pinned: settings.projects.find((p) => p.path === path)?.pinned ?? false,
          lastOpenedAt: Date.now(),
        },
        ...projects,
      ],
    });
  },

  setSwitchingBranch(switchingBranch: string | null) {
    set({ switchingBranch });
  },

  async refreshWorkspace() {
    const current = get().workspace;
    if (!current) return;
    const workspace = await bridge.workspace.info(current.path);
    if (workspace) set({ workspace });
  },

  /**
   * 「不在项目中工作」 — which now means something rather than nothing.
   *
   * It used to only blank the workspace, and since sending required one, the next message opened
   * a directory picker: the menu item took you somewhere you could not do anything. Pointing it at
   * a scratch directory is what makes it a mode instead of a dead end.
   */
  /**
   * The sidebar switched halves on a window with nothing open — see `adoptSidebarTab` in `store.ts`
   * for why this only ever fires then.
   */
  async adoptSidebarTab(tab: "projects" | "chats") {
    const { activeSessionId, messages, workspace, parkedProject } = get();
    // A conversation with anything in it stays exactly as it is.
    if (activeSessionId || messages.length > 0) return;

    if (tab === "chats") {
      // Already there. A fresh install has neither a project nor a scratch directory, which is not
      // the same thing and is the case this was reported on: 「聊天」 over an empty list, and a
      // composer still asking which project to pick.
      if (!workspace && get().scratchCwd) return;
      if (workspace) set({ parkedProject: workspace.path });
      await get().clearWorkspace();
      return;
    }

    // Already in one, and 「项目」 is where it belongs.
    if (workspace) return;

    if (parkedProject) {
      // Back to whichever project 「聊天」 took the window away from.
      await get().openWorkspace(parkedProject);
      set({ parkedProject: null });
      return;
    }

    /*
     * And with nothing to go back to, back to *not having chosen one* — which is a state, not a
     * gap, and the one 「项目」 is about.
     *
     * This used to leave the chat where it was, on the reasoning that there is no sensible project
     * to invent for a window that has never opened one. True, and beside the point: nothing is
     * being invented here. The composer says 「选择项目」 and 新对话 opens the picker, which is
     * exactly the unfinished step someone in this half of the sidebar is standing in front of.
     * Leaving it saying 「Chat」 meant the two halves disagreed about which mode the window was in,
     * and the one that was wrong was the one being looked at.
     */
    if (get().scratchCwd) set({ scratchCwd: null });
  },

  async clearWorkspace() {
    const scratchCwd = await bridge.git.generalScratch().catch(() => null);
    set({
      scratchCwd,
      workspace: null,
      activeSessionId: null,
      meta: null,
      messages: [],
      toolRuns: {},
      approvals: [],
      loadingSession: false,
      pendingUserMessage: null,
    });
    useSubAgents.getState().clear();
  },

  async renameProject(path: string, name: string) {
    const settings = get().settings;
    const trimmed = name.trim();
    if (!settings || !trimmed) return;
    await get().saveSettings({
      ...settings,
      projects: settings.projects.map((p) =>
        p.path === path ? { ...p, name: trimmed } : p,
      ),
    });
    // The header reads the workspace, not the project list, so it needs telling separately.
    const workspace = get().workspace;
    if (workspace?.path === path)
      set({ workspace: { ...workspace, name: trimmed } });
  },

  async setProjectPinned(path: string, pinned: boolean) {
    const settings = get().settings;
    if (!settings) return;
    await get().saveSettings({
      ...settings,
      projects: settings.projects.map((p) =>
        p.path === path ? { ...p, pinned } : p,
      ),
    });
  },

  async setSessionPinned(sessionId: string, pinned: boolean) {
    const settings = get().settings;
    if (!settings) return;
    const current = new Set(settings.pinnedSessionIds ?? []);
    if (pinned) {
      current.add(sessionId);
    } else {
      current.delete(sessionId);
    }
    await get().saveSettings({
      ...settings,
      pinnedSessionIds: Array.from(current),
    });
  },

  /**
   * Rename a conversation: on screen at once, on disk right after.
   *
   * Painted first because the list should not stutter while a round trip happens, and replaced
   * with what came back because the main process is the authority on the rest of the meta.
   */
  async renameSession(session: SessionMeta, title: string) {
    const trimmed = title.trim();
    if (!trimmed) return;
    const previous = session.title;
    set({
      sessions: get().sessions.map((s) => (s.id === session.id ? { ...s, title: trimmed } : s)),
      ...(get().activeSessionId === session.id && get().meta ? { meta: { ...get().meta!, title: trimmed } } : {}),
    });
    try {
      const updated = await bridge.sessions.rename(session.projectId, session.id, trimmed);
      if (updated) {
        set({
          sessions: get().sessions.map((s) => (s.id === session.id ? { ...s, ...updated } : s)),
          ...(get().activeSessionId === session.id && get().meta ? { meta: { ...get().meta!, ...updated } } : {}),
        });
      }
    } catch {
      /*
       * Put the old name back and say so.
       *
       * Swallowing this left the new name on screen over a session still called the old thing on
       * disk — the rename looked like it had worked, and the next reload was where you found out.
       * A name that reverts in front of you is not a good outcome either, but it is an honest one.
       */
      set({
        sessions: get().sessions.map((s) => (s.id === session.id ? { ...s, title: previous } : s)),
        ...(get().activeSessionId === session.id && get().meta ? { meta: { ...get().meta!, title: previous } } : {}),
      });
      get().notify("改名没能存下来，已经改回原来的名字。", "error");
    }
  },

  async moveSessionProject(session: SessionMeta, targetPath: string) {
    const targetProject = get().settings?.projects.find((p) => p.path === targetPath);
    const segments = targetPath.split(/[/\\]/);
    const lastSegment = segments.length > 0 ? segments[segments.length - 1] : "";
    const projectName = targetProject?.name ?? (lastSegment || "项目");
    // In our sessions metadata, cwd and projectName determine where it is filed.
    // If targetPath is empty, it moves to loose/scratch.
    const isLoose = !targetPath;
    const nextCwd = isLoose ? (get().scratchRoots[0] ?? session.cwd) : targetPath;
    const nextProjectId = isLoose ? "" : targetProject?.id ?? session.projectId;
    const nextProjectName = isLoose ? "Chat" : projectName;

    set({
      sessions: get().sessions.map((s) =>
        s.id === session.id
          ? {
              ...s,
              cwd: nextCwd,
              projectId: nextProjectId,
              projectName: nextProjectName,
            }
          : s,
      ),
      ...(get().activeSessionId === session.id && get().meta
        ? {
            meta: {
              ...get().meta!,
              cwd: nextCwd,
              projectId: nextProjectId,
              projectName: nextProjectName,
            },
          }
        : {}),
    });
    get().notify(`已将对话移动至「${nextProjectName}」`);
  },

  async removeProject(path: string) {
    const settings = get().settings;
    if (!settings) return;
    // Only the entry goes. The sessions and the directory itself are left alone — this is
    // "stop listing this", not "delete my work".
    await get().saveSettings({
      ...settings,
      projects: settings.projects.filter((p) => p.path !== path),
    });
    if (get().workspace?.path === path) void get().clearWorkspace();
  },

  async archiveProjectSessions(path: string) {
    const targets = get().sessions.filter((s) => s.cwd === path && !s.archived);
    if (targets.length === 0) return;
    set({
      sessions: get().sessions.map((s) =>
        s.cwd === path && !s.archived ? { ...s, archived: true } : s,
      ),
    });
    if (targets.some((s) => s.id === get().activeSessionId)) {
      set({
        activeSessionId: null,
        meta: null,
        messages: [],
        toolRuns: {},
        approvals: [],
        loadingSession: false,
        pendingUserMessage: null,
      });
      useSubAgents.getState().clear();
    }
    // Sequential rather than parallel: each call rewrites the shared session index.
    let latest = get().sessions;
    for (const session of targets) {
      latest = await bridge.sessions.setArchived(
        session.projectId,
        session.id,
        true,
      );
    }
    set({ sessions: latest });
    get().notify(`已归档 ${targets.length} 个聊天`);
  },
  };
}

