/**
 * 保险箱: the credentials kept on this computer, managed by hand.
 *
 * Added here or saved from a card in a conversation. A value goes in and never comes back to this
 * page: a row shows what a credential is and where it may be used, copies its reference — the
 * `[credential:name]` that hands it to a conversation — and copies its value to the clipboard through
 * the main process, which wipes it again (`credentials.copy`).
 *
 * A place of its own, like 创作: the sidebar folds away while it is up (`app/layout.tsx`).
 */

import type { CredentialMeta } from "@lyra/core";
import { Check, Copy, Plus, Quote, Vault } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLayout } from "../../app/layout.tsx";
import { useI18n } from "../../i18n/index.ts";
import { bridge } from "../../services/index.ts";
import { useApp } from "../../store/index.ts";
import { Button } from "../../ui/primitives/Button.tsx";
import { IconButton } from "../../ui/primitives/IconButton.tsx";
import { SkeletonList } from "../../ui/primitives/Skeleton.tsx";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { CredentialEditor } from "./CredentialEditor.tsx";
import { KIND_ICON, KIND_LABEL } from "./labels.ts";

/** How long a copy button shows its tick: long enough to see, shorter than "is it stuck". */
const TICK_MS = 1400;

export function VaultView() {
	const { t } = useI18n();
	const { compact } = useLayout();
	const here = useApp((state) => state.view === "vault");
	const [items, setItems] = useState<CredentialMeta[] | null>(null);
	const [error, setError] = useState("");
	const [editing, setEditing] = useState<CredentialMeta | "new" | null>(null);

	const refresh = useCallback(async () => {
		try {
			const list = await bridge.credentials.list();
			setItems([...list].sort((a, b) => a.title.localeCompare(b.title)));
			setError("");
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure));
		}
	}, []);
	// Read on every visit: a card in a conversation may have saved one since the last.
	useEffect(() => {
		if (here) void refresh();
	}, [here, refresh]);

	const add = () => setEditing("new");
	return (
		<div data-ly-vault="" className="flex min-h-0 flex-1 flex-col">
			<Scroller className="flex-1" contentClassName={`mx-auto w-full max-w-[880px] py-6 ${compact ? "px-4" : "px-8"}`}>
				<header className="flex flex-wrap items-start justify-between gap-3 pb-6">
					<div>
						<h1 className="text-heading leading-tight font-semibold tracking-tight text-ink">{t("vault.title")}</h1>
						<p className="mt-1.5 max-w-[560px] text-label leading-relaxed text-ink-muted">{t("vault.intro")}</p>
					</div>
					{items && items.length > 0 && (
						<button
							type="button"
							onClick={add}
							data-ly-vault-add=""
							data-ly-tip={t("vault.add")}
							aria-label={t("vault.add")}
							className="grid h-7 w-7 place-items-center rounded-lg border border-line text-ink-muted transition-colors hover:border-ink-faint hover:text-ink"
						>
							<Plus size={12} strokeWidth={2} />
						</button>
					)}
				</header>

				{!items && !error && <SkeletonList count={3} label={t("common.loading")} />}
				{!items && error && (
					<div className="flex flex-col items-center gap-3 py-24 text-center">
						<p className="text-label text-ink-muted">{t("vault.loadFailed", { reason: error })}</p>
						<Button size="sm" onClick={() => void refresh()}>
							{t("common.retry")}
						</Button>
					</div>
				)}
				{items && items.length === 0 && (
					<div data-ly-vault-empty="" className="ly-enter flex flex-col items-center gap-2 py-24 text-center">
						<Vault size={28} strokeWidth={1.5} className="mb-2 text-ink-faint" />
						<p className="text-body text-ink">{t("vault.empty")}</p>
						<p className="max-w-[380px] text-label leading-relaxed text-ink-muted">{t("vault.emptyHint")}</p>
						<Button size="sm" className="mt-3" icon={<Plus size={13} strokeWidth={2} />} onClick={add} data-ly-vault-add="">
							{t("vault.add")}
						</Button>
					</div>
				)}
				{items && items.length > 0 && (
					<div className="ly-enter divide-y divide-line-soft overflow-hidden rounded-[10px] border border-line bg-card/40" data-ly-vault-list="">
						{items.map((item) => (
							<VaultRow key={item.name} item={item} onEdit={() => setEditing(item)} />
						))}
					</div>
				)}
			</Scroller>
			{editing && (
				<CredentialEditor
					item={editing === "new" ? null : editing}
					taken={items?.map((item) => item.name) ?? []}
					onClose={() => setEditing(null)}
					onChanged={() => void refresh()}
				/>
			)}
		</div>
	);
}

function VaultRow({ item, onEdit }: { item: CredentialMeta; onEdit: () => void }) {
	const { t } = useI18n();
	const { compact } = useLayout();
	const Icon = KIND_ICON[item.kind];
	const reference = `[credential:${item.name}]`;
	const details = [t(KIND_LABEL[item.kind]), item.username, item.target ? t("credential.onlyFor", { target: item.target }) : null].filter(Boolean);
	return (
		<div className="group flex items-center gap-2 pr-3 transition-colors hover:bg-card-hover/40" data-ly-vault-row={item.name}>
			<button type="button" onClick={onEdit} aria-label={t("vault.editOne", { name: item.title })} className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 text-left">
				<span className="grid size-8 shrink-0 place-items-center rounded-lg bg-card text-ink-muted">
					<Icon size={15} strokeWidth={1.8} aria-hidden />
				</span>
				<span className="min-w-0 flex-1">
					<span className="block truncate text-label font-medium text-ink">{item.title}</span>
					<span className="mt-0.5 block truncate text-detail text-ink-faint">{details.join(" · ")}</span>
				</span>
				{!compact && <code className="shrink-0 font-mono text-detail text-ink-faint">{reference}</code>}
			</button>
			<CopyAction
				label={t("vault.copyReference")}
				done={t("vault.copiedReference")}
				icon={<Quote size={13} strokeWidth={1.9} />}
				data-ly-vault-copy-reference=""
				run={async () => {
					await navigator.clipboard.writeText(reference);
					return true;
				}}
			/>
			<CopyAction
				label={t(item.kind === "ssh_key" ? "vault.copyPublicKey" : item.kind === "token" ? "vault.copyToken" : "vault.copyPassword")}
				done={item.kind === "ssh_key" ? t("vault.copiedPublicKey") : t("vault.copiedSecret", { s: 30 })}
				icon={<Copy size={13} strokeWidth={1.9} />}
				data-ly-vault-copy-value=""
				run={async () => (await bridge.credentials.copy(item.name)).copied}
			/>
		</div>
	);
}

/** A copy button that turns into a tick, so a copy that happened looks different from one that did not. */
function CopyAction({ label, done, icon, run, ...data }: { label: string; done: string; icon: React.ReactNode; run: () => Promise<boolean> } & Record<`data-${string}`, string>) {
	const { t } = useI18n();
	const [state, setState] = useState<"idle" | "done" | "failed">("idle");
	const timer = useRef<number | undefined>(undefined);
	useEffect(() => () => window.clearTimeout(timer.current), []);
	const settle = (next: "done" | "failed") => {
		setState(next);
		window.clearTimeout(timer.current);
		timer.current = window.setTimeout(() => setState("idle"), TICK_MS);
	};
	return (
		<IconButton
			{...data}
			size="sm"
			label={state === "done" ? done : state === "failed" ? t("vault.copyFailed") : label}
			icon={state === "done" ? <Check size={13} strokeWidth={2.2} className="text-ok" /> : icon}
			onClick={() => {
				void run().then(
					(copied) => settle(copied ? "done" : "failed"),
					() => settle("failed"),
				);
			}}
		/>
	);
}
