/**
 * One bundle in the catalogue: what it is, and the one thing to do about it.
 *
 * A card is read in a grid of thirty, so it says four things and no more — the mark, the name, a
 * line about what it does, and who made it — and offers one action on its right edge. Everything
 * else is one click further, on the bundle's own page, which has the room to say it properly.
 *
 * It used to say a great deal more, all of it true: which half of the catalogue it came from, its
 * version, its directory name, its author, a bordered chip for each agent that can install it, a
 * skill count and a download count — two lines of metadata under every name, repeated down the
 * page until the names were the hardest thing on it to find. Those facts now live on the detail
 * page (`PluginDetail`), where somebody deciding about one bundle reads them, instead of on every
 * card, where somebody looking for one skims past them.
 *
 * The action on the right is the state of the thing, and the button when there is something to do:
 *
 *   - not installed — 安装;
 *   - installed and behind the registry — 更新, in the accent, because it is the one state that
 *     appeared on its own rather than because somebody chose it;
 *   - installed but waiting for a key (an MCP server with a placeholder nobody filled) — 待配置,
 *     which opens the page where the key is typed;
 *   - installed, and fine — a quiet ✓, or 已停用 when it is switched off.
 *
 * Switching on and off, trying a prompt, opening the folder and uninstalling are all on the detail
 * page and in 设置 › 插件. A card is for finding things; managing them has two places already.
 */

import { ArrowUp, Check, Download, KeyRound } from "lucide-react";

import { useI18n } from "../../i18n/index.ts";
import { ActionSpinner } from "../../ui/motion/loaders.tsx";
import { PluginIcon } from "../settings/index.ts";
import { isEnabled, isInstalled, type CatalogItem } from "./catalog.ts";
import { compactCount } from "./format.ts";
import { useInstall, type Install, type InstallReports } from "./useInstall.ts";

export function CatalogCard({
	item,
	index = 0,
	missing,
	showKind,
	onOpen,
	reports,
}: {
	item: CatalogItem;
	/** Where it comes in the order the grid arrives in; see `.ly-rise-in`. */
	index?: number;
	/** Values this MCP bundle still needs before it can start. */
	missing: string[];
	/** Say which of the three it is — only where the grid mixes them. */
	showKind: boolean;
	onOpen: () => void;
	reports: InstallReports;
}) {
	const { t } = useI18n();
	const act = useInstall(item, reports);
	const installed = isInstalled(item);
	const author = item.author;
	const downloads = (item.downloads ?? 0) > 0 ? compactCount(item.downloads ?? 0) : null;
	const needsKey = !installed && item.needs.some((need) => !need.optional);

	return (
		/*
		 * The click target is underneath, not around: a button cannot hold the action button, so the
		 * card's own button is a layer behind the content and the action opts back into pointer events.
		 */
		/*
		 * `h-full` and a column that pushes its last line down: cards in one row of the grid come out
		 * the same height with their footers level, and a card alone in its row is as short as it can
		 * be — rather than every card reserving two lines of text it may not have.
		 */
		<div className="ly-rise-in group/card relative h-full" data-card={item.key} style={{ "--ly-i": index } as React.CSSProperties}>
			<button
				type="button"
				onClick={onOpen}
				aria-label={item.name}
				className="absolute inset-0 rounded-xl border border-line-soft/70 bg-card/30 transition-[background-color,border-color,transform] duration-[var(--ly-t-quick)] hover:border-line-soft hover:bg-card-hover/60 active:scale-[0.992]"
			/>

			<div className="pointer-events-none relative flex h-full items-start gap-3 px-3.5 py-3">
				<PluginIcon
					name={item.name}
					id={item.id}
					logo={item.logo}
					brandColor={item.brandColor}
					category={item.category}
					kind={item.kind}
					size={40}
				/>

				<div className="flex min-h-full min-w-0 flex-1 flex-col">
					<div className="flex min-h-[26px] items-center gap-2">
						<span data-card-name="" className="truncate text-label font-medium text-ink">{item.name}</span>
						{showKind && item.kind !== "plugin" && (
							<span className="shrink-0 rounded-md bg-card-hover px-1.5 text-caption leading-[18px] text-ink-faint">
								{item.kind === "mcp" ? "MCP" : t("common.skills")}
							</span>
						)}
						<div className="ml-auto shrink-0">
							<Action item={item} act={act} missing={missing} installed={installed} />
						</div>
					</div>

					<p className="line-clamp-2 text-detail leading-relaxed text-ink-muted">
						{item.tagline || item.description || t("market.noTagline")}
					</p>

					{(author || downloads || needsKey) && (
						<div className="mt-auto flex min-w-0 items-center gap-1.5 pt-1.5 text-caption text-ink-faint">
							{author && <span className="truncate">{author}</span>}
							{author && downloads && <span aria-hidden className="shrink-0 text-ink-faint/50">·</span>}
							{downloads && (
								<span className="shrink-0 tabular-nums" aria-label={t("market.downloads", { n: item.downloads ?? 0 })}>
									<Download size={10} strokeWidth={2} className="mr-0.5 inline -translate-y-px" aria-hidden />
									{downloads}
								</span>
							)}
							{needsKey && (
								<span className="ml-auto flex shrink-0 items-center gap-1 whitespace-nowrap">
									<KeyRound size={10} strokeWidth={2} aria-hidden />
									{t("market.needsKey")}
								</span>
							)}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

/** The right-hand end of the title row: the state, or the one thing to press. */
function Action({ item, act, missing, installed }: { item: CatalogItem; act: Install; missing: string[]; installed: boolean }) {
	const { t } = useI18n();
	const pill =
		"pointer-events-auto flex h-[24px] items-center gap-1 rounded-full px-2.5 text-caption font-medium whitespace-nowrap transition-[background-color,color,opacity] duration-[var(--ly-t-quick)] disabled:opacity-60";

	if (!installed) {
		if (!item.entry) return null;
		return (
			<button
				type="button"
				disabled={act.busy !== null}
				onClick={() => void act.install()}
				aria-label={t("market.installNamed", { name: item.name })}
				className={`${pill} bg-card-hover text-ink hover:bg-ink hover:text-shell`}
			>
				{act.busy === "install" ? <ActionSpinner size={11} /> : null}
				{act.busy === "install" ? t("market.installing") : t("common.install")}
			</button>
		);
	}

	if (item.outdated && item.entry) {
		return (
			<button
				type="button"
				disabled={act.busy !== null}
				onClick={() => void act.update()}
				data-ly-tip={item.entry.version ? t("catalogCard.updateTo", { version: `v${item.entry.version}` }) : t("catalogCard.updateToLatest")}
				aria-label={t("market.updateNamed", { name: item.name })}
				className={`${pill} bg-accent/12 text-accent hover:bg-accent/20`}
			>
				{act.busy === "update" ? <ActionSpinner size={11} /> : <ArrowUp size={11} strokeWidth={2.2} aria-hidden />}
				{act.busy === "update" ? t("market.updating") : t("common.update")}
			</button>
		);
	}

	if (missing.length > 0) {
		return (
			<span className="flex h-[24px] items-center gap-1 text-caption whitespace-nowrap text-accent">
				<KeyRound size={11} strokeWidth={2} aria-hidden />
				{t("market.needsSetup")}
			</span>
		);
	}

	const on = isEnabled(item) || item.collected > 0;
	return (
		<span className="flex h-[24px] items-center gap-1 text-caption whitespace-nowrap text-ink-faint">
			{on && <Check size={11} strokeWidth={2.4} aria-hidden />}
			{on ? t("common.installed") : item.kind === "mcp" ? t("catalogCard.notEnabled") : t("catalogCard.disabled")}
		</span>
	);
}
