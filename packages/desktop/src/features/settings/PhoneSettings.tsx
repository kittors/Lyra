/**
 * Settings on a phone: a list of pages, and the page you picked pushed over it.
 *
 * The desktop's settings are a column of sections beside the page. On a phone that column became a
 * drawer behind a 28px window glyph in the corner, the way back to the conversation was a row inside
 * that drawer, and each page opened in place with nothing to say which one it was or how to leave
 * it. A phone's settings are a list you go into and come back out of: the sections as rows under a
 * large title, each one pushing its page in from the right with "‹ 设置" to return, and the list's
 * own ‹ going back to the conversation.
 *
 * A section asked for by name — 「管理供应商与模型」 from the model's sheet — opens straight on that
 * page, over the list (`settingsAsked`). Put away, settings comes back to the list next time.
 */

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n/index.ts";
import { useEdgeBack } from "../../mobile/edge-back.ts";
import { bridge } from "../../services/index.ts";
import { useApp, type SettingsSection } from "../../store/index.ts";
import { motionReduced } from "../../ui/motion/reduced.ts";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { SELF_SCROLLING, SectionBody } from "./section-body.tsx";
import { sectionFor } from "./sections-for.ts";
import { settingsGroups } from "./settings-navigation.ts";

export function PhoneSettings() {
	const { t } = useI18n();
	const wanted = useApp((s) => s.settingsSection);
	const asked = useApp((s) => s.settingsAsked);
	const view = useApp((s) => s.view);
	const setView = useApp((s) => s.setView);
	const groups = settingsGroups(bridge.platform ?? "darwin", true);
	const [page, setPage] = useState<SettingsSection | null>(null);
	const [leaving, setLeaving] = useState(false);

	const seen = useRef(asked);
	useEffect(() => {
		if (seen.current === asked) return;
		seen.current = asked;
		setLeaving(false);
		// A page the phone does not have opens the list, not the first page: asked for 供应商, it
		// opened 常规, which reads as the wrong page opening rather than as no page to open.
		setPage(sectionFor(groups, wanted, true) === wanted ? wanted : null);
	}, [asked, wanted, groups]);

	useEffect(() => {
		if (view === "settings") return;
		setPage(null);
		setLeaving(false);
	}, [view]);

	const back = useCallback(() => {
		if (motionReduced()) setPage(null);
		else setLeaving(true);
	}, []);

	/*
	 * Escape — and Android's back button, which the shell sends as one — goes back a page, and from
	 * the list back to the conversation. On the way up, so a sheet or a dialog open over a page closes
	 * first. Both count as layers for the back button (`aria-modal` below; see the bridge's
	 * `layerDepth`): without them it left the app from the middle of settings.
	 */
	const shown = view === "settings";
	useEffect(() => {
		if (!shown) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			if (document.querySelector('[data-pane="drawer"]:not([inert])')) return;
			event.preventDefault();
			if (page) back();
			else setView("chat");
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [shown, page, back, setView]);
	// A thumb from the left edge takes the page back too, following it (`edge-back.ts`).
	const pageRef = useRef<HTMLDivElement>(null);
	const stackRef = useRef<HTMLDivElement>(null);
	useEdgeBack({
		page: () => pageRef.current,
		under: () => stackRef.current,
		active: page !== null && !leaving,
		onBack: () => {
			setPage(null);
			setLeaving(false);
		},
	});
	/*
	 * …and the list back to the conversation, the way its ‹ goes, uncovering it as it goes: settings
	 * is drawn over the conversation, which waits underneath put away (`App.tsx`). Without this the
	 * edge did nothing at all here — the drawer's pull is off in settings (`data-ly-no-drawer`), and a
	 * page with a ‹ is one a thumb expects to swipe away.
	 */
	const rootRef = useRef<HTMLDivElement>(null);
	useEdgeBack({
		page: () => rootRef.current,
		under: () => document.querySelector<HTMLElement>("[data-ly-under-settings]"),
		active: shown && page === null,
		onBack: () => setView("chat"),
	});

	const title = (id: SettingsSection) => {
		for (const group of groups) for (const item of group.items) if (item.id === id) return t(item.labelKey);
		return "";
	};

	return (
		<div ref={rootRef} data-ly-settings="" data-ly-no-drawer="" aria-modal={shown || undefined} className="ly-shell ly-phone-settings-root relative flex h-full">
			<main className="ly-phone-settings">
				<div ref={stackRef} className="ly-phone-stack" data-under={page ? "" : undefined} inert={page !== null}>
					<div className="ly-phone-page-bar">
						<button type="button" aria-label={t("app.backWorkspace")} onClick={() => setView("chat")} className="ly-phone-bar-icon ly-press">
							<ChevronLeft size={24} strokeWidth={1.9} aria-hidden />
						</button>
					</div>
					<Scroller className="min-h-0 flex-1" contentClassName="ly-phone-settings-list">
						<h1 className="ly-phone-large-title">{t("phone.settings")}</h1>
						{groups.map((group) => (
							<section key={group.labelKey} className="ly-phone-group">
								<h2 className="ly-phone-group-label">{t(group.labelKey)}</h2>
								<div className="ly-phone-group-card">
									{group.items.map((item) => (
										<button
											key={item.id}
											type="button"
											onClick={() => {
												setLeaving(false);
												setPage(item.id);
											}}
											className="ly-phone-group-row"
										>
											<span className="ly-phone-group-mark">
												<item.icon size={17} strokeWidth={1.8} aria-hidden />
											</span>
											<span className="ly-phone-group-name">{t(item.labelKey)}</span>
											<ChevronRight size={17} strokeWidth={2} aria-hidden className="ly-phone-group-chevron" />
										</button>
									))}
								</div>
							</section>
						))}
					</Scroller>
				</div>

				{page && (
					<div
						ref={pageRef}
						key={page}
						// A layer over the list, which is what Android's back button counts (`aria-modal`).
						role="dialog"
						aria-label={title(page)}
						data-leaving={leaving ? "" : undefined}
						data-ly-phone-page={page}
						aria-modal
						onAnimationEnd={(event) => {
							if (event.target !== event.currentTarget || !leaving) return;
							setPage(null);
							setLeaving(false);
						}}
						className="ly-phone-page"
					>
						<div className="ly-phone-page-bar">
							<button type="button" onClick={back} className="ly-phone-back ly-press">
								<ChevronLeft size={24} strokeWidth={1.9} aria-hidden />
								<span>{t("phone.settings")}</span>
							</button>
						</div>
						{SELF_SCROLLING.has(page) ? (
							<div className={`ly-phone-page-body flex min-h-0 flex-1 flex-col ${page === "plugins" ? "" : "px-4 pb-6"}`}>
								<SectionBody section={page} />
							</div>
						) : (
							<Scroller className="min-h-0 flex-1">
								<div className="ly-phone-page-body px-4 pt-1 pb-16">
									<SectionBody section={page} />
								</div>
							</Scroller>
						)}
					</div>
				)}
			</main>
		</div>
	);
}
