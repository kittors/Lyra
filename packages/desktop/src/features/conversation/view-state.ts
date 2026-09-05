import { useState } from "react";
import { useApp } from "../../store/index.ts";

interface TranscriptView {
	windowSize?: number;
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

export function useTranscriptWindow(id: string | null, step: number): [number, () => void] {
	const view = id ? viewFor(id) : undefined;
	const [local, setLocal] = useState({ id, size: view?.windowSize ?? step });
	const size = local.id === id ? local.size : (view?.windowSize ?? step);
	return [
		size,
		() => {
			if (id) viewFor(id).windowSize = size + step;
			setLocal({ id, size: size + step });
		},
	];
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
