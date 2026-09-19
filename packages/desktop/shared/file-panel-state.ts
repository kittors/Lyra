/** Editable state crosses windows; disk contents and permissions are read by the receiving host. */
export interface FilePanelState {
	path: string | null;
	tabs: { path: string; name: string }[];
	drafts: Record<string, string>;
	wrap: boolean;
	showSource: boolean;
}

export interface FilePanelVersion {
	version: number;
	state: FilePanelState;
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && !value.includes("\0");
}

export function readFilePanelState(value: unknown): FilePanelState | null {
	if (!record(value) || !Array.isArray(value.tabs) || !record(value.drafts)) return null;
	if (value.path !== null && !text(value.path)) return null;
	if (typeof value.wrap !== "boolean" || typeof value.showSource !== "boolean") return null;
	const tabs: FilePanelState["tabs"] = [];
	const paths = new Set<string>();
	for (const tab of value.tabs) {
		if (!record(tab) || !text(tab.path) || !text(tab.name) || paths.has(tab.path)) return null;
		paths.add(tab.path);
		tabs.push({ path: tab.path, name: tab.name });
	}
	if (value.path !== null && !paths.has(value.path)) return null;
	const drafts: [string, string][] = [];
	for (const [path, draft] of Object.entries(value.drafts)) {
		if (!paths.has(path) || typeof draft !== "string") return null;
		drafts.push([path, draft]);
	}
	return { path: value.path, tabs, drafts: Object.fromEntries(drafts), wrap: value.wrap, showSource: value.showSource };
}

/** Opening from the source must not resurrect a draft already saved in the detached editor. */
export function requestFilePanel(current: FilePanelState, requested: FilePanelState): FilePanelState {
	const known = new Set(current.tabs.map((tab) => tab.path));
	return {
		...current,
		path: requested.path ?? current.path,
		tabs: [...current.tabs, ...requested.tabs.filter((tab) => !known.has(tab.path))],
		drafts: { ...Object.fromEntries(Object.entries(requested.drafts).filter(([path]) => !known.has(path))), ...current.drafts },
		showSource: requested.path === current.path ? current.showSource : requested.showSource,
	};
}

/** Apply only this host's changes, retaining tabs and drafts another host changed meanwhile. */
export function mergeFilePanelChanges(before: FilePanelState, next: FilePanelState, current: FilePanelState): FilePanelState {
	const oldPaths = new Set(before.tabs.map((tab) => tab.path));
	const nextPaths = new Set(next.tabs.map((tab) => tab.path));
	const tabs = current.tabs.filter((tab) => !oldPaths.has(tab.path) || nextPaths.has(tab.path) || current.drafts[tab.path] !== before.drafts[tab.path]);
	const kept = new Set(tabs.map((tab) => tab.path));
	for (const tab of next.tabs) if (!kept.has(tab.path)) tabs.push(tab);
	const drafts = { ...current.drafts };
	for (const path of new Set([...Object.keys(before.drafts), ...Object.keys(next.drafts)])) {
		if (before.drafts[path] === next.drafts[path]) continue;
		if (next.drafts[path] !== undefined) drafts[path] = next.drafts[path];
		else if (drafts[path] === before.drafts[path]) delete drafts[path];
	}
	const path = current.path === before.path ? next.path : current.path;
	return {
		path: tabs.some((tab) => tab.path === path) ? path : next.path,
		tabs,
		drafts,
		wrap: current.wrap === before.wrap ? next.wrap : current.wrap,
		showSource: current.showSource === before.showSource ? next.showSource : current.showSource,
	};
}
