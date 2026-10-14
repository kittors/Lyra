/**
 * 保险箱: the credentials kept on this computer, managed by hand.
 *
 * Added here or saved from a card in a conversation. A value goes in and never comes back to this
 * page: a row says what a credential is and where it may be used, copies its reference — the
 * `[credential:name]` that hands it to a conversation — and copies its value to the clipboard through
 * the main process, which wipes it again (`credentials.copy`).
 *
 * Built from the same pieces as the settings lists (`ListRow`, `GlyphMark`, `Badge`), so a saved
 * password sits in the same rhythm as an installed plugin. A place of its own, like 创作: the sidebar
 * folds away while it is up (`app/layout.tsx`).
 */

import type { CredentialMeta } from "@lyra/core";
import { AtSign, Copy, FileKey2, Plus, Trash2, Vault } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useLayout } from "../../app/layout.tsx";
import { useI18n } from "../../i18n/index.ts";
import { bridge } from "../../services/index.ts";
import { useApp } from "../../store/index.ts";
import { useConfirmer } from "../../ui/overlay/Confirm.tsx";
import { Button } from "../../ui/primitives/Button.tsx";
import { CopyButton } from "../../ui/primitives/CopyButton.tsx";
import { IconButton } from "../../ui/primitives/IconButton.tsx";
import { SkeletonList } from "../../ui/primitives/Skeleton.tsx";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { Badge, Card, EmptyHint, GlyphMark, ListRow } from "../settings/index.ts";
import { CredentialEditor } from "./CredentialEditor.tsx";
import { KIND_ICON, KIND_LABEL } from "./labels.ts";

export function VaultView() {
	const { t } = useI18n();
	const { compact } = useLayout();
	const here = useApp((state) => state.view === "vault");
	const [items, setItems] = useState<CredentialMeta[] | null>(null);
	const [error, setError] = useState("");
	const [editing, setEditing] = useState<CredentialMeta | "new" | null>(null);
	const confirm = useConfirmer();

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

	const remove = (item: CredentialMeta) =>
		confirm.ask({
			title: t("vault.deleteConfirm", { name: item.title }),
			detail: t("vault.deleteDetail"),
			confirmLabel: t("common.delete"),
			onConfirm: () => void bridge.credentials.remove(item.name).finally(() => void refresh()),
		});

	const add = <Button size="sm" icon={<Plus size={13} strokeWidth={2} />} onClick={() => setEditing("new")} data-ly-vault-add="">{t("vault.add")}</Button>;
	return (
		<div data-ly-vault="" className="flex min-h-0 flex-1 flex-col">
			<Scroller className="flex-1" contentClassName={`mx-auto w-full max-w-[880px] py-6 ${compact ? "px-4" : "px-8"}`}>
				<header className="flex flex-wrap items-start justify-between gap-3 pb-6">
					<div className="min-w-0">
						<h1 className="text-heading leading-tight font-semibold tracking-tight text-ink">{t("vault.title")}</h1>
						<p className="mt-1.5 max-w-[560px] text-label leading-relaxed text-ink-muted">{t("vault.intro")}</p>
					</div>
					{items && items.length > 0 && add}
				</header>

				{!items && !error && <SkeletonList count={3} label={t("common.loading")} />}
				{!items && error && (
					<Card>
						<EmptyHint icon={Vault}>{t("vault.loadFailed", { reason: error })}</EmptyHint>
						<div className="-mt-6 flex justify-center pb-10">
							<Button size="sm" onClick={() => void refresh()}>
								{t("common.retry")}
							</Button>
						</div>
					</Card>
				)}
				{items && items.length === 0 && (
					<Card data-ly-vault-empty="">
						<EmptyHint icon={Vault}>{t("vault.empty")}</EmptyHint>
						{/* Under the sentence it answers, not a hint's whole padding below it. */}
						<div className="-mt-6 flex justify-center pb-10">{add}</div>
					</Card>
				)}
				{items && items.length > 0 && (
					// ListRow pads its own hit area by 8px; pulled back, the marks line up with the heading.
					<div className="-mx-2" data-ly-vault-list="">
						{items.map((item) => (
							<VaultRow key={item.name} item={item} onOpen={() => setEditing(item)} onRemove={() => remove(item)} />
						))}
					</div>
				)}
			</Scroller>
			{confirm.element}
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

function VaultRow({ item, onOpen, onRemove }: { item: CredentialMeta; onOpen: () => void; onRemove: () => void }) {
	const { t } = useI18n();
	const reference = `[credential:${item.name}]`;
	// Only what the title row does not already say: whose account, and where it may be used.
	const detail = [item.username, item.target ? t("credential.onlyFor", { target: item.target }) : null].filter(Boolean).join(" · ");
	const key = item.kind === "ssh_key";
	return (
		<div data-ly-vault-row={item.name}>
			<ListRow
				icon={<GlyphMark glyph={KIND_ICON[item.kind]} name={t(KIND_LABEL[item.kind])} size={30} />}
				title={
					<span className="flex items-center gap-2">
						<span className="truncate">{item.title}</span>
						<Badge tone="muted">{t(KIND_LABEL[item.kind])}</Badge>
					</span>
				}
				detail={detail || t("credential.anywhere")}
				onOpen={onOpen}
				openLabel={t("vault.editOne", { name: item.title })}
				actions={
					<>
						<CopyButton
							className="ly-row-action"
							label={`${t("vault.copyReference")} ${reference}`}
							done={t("vault.copiedReference")}
							text={reference}
							icon={<AtSign size={13} strokeWidth={1.9} />}
							data-ly-vault-copy-reference=""
						/>
						<CopyButton
							className="ly-row-action"
							label={t(key ? "vault.copyPublicKey" : item.kind === "token" ? "vault.copyToken" : "vault.copyPassword")}
							done={key ? t("vault.copiedPublicKey") : t("vault.copiedSecret", { s: 30 })}
							copy={async () => (await bridge.credentials.copy(item.name)).copied}
							icon={key ? <FileKey2 size={13} strokeWidth={1.9} /> : <Copy size={13} strokeWidth={1.9} />}
							data-ly-vault-copy-value=""
						/>
						<IconButton
							className="ly-row-action"
							size="sm"
							tone="danger"
							label={t("common.delete")}
							ariaLabel={t("vault.deleteOne", { name: item.title })}
							icon={<Trash2 size={13} strokeWidth={1.8} />}
							onClick={onRemove}
							data-ly-vault-delete=""
						/>
					</>
				}
			/>
		</div>
	);
}
