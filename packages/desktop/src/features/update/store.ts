/**
 * What the app knows about updates, held once for the whole window.
 *
 * This was a hook with two `useEffect`s inside the badge, which was right while the badge was the
 * only thing drawing an update. It is not any more: 设置 → 关于 shows the same version, the same
 * download and the same buttons, and the moment there were two of them the hook meant two of
 * everything — two six-hourly checks, two `onProgress` subscriptions, and two copies of `info`
 * that drift apart the instant one of them rechecks. Two surfaces disagreeing about which version
 * is available is not a rendering bug anyone would find by reading either component.
 *
 * So the state is module-level and the components subscribe. `phase` is not really owned here at
 * all — it belongs to the main process, and this is a cache of what it last said.
 */

import { useSyncExternalStore } from "react";

import type { Phase } from "./view.ts";
import { bridge } from "../../services/index.ts";

export type Info = Awaited<ReturnType<typeof bridge.updates.check>>;

export interface UpdateState {
	info: Info | null;
	phase: Phase;
	/** A check the user asked for, so a button can say it is doing something. Not the timed ones. */
	checking: boolean;
}

/** Default interval in hours for checking updates in background. */
const DEFAULT_INTERVAL_HOURS = 6;

/*
 * One object per change, never mutated.
 *
 * `useSyncExternalStore` compares snapshots by identity and will loop forever if `getSnapshot`
 * returns something new each call — so this is a field that is replaced, not a value that is built.
 */
let snapshot: UpdateState = { info: null, phase: { at: "idle" }, checking: false };

const listeners = new Set<() => void>();

function set(next: Partial<UpdateState>): void {
	snapshot = { ...snapshot, ...next };
	for (const listener of listeners) listener();
}

/**
 * Ask the main process what the newest release is.
 *
 * `force` skips its half-hour cache, and is what 检查更新 passes: a person who presses a button
 * labelled "check" and is handed a cached answer has been told nothing, whatever the answer says.
 */
export async function check(force = false): Promise<void> {
	if (force) set({ checking: true });
	try {
		const info = await bridge.updates.check(force);
		set({ info });
	} catch {
		// The check is the app's business; its failure is not the user's. Offline is a normal answer.
	} finally {
		if (force) set({ checking: false });
	}
}

let started = false;
let checkTimer: number | null = null;

export function restartCheckTimer(intervalHours = 6): void {
	if (checkTimer !== null) {
		window.clearInterval(checkTimer);
	}
	const ms = Math.max(1, intervalHours) * 60 * 60 * 1000;
	checkTimer = window.setInterval(() => void check(), ms);
}

/**
 * Begin watching, once per window however many components ask.
 *
 * The first subscriber starts it and nothing stops it: the timer and the IPC subscription are for
 * as long as the window lives, and tearing them down when the last component unmounts would mean a
 * download running with nobody listening — which is the state this whole feature exists to avoid.
 */
function start(): void {
	if (started) return;
	started = true;

	void check();
	restartCheckTimer(DEFAULT_INTERVAL_HOURS);

	/*
	 * Asked once, because a download already in progress emits nothing until its next chunk — and a
	 * *paused* one emits nothing ever, since only the user resumes it. A window that opened
	 * mid-download and only listened would draw an idle badge over a running download.
	 */
	void bridge.updates
		.state?.()
		.then((phase) => set({ phase }))
		.catch(() => {});
	bridge.updates.onProgress((phase) => set({ phase }));
}

function subscribe(listener: () => void): () => void {
	start();
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** Everything the badge, the dialog and 设置 → 关于 draw, from the one place that holds it. */
export function useUpdate(): UpdateState {
	return useSyncExternalStore(subscribe, () => snapshot);
}
