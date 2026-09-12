/**
 * One bundle in the catalogue.
 *
 * A card with a border, which it did not used to have: it was a row that grew a background on
 * hover, and a grid of those reads as a list of links rather than as a shelf of things. The border
 * is what makes the icon, the name and the lines under it belong to each other — and it is what the
 * site's own catalogue has always done, so the two views of one registry now agree.
 *
 * What it says has grown for a plainer reason: the data was already there. `version`, `author`,
 * `downloads`, `skillCount` and `clients` have been in every index the platform serves since it
 * existed, and this card drew a name and a sentence. See `CardMeta` for what the two lines are for.
 *
 * The actions stay minimal, and the rule is unchanged — one obvious thing, everything else behind
 * the ⋯:
 *
 *   - not installed — 安装. It is why the page exists, so it is stated rather than revealed on
 *     hover, because a button you have to find is a button most people do not.
 *   - installed — the switch, and ⋯ for the rest.
 *   - installed and superseded — 更新 as well, because that is now the one obvious thing. It is
 *     the only control here that appears on its own evidence rather than on a state the user set.
 */

import { useI18n } from "../../i18n/index.ts";
import { ArrowUp, Download, FolderOpen, MoreHorizontal, Play, Settings2, Trash2 } from "lucide-react";
import { Spinner } from "../../ui/motion/loaders.tsx";

import { Confirm } from "../../ui/overlay/Confirm.tsx";
import { MenuBody, MenuItem, MenuSeparator, Popover, usePopover } from "../../ui/overlay/Popover.tsx";
import { PluginIcon } from "../settings/index.ts";
import { FootprintLine, IdentityLine } from "./CardMeta.tsx";
import { isEnabled, isInstalled, type CatalogItem } from "./catalog.ts";
import { useInstall } from "./useInstall.ts";
import { bridge } from "../../services/index.ts";

export function CatalogCard({
	item,
	onOpen,
	onChanged,
	onError,
	onTry,
	onToggle,
}: {
	item: CatalogItem;
	onOpen: () => void;
	/** Something on disk moved; the catalogue has to be re-read. */
	onChanged: () => void;
	onError: (message: string) => void;
	/** Starts a conversation with one of the bundle's own example prompts already typed. */
	onTry: (prompt: string) => void;
	/**
	 * Switch it on or off. Absent for kinds that have no single switch.
	 *
	 * An MCP bundle has one per server it brought and a collection has none at all — its skills are
	 * simply among the loose ones once installed. The caller decides, because it is the one holding
	 * the settings.
	 */
	onToggle?: (enabled: boolean) => void;
}) {
	const { t } = useI18n();
	const menu = usePopover();
	const act = useInstall(item, onChanged, onError);

	const plugin = item.installed;
	const bundle = item.bundle;
	const installed = isInstalled(item);
	/*
	 * Where "打开目录" goes, and the thing whose absence used to hide the whole menu.
	 *
	 * A skill collection has no directory of its own — its skills sit among the loose ones. That
	 * left `dir` null, and the menu is gated on it, so an installed collection had no way to be
	 * uninstalled at all: no 安装 button any more, and no ⋯ menu either. The folder its skills went
	 * into is the honest answer to "show me this", even though it holds more than this.
	 */
	const dir = plugin?.dir ?? bundle?.dir ?? item.collectedIn;
	/*
	 * Trying it means running one of its own example prompts, so it takes both a prompt to run and
	 * something that is actually live — offering it while the bundle is switched off would open a
	 * conversation that silently lacks the thing being demonstrated. For an MCP bundle "live"
	 * means at least one of its servers is enabled, which is a per-server switch on the MCP page.
	 */
	const manifest = plugin?.manifest ?? bundle?.manifest;
	const trial = isEnabled(item) ? (manifest?.interface?.defaultPrompt?.[0] ?? null) : null;
	/** A bundle that lives in the project's own directory is removed by deleting it there. */
	const removable = installed && (plugin?.source ?? bundle?.source) !== "workspace";
	/* Only a plugin has one switch. See `onToggle`. */
	const switchable = onToggle && plugin !== null;

	const close = () => {
		menu.close();
		act.setConfirming(false);
	};

	return (
		/*
		 * The click target is underneath, not around.
		 *
		 * A button cannot contain a button, so the switch and the ⋯ cannot sit inside the card's own
		 * button — they used to be absolutely positioned over its right-hand end, with the text
		 * column given a fixed right inset to keep clear of them. That inset is a guess about how
		 * wide the controls are, and it was wrong in both directions at once: too much for a card
		 * whose only control is a 26px ⋯ (the identity line lost 96px it had no reason to give up,
		 * and `agent-browser-cli` truncated by nine pixels), and too little for one showing 更新 as
		 * well as a switch (measured: 118px of controls under a 92px reservation, a 25px overlap).
		 *
		 * With the button as a layer behind the content, the controls are ordinary flex children on
		 * the title row and take exactly the space they take. Nothing is reserved and nothing
		 * collides. The content layer passes pointer events through to the button; the controls opt
		 * back in.
		 */
		<div className="group/card relative mb-4">
			<button
				type="button"
				onClick={onOpen}
				aria-label={item.name}
				className="absolute inset-0 rounded-xl border border-line-soft bg-card/40 transition-[background-color,border-color] duration-[var(--ly-t-quick)] hover:border-line hover:bg-card-hover/60"
			/>

			<div className="pointer-events-none relative flex items-start gap-3 p-3.5">
				<PluginIcon
					name={item.name}
					id={item.id}
					logo={item.logo}
					brandColor={item.brandColor}
					category={item.category}
					kind={item.kind}
					size={38}
				/>

				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<span className="truncate text-label font-medium text-ink">{item.name}</span>
						{item.outdated && (
							<span className="shrink-0 rounded-md bg-accent/12 px-1.5 py-px text-caption leading-[1.5] text-accent">
								{t("catalogCard.updatable")}
							</span>
						)}
						{/*
						 * Installed-and-off is worth a word; installed-and-on is what the switch beside
						 * it already says. An MCP bundle starts with every server off, so "未启用" is
						 * where it begins rather than something the user did.
						 */}
						{installed && !isEnabled(item) && item.collected === 0 && (
							<span className="shrink-0 text-caption text-ink-faint">
								{item.kind === "mcp" ? t("catalogCard.notEnabled") : t("catalogCard.disabled")}
							</span>
						)}

						{/* At the end of the title row rather than over it. `ml-auto` is the whole
						    layout: the title truncates against whatever these leave. */}
						<div className="ml-auto flex shrink-0 items-center gap-1">
							{item.outdated && (
								<button
									type="button"
									disabled={act.busy !== null}
									data-ly-tip={
											item.entry?.version
												? t("catalogCard.updateTo", { version: `v${item.entry.version}` })
												: t("catalogCard.updateToLatest")
										}
									onClick={() => void act.update()}
									className="pointer-events-auto flex h-[26px] items-center gap-1 rounded-lg bg-accent/12 px-2 text-detail font-medium text-accent transition-opacity duration-[var(--ly-t-quick)] hover:opacity-80 disabled:opacity-50"
								>
									{act.busy === "update" ? (
										<Spinner size={11.5} />
									) : (
										<ArrowUp size={11.5} strokeWidth={2.2} />
									)}
									{t("common.update")}
								</button>
							)}

							{switchable && <Switch on={isEnabled(item)} label={item.name} onChange={(next) => onToggle(next)} />}

							{installed ? (
								<button
									type="button"
									aria-label={t("catalogCard.moreFor", { name: item.name })}
									aria-haspopup="menu"
									aria-expanded={menu.open}
									onClick={menu.toggle}
									className="pointer-events-auto flex h-[26px] w-[26px] items-center justify-center rounded-md text-ink-faint opacity-0 transition-[color,background-color,opacity] duration-[var(--ly-t-quick)] group-hover/card:opacity-100 hover:bg-card-hover hover:text-ink focus-visible:opacity-100 aria-expanded:opacity-100"
								>
									{act.busy === "uninstall" ? (
										<Spinner size={13} />
									) : (
										<MoreHorizontal size={15} strokeWidth={1.9} />
									)}
								</button>
							) : (
								item.entry && (
									<button
										type="button"
										disabled={act.busy !== null}
										onClick={() => void act.install()}
										className="pointer-events-auto flex h-[26px] items-center gap-1.5 rounded-lg border border-line bg-shell/80 px-2.5 text-detail text-ink-muted transition-[color,border-color,opacity] duration-[var(--ly-t-quick)] hover:border-ink-faint hover:text-ink disabled:opacity-50"
									>
										{act.busy === "install" ? (
											<Spinner size={11.5} />
										) : (
											<Download size={11.5} strokeWidth={1.9} />
										)}
										{t("common.install")}
									</button>
								)
							)}
						</div>
					</div>

					<IdentityLine item={item} />

					{/*
					 * The tagline when a maintainer wrote one, because it was written for this space.
					 * A description is written to be read whole and wraps to three lines in a card.
					 */}
					<p className="mt-1.5 line-clamp-2 text-detail leading-relaxed text-ink-muted">
						{item.tagline || item.description || t("plugins.noDescription")}
					</p>

					<FootprintLine item={item} />
				</div>
			</div>

			{/* The question is a modal, so the menu is only ever a menu — see `Confirm`. */}
			{act.confirming && (
				<Confirm
					title={t("plugins.uninstallConfirm", { name: item.name })}
					detail={
						item.kind === "mcp"
							? t("pluginDetail.uninstallMcpDetail", { n: item.servers.length })
							: item.collected > 0
								? t("catalogCard.uninstallSkillsDetail", { n: item.collected })
								: t("plugins.uninstallDetail")
					}
					confirmLabel={t("mcp.uninstall")}
					onCancel={() => act.setConfirming(false)}
					onConfirm={() => {
						act.setConfirming(false);
						void act.uninstall();
					}}
				/>
			)}
			{/* Being installed is what opens this menu, and being installed is what gives it a
			    directory — named again so the rows below can use it without re-asking. */}
			{menu.open && dir && (
				<Popover
					anchor={menu.anchor}
					onClose={close}
					placement="bottom"
					align="end"
					width="compact"
					role="menu"
					label={item.name}
				>
					<MenuBody>
						{trial && (
							<MenuItem
								icon={<Play size={13} strokeWidth={1.8} />}
								onClick={() => {
									close();
									onTry(trial);
								}}
							>
								{t("catalogCard.tryNow")}
							</MenuItem>
						)}
						<MenuItem
							icon={<Settings2 size={13} strokeWidth={1.8} />}
							onClick={() => {
								close();
								onOpen();
							}}
						>
							{t("common.manage")}
						</MenuItem>
						<MenuItem
							icon={<FolderOpen size={13} strokeWidth={1.8} />}
							onClick={() => {
								close();
								void bridge.system.openPath(dir);
							}}
						>
							{t("common.openFolder")}
						</MenuItem>

						<MenuSeparator />

						<MenuItem
							danger
							icon={<Trash2 size={13} strokeWidth={1.8} />}
							disabled={act.busy !== null || !removable}
							title={removable ? undefined : t("catalogCard.workspaceOwned")}
							onClick={() => {
								// The menu gives way to the question rather than sitting behind it.
								menu.close();
								act.setConfirming(true);
							}}
						>
							{t("mcp.uninstall")}
						</MenuItem>
					</MenuBody>
				</Popover>
			)}
		</div>
	);
}

/**
 * On or off, for the one kind that has a single answer.
 *
 * Drawn rather than an `<input type=checkbox>` because the platform control cannot be restyled to
 * this size on every OS the app ships to, and a switch that looks different on Windows than on
 * macOS in the middle of a card that looks the same is worse than one we draw.
 */
function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (next: boolean) => void }) {
	const { t } = useI18n();
	return (
		<button
			type="button"
			role="switch"
			aria-checked={on}
			aria-label={on ? t("catalogCard.toggleOn", { label }) : t("catalogCard.toggleOff", { label })}
			data-ly-tip={on ? t("common.disable") : t("common.enable")}
			onClick={() => onChange(!on)}
			className={`pointer-events-auto flex h-[16px] w-[28px] shrink-0 items-center rounded-full px-[2px] transition-colors duration-[var(--ly-t-quick)] ${
				on ? "bg-ok" : "bg-line"
			}`}
		>
			<span
				className={`h-[12px] w-[12px] rounded-full bg-shell transition-transform duration-[var(--ly-t-quick)] ${
					on ? "translate-x-[12px]" : "translate-x-0"
				}`}
			/>
		</button>
	);
}
