import { useState } from "react";
import { useApp } from "../../store/index.ts";

interface TranscriptView {
	windowSize?: number;
	windowEnd?: number;
	expanded: Set<string>;
}

// Keep presentation state without retaining the transcript's DOM or message payloads.
const views = new Map<string, TranscriptView>();
const LIMIT = 12;

function viewFor(id: string): TranscriptView {
	const view = views.get(id) ?? { expanded: new Set<string>() };
	views.delete(id);
	views.set(id, view);
	while (views.size > LIMIT) {
		const oldest = views.keys().next();
		if (!oldest.done) views.delete(oldest.value);
	}
	return view;
}

export function useTranscriptWindow(id: string | null, step: number, total: number) {
	const view = id ? viewFor(id) : undefined;
	const [local, setLocal] = useState({ id, size: view?.windowSize ?? step, end: view?.windowEnd });
	const current = local.id === id ? local : { size: view?.windowSize ?? step, end: view?.windowEnd };
	const end = Math.min(total, current.end ?? total);
	const start = Math.max(0, end - current.size);
	const update = (size: number, end?: number) => {
		if (id) Object.assign(viewFor(id), { windowSize: size, windowEnd: end });
		setLocal({ id, size, end });
	};
	return {
		start, end,
		earlier: () => update(current.size + step, current.end),
		later: () => update(current.size + step, end + step >= total ? undefined : end + step),
		// Jump to the tail without throwing away turns the reader already mounted. Resetting
		// `size` to `step` is what made sending a message unmount the top of a long transcript
		// and drop the viewport by a few hundred pixels before the glide back down.
		latest: () => update(Math.max(step, current.size), undefined),
		reveal: (index: number) => {
			if (index >= start && index < end) return;
			// Jumping to an old question must not mount every message between it and the tail.
			const nextEnd = Math.min(total, Math.max(step, index + step - 5));
			update(step, nextEnd === total ? undefined : nextEnd);
		},
	};
}

export function useTranscriptDisclosure(key?: string): [boolean, (update: (open: boolean) => boolean) => void] {
	const id = useApp((s) => (key ? s.activeSessionId : null));
	const [local, setLocal] = useState({ id, key, open: Boolean(id && key && views.get(id)?.expanded.has(key)) });
	const open =
		local.id === id && local.key === key ? local.open : Boolean(id && key && views.get(id)?.expanded.has(key));
	return [
		open,
		(update) => {
			const next = update(open);
			if (id && key) {
				const view = viewFor(id);
				if (next) view.expanded.add(key);
				else view.expanded.delete(key);
			}
			setLocal({ id, key, open: next });
		},
	];
}
