import { mergeFilePanelChanges, type FilePanelState, type FilePanelVersion } from "../../shared/file-panel-state.ts";
import { bridge } from "../services/index.ts";
import { useOpenFile } from "./openFile.ts";

export function filePanelSnapshot(): FilePanelState {
	const { path, opening, tabs, drafts, wrap, showSource } = useOpenFile.getState();
	return { path: opening ?? path, tabs, drafts, wrap, showSource };
}

/** Load through the normal file boundary rather than trusting transferred contents or permissions. */
export async function applyFilePanelState(state: FilePanelState, update = (apply: () => void) => apply()): Promise<void> {
	const current = useOpenFile.getState();
	const tab = state.tabs.find((entry) => entry.path === state.path);
	const saved = state.path !== null && current.drafts[state.path] !== undefined && state.drafts[state.path] === undefined;
	const needsRead = state.path !== current.path || !current.contents || saved;
	update(() => useOpenFile.setState({
		tabs: state.tabs, drafts: state.drafts, wrap: state.wrap, showSource: state.showSource,
		...(tab && needsRead ? { opening: tab.path, loading: true } : {}),
		...(!tab ? { path: null, name: null, contents: null, opening: null, loading: false } : {}),
	}));
	if (!tab || !needsRead) return;
	try {
		const contents = await bridge.files.read(tab.path);
		if (useOpenFile.getState().opening !== tab.path) return;
		update(() => useOpenFile.setState({ path: tab.path, name: tab.name, contents, opening: null, loading: false }));
	} catch (error) {
		if (useOpenFile.getState().opening === tab.path) update(() => useOpenFile.setState({ opening: null, loading: false }));
		throw error;
	}
}

let flushPending: () => Promise<void> = async () => {};

/** The return button waits for the last edit's acknowledgement before requesting its handoff. */
export function flushFilePanelState(): Promise<void> {
	return flushPending();
}

export function watchFilePanelState(onError: (error: unknown) => void): () => void {
	if (!bridge.windows?.onFilePanelState) return () => {};
	const detached = bridge.bootWindow?.kind === "panel" && bridge.bootWindow.panelKind === "file";
	let live = true;
	let applying = false;
	let confirmed: FilePanelVersion | null = null;
	let pending: Promise<void> | null = null;
	const quietly = (apply: () => void) => {
		applying = true;
		try { apply(); } finally { applying = false; }
	};
	const apply = (state: FilePanelState) => applyFilePanelState(state, quietly).catch(onError);
	const same = (a: FilePanelState, b: FilePanelState) => JSON.stringify(a) === JSON.stringify(b);
	const sync = (): Promise<void> => {
		if (pending) return pending;
		pending = (async () => {
			while (confirmed) {
				if (!live) break;
				const base = confirmed;
				const state = filePanelSnapshot();
				if (same(state, base.state)) break;
				const reply = await bridge.windows.filePanelState({ version: base.version, state });
				if (!reply) throw new Error("File panel state handoff was rejected");
				if (!live) break;
				// A newer open request can overtake an edit acknowledgement. Rebase only our delta.
				if (confirmed.version > reply.version) continue;
				const accepted = reply.version === base.version + 1 && same(reply.state, state);
				const next = mergeFilePanelChanges(accepted ? state : base.state, filePanelSnapshot(), reply.state);
				confirmed = reply;
				await apply(next);
			}
		})().finally(() => { pending = null; });
		return pending;
	};
	const receive = async (input: FilePanelVersion & { previous?: FilePanelState }) => {
		if (!live) return;
		if (!detached) {
			if (input.previous) await apply(mergeFilePanelChanges(input.previous, input.state, filePanelSnapshot()));
			return;
		}
		if (confirmed && input.version <= confirmed.version) return;
		const next = confirmed ? mergeFilePanelChanges(confirmed.state, filePanelSnapshot(), input.state) : input.state;
		confirmed = input;
		await apply(next);
		if (live) await sync();
	};
	const stopEvent = bridge.windows.onFilePanelState((input) => { void receive(input).catch(onError); });
	const stopStore = detached ? useOpenFile.subscribe(() => {
		if (!applying && confirmed) void sync().catch(onError);
	}) : () => {};
	if (detached) {
		flushPending = sync;
		void bridge.windows.filePanelState().then((state) => state && receive(state)).catch(onError);
	}
	return () => {
		live = false;
		stopEvent();
		stopStore();
		if (detached) flushPending = async () => {};
	};
}
