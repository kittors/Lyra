import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { createElement as h } from "react";
import { DEFAULT_SETTINGS, type SessionMeta, type Settings } from "@lyra/core";
import { LayoutProvider } from "../../src/app/layout.tsx";
import { useApp } from "../../src/store/index.ts";
import { groupSessions } from "../../src/features/sidebar/grouping.ts";
import { ProjectHead } from "../../src/features/sidebar/ProjectHead.tsx";
import { SessionRow } from "../../src/features/sidebar/SessionRow.tsx";
import { SidebarReorderContext } from "../../src/features/sidebar/reorder-context.ts";
import { useSidebarReorder } from "../../src/features/sidebar/useSidebarReorder.ts";
import { fire, mount, press } from "../helpers/mount.ts";

const usage = { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 } };
const session = (id: string, updatedAt: number, createdAt = updatedAt): SessionMeta => ({ id, title: id, cwd: "/a", projectId: "a", projectName: "A", createdAt, updatedAt, modelId: "", messageCount: 1, seq: 2, usage });
const sessions = [session("a", 30, 10), session("b", 20, 30), session("c", 10, 20)];
const projects = ["a", "b"].map((id) => ({ id, path: `/${id}`, name: id.toUpperCase(), pinned: false, lastOpenedAt: 0 }));
let saves: Settings[];
let opened: number;
let reordered: number;

beforeEach(() => {
	saves = []; opened = 0; reordered = 0;
	useApp.setState({ settings: { ...DEFAULT_SETTINGS, projects }, sessions, activity: {}, notices: [], activeSessionId: null });
	Object.defineProperty(window, "lyra", { configurable: true, value: {
		settings: { save: async (next: Settings) => { saves.push(next); return next; } },
		workspace: { info: async (path: string) => ({ path, name: "A", isGitRepo: false, branch: null }) },
	} });
});

function Harness({ enabled = true }: { enabled?: boolean }) {
	const settings = useApp((state) => state.settings);
	const groups = groupSessions(sessions, settings?.projects ?? [], "");
	const reorder = useSidebarReorder(groups, "updatedAt", enabled ? () => { reordered++; } : undefined);
	return h(SidebarReorderContext.Provider, { value: reorder.contextValue },
		h("output", null, reorder.dragging?.id ?? "idle"),
		h(ProjectHead, { group: groups.projects[0], active: false, collapsed: false, onToggleCollapsed: () => { opened++; } }),
		...sessions.map((item) => h(SessionRow, { key: item.id, session: item, onOpen: () => { opened++; }, onArchive: () => {} })),
	);
}
const view = (enabled = true) => mount(h(LayoutProvider, null, h(Harness, { enabled })));
const pointer = (type: string, y: number, options: PointerEventInit = {}) => new window.PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", button: 0, buttons: type === "pointerup" ? 0 : 1, clientX: 20, clientY: y, ...options });

async function drag(source: Element, target: Element) {
	await fire(source, pointer("pointerdown", 0));
	await fire(target, pointer("pointermove", 20));
}

test("first drag preserves the visible order of every unaffected session", async () => {
	await useApp.getState().reorderProjectSessions("/a", "a", "b", "after", "updatedAt");
	assert.deepEqual(saves[0].sessionOrder?.["/a"], ["b", "a", "c"]);
	assert.deepEqual(groupSessions(sessions, projects, "", [], [], saves[0].sessionOrder, "manual").projects[0].sessions.map((item) => item.id), ["b", "a", "c"]);
});

test("dragging from creation order ignores a dormant manual order", async () => {
	useApp.setState({ settings: { ...DEFAULT_SETTINGS, projects, sessionOrder: { "/a": ["a", "b", "c"] } } });
	await useApp.getState().reorderProjectSessions("/a", "b", "c", "after", "createdAt");
	assert.deepEqual(saves[0].sessionOrder?.["/a"], ["c", "b", "a"]);
});

test("store refuses cross-project, pinned, archived and missing drop targets", async () => {
	useApp.setState({ sessions: [sessions[0], { ...sessions[1], archived: true }, { ...sessions[2], cwd: "/b" }] });
	for (const target of ["b", "c", "missing"]) await useApp.getState().reorderProjectSessions("/a", "a", target, "after", "updatedAt");
	useApp.setState({ sessions, settings: { ...DEFAULT_SETTINGS, projects, pinnedSessionIds: ["b"] } });
	await useApp.getState().reorderProjectSessions("/a", "a", "b", "after", "updatedAt");
	await useApp.getState().reorderProjects("/a", "/missing", "after");
	useApp.setState({ settings: { ...DEFAULT_SETTINGS, projects: [projects[0], { ...projects[1], pinned: true }] } });
	await useApp.getState().reorderProjects("/a", "/b", "after");
	assert.equal(saves.length, 0);
});

test("opening a reordered project preserves its saved position", async () => {
	await useApp.getState().reorderProjects("/a", "/b", "after");
	await useApp.getState().openWorkspace("/a");
	assert.deepEqual(useApp.getState().settings?.projects.map((project) => project.path), ["/b", "/a"]);
});

test("pointer cancellation and Escape never persist a pending drop", async () => {
	const mounted = await view();
	try {
		const source = mounted.find('[data-ly-row="a"] > button');
		const target = mounted.find('[data-ly-row="b"]');
		await drag(source, target);
		assert.equal(mounted.find("output").textContent, "a");
		await fire(target, pointer("pointercancel", 20));
		assert.equal(mounted.find("output").textContent, "idle");
		assert.equal(saves.length, 0);
		await drag(source, target);
		await press(source, "Escape");
		await fire(target, pointer("pointerup", 20));
		assert.equal(saves.length, 0);
	} finally { await mounted.unmount(); }
});

test("a completed drag saves once and suppresses its synthetic row click only", async () => {
	const mounted = await view();
	try {
		const source = mounted.find('[data-ly-row="a"] > button');
		const target = mounted.find('[data-ly-row="b"]');
		await drag(source, target);
		await fire(target, new Event("scroll"));
		await fire(target, pointer("pointerup", 20));
		await fire(source, new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
		assert.equal(opened, 0);
		assert.equal(reordered, 1);
		assert.deepEqual(saves[0].sessionOrder?.["/a"], ["b", "a", "c"]);
		await fire(source, pointer("pointerdown", 0));
		await fire(source, pointer("pointerup", 0));
		await fire(source, new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
		assert.equal(opened, 1);
	} finally { await mounted.unmount(); }
});

test("auxiliary buttons, touch scrolling and the archive cannot start reordering", async () => {
	const mounted = await view();
	try {
		await drag(mounted.find('[aria-label="归档会话「a」"]'), mounted.find('[data-ly-row="b"]'));
		assert.equal(mounted.find("output").textContent, "idle");
		const source = mounted.find('[data-ly-row="a"] > button');
		await fire(source, pointer("pointerdown", 0, { pointerType: "touch" }));
		await fire(source, pointer("pointermove", 20, { pointerType: "touch" }));
		assert.equal(mounted.find("output").textContent, "idle");
		await mounted.rerender(h(LayoutProvider, null, h(Harness, { enabled: false })));
		await drag(mounted.find('[data-ly-row="a"] > button'), mounted.find('[data-ly-row="b"]'));
		assert.equal(mounted.find("output").textContent, "idle");
		assert.equal(saves.length, 0);
	} finally { await mounted.unmount(); }
});
