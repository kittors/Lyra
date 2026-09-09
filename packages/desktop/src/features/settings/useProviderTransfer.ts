/**
 * The provider list leaving as a file, and coming back as one.
 *
 * Separate from `useProviders` because it is a different question. That file is "what does editing
 * a provider mean"; this one is "what does it mean to carry the whole list to another machine" —
 * and its consequences are its own: a download that is worth stealing, and a file whose contents
 * this program did not write.
 *
 * Nothing is written to settings until the plan has been shown and confirmed. `planImport` works
 * out what each entry would do, the modal shows it, and only the entries that come back from there
 * are merged.
 */

import { useState } from "react";
import type { ProviderConfig } from "@lyra/core";
import type { MessageKey } from "../../i18n/messages/index.ts";
import { translate } from "../../i18n/translate.ts";
import { useApp } from "../../store/index.ts";
import {
	applyImport,
	bundleFileName,
	buildBundle,
	parseBundle,
	planImport,
	serializeBundle,
	type BundleProblem,
	type ImportEntry,
} from "./provider-transfer.ts";

const PROBLEM_MESSAGE: Record<BundleProblem, MessageKey> = {
	"not-json": "providerTransfer.errorNotJson",
	"not-a-bundle": "providerTransfer.errorNotBundle",
	"too-new": "providerTransfer.errorTooNew",
	"no-providers": "providerTransfer.errorNoProviders",
};

export function useProviderTransfer() {
	const settings = useApp((s) => s.settings);
	const saveSettings = useApp((s) => s.saveSettings);
	const notify = useApp((s) => s.notify);
	const [pending, setPending] = useState<{ entries: ImportEntry[]; dropped: number } | null>(null);
	/**
	 * How many imports have landed, for a form that has to be rebuilt rather than re-rendered.
	 *
	 * An import replaces a provider under the id it already had, so every key React could see is
	 * unchanged — and the editor's text fields take their value on mount. Counting the imports gives
	 * the page something that does change. See where it is used in `ModelSettings`.
	 */
	const [imports, setImports] = useState(0);
	const providers = settings?.providers ?? [];

	/**
	 * Write the file.
	 *
	 * Called only after the caller has asked — the warning belongs at the click, where it can still
	 * be answered with "no", rather than here where the only thing left to do is write.
	 */
	function exportAll() {
		const bundle = buildBundle(providers);
		const url = URL.createObjectURL(new Blob([serializeBundle(bundle)], { type: "application/json" }));
		const link = document.createElement("a");
		link.href = url;
		link.download = bundleFileName();
		link.click();
		// Revoked on the next tick: the click is synchronous, but the download that follows it is not.
		setTimeout(() => URL.revokeObjectURL(url), 10_000);
		notify(
			translate(bundle.containsSecrets ? "providerTransfer.exportedWithKeys" : "providerTransfer.exported", {
				n: bundle.providers.length,
			}),
			bundle.containsSecrets ? "warn" : "info",
		);
	}

	/** Read a chosen file and, if it is one of ours, work out what importing it would do. */
	async function offer(file: File) {
		const parsed = parseBundle(await file.text().catch(() => ""));
		if (!parsed.ok) {
			notify(translate(PROBLEM_MESSAGE[parsed.problem]), "error");
			return;
		}
		setPending({ entries: planImport(parsed.bundle.providers, providers), dropped: parsed.dropped });
	}

	async function confirmImport(chosen: ProviderConfig[]) {
		setPending(null);
		if (!settings || chosen.length === 0) return;
		const merged = applyImport(settings.providers, chosen, settings.defaultModelId ?? null);
		await saveSettings({ ...settings, ...merged });
		setImports((count) => count + 1);
		notify(translate("providerTransfer.imported", { n: chosen.length }));
	}

	return {
		pending,
		imports,
		exportAll,
		offer,
		confirmImport,
		cancelImport: () => setPending(null),
		/** Nothing to write out, so the control that would write it has nothing to do. */
		canExport: providers.length > 0,
	};
}
