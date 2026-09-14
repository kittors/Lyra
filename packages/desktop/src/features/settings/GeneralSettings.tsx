import { RetrySettings } from "./RetrySettings.tsx";
import type { PermissionMode, UiLocale } from "@lyra/core";
import { FolderOpen, Languages } from "lucide-react";
import { useEffect, useState } from "react";
import { matchTarget, useOpenTargets } from "../../store/open-targets.ts";
import { useApp } from "../../store/index.ts";
import { bridge } from "../../services/index.ts";
import { ProjectLayerCard } from "./ProjectOverrideNotice.tsx";
import { LOCALE_OPTIONS, useI18n } from "../../i18n/index.ts";
import {
  Card,
  InlineSelect,
  Row,
  SectionTitle,
  Segmented,
  Toggle,
} from "./controls.tsx";

export function GeneralSettings() {
	const { resolvedLocale, t } = useI18n();
  const settings = useApp((s) => s.settings);
  const saveSettings = useApp((s) => s.saveSettings);
  const [platform, setPlatform] = useState("darwin");
  /*
   * What this machine can actually open a file with — see `electron/open-targets.ts`.
   *
   * This used to be a fixed list of macOS application names, so on Windows it offered Finder,
   * Ghostty and Xcode and none of them did anything; on a Mac without VS Code installed it
   * offered a row with no icon beside six that had one. A list of what is here has neither
   * problem, and the icons are the ones already in the user's own Dock or taskbar.
   */
  const targets = useOpenTargets();

  useEffect(() => {
    void bridge.system.platform().then(setPlatform);
  }, []);

  if (!settings) return null;

  /*
   * What is chosen, and the list it is chosen from — which does not always contain it.
   *
   * Settings sync between machines, so a Mac's 「Zed」 arrives on a PC that has no Zed. Showing the
   * choice anyway is the honest answer: it says what was picked, and nothing was silently
   * rewritten behind the user's back. Opening a file falls back to the system default.
   */
  const current = matchTarget(targets, settings.editor.defaultOpenTarget);
  const options = targets.some((target) => target.id === current.id) ? targets : [...targets, current];

  const mode = settings.permissionMode;
  const patch = (next: Partial<typeof settings>) =>
    void saveSettings({ ...settings, ...next });
  const setMode = (permissionMode: PermissionMode) => patch({ permissionMode });
	const resolvedName = LOCALE_OPTIONS.find((option) => option.value === resolvedLocale);

  return (
    <div className="pt-8">
      <h1 className="pb-7 text-display leading-tight font-semibold tracking-tight text-ink">
		{t("settings.general")}
      </h1>

      <ProjectLayerCard />
		<Card className="mb-9">
			<Row
				title={
					<span className="flex items-center gap-2">
						<Languages size={15} strokeWidth={1.8} className="text-ink-muted" />
						{t("language.title")}
					</span>
				}
				detail={t("language.detail")}
				control={
					<InlineSelect
						value={settings.uiLocale}
						onChange={(uiLocale: UiLocale) => patch({ uiLocale })}
						ariaLabel={t("language.title")}
						options={LOCALE_OPTIONS.map((option) => ({
							value: option.value,
							label: t(option.label),
							detail: option.value === "system" && resolvedName
								? `${t("language.systemDetected")} · ${t(resolvedName.label)}`
								: undefined,
							icon: <LocaleMark value={option.value} mark={option.mark} />,
						}))}
					/>
				}
			/>
		</Card>

		<SectionTitle>{t("general.permissions")}</SectionTitle>
      <Card className="mb-9">
        {/*
         * A statement, not a switch.
         *
         * This was a `Toggle` wired to an empty handler — permanently on and inert, because
         * what it describes is not configurable: reading the open workspace is the floor the
         * agent stands on. A control that cannot move is worse than no control, since it
         * invites the one click that proves it does nothing.
         */}
        <Row
			title={t("general.defaultPermission")}
			detail={t("general.defaultPermissionDetail")}
          control={
			<span className="text-label text-ink-faint">{t("general.alwaysEnabled")}</span>
          }
        />
        <Row
			title={t("general.autoReview")}
			detail={t("general.autoReviewDetail")}
          control={
            <Toggle
              checked={mode !== "ask"}
              onChange={(on) => setMode(on ? "auto" : "ask")}
            />
          }
        />
        <Row
			title={t("general.fullAccess")}
			detail={t("general.fullAccessDetail")}
          control={
            <Toggle
              checked={mode === "full"}
              onChange={(on) => setMode(on ? "full" : "auto")}
            />
          }
        />
      </Card>

		<SectionTitle>{t("general.section")}</SectionTitle>
      <Card className="mb-9">
        <Row
			title={t("general.fileTarget")}
			detail={t("general.fileTargetDetail")}
          control={
            <InlineSelect
              // The stored value may predate the ids, or name an application this machine does
              // not have; either way the control shows what was chosen rather than jumping.
              value={current.id}
              onChange={(defaultOpenTarget) =>
                patch({ editor: { ...settings.editor, defaultOpenTarget } })
              }
              options={options.map((target) => ({
                value: target.id,
                label: target.label,
                icon: target.icon ? (
                  <img
                    src={target.icon}
                    alt=""
                    className="h-[18px] w-[18px] shrink-0 rounded-[4px]"
                  />
                ) : target.id === "reveal" ? (
                  // Not an application, so there is no icon to borrow — and a single row without
                  // one in a list of applications reads as a missing icon rather than as a
                  // different kind of thing. A drawn mark says which it is.
                  <FolderOpen
                    size={16}
                    strokeWidth={1.8}
                    className="mx-[1px] shrink-0 text-ink-muted"
                  />
                ) : undefined,
              }))}
            />
          }
        />
        <Row
			title={t("general.thinking")}
			detail={t("general.thinkingDetail")}
          control={
            <Segmented
              value={settings.thinking}
              onChange={(thinking) => patch({ thinking })}
              options={[
				{ value: "off", label: t("thinking.off") },
				{ value: "low", label: t("thinking.low") },
				{ value: "medium", label: t("thinking.medium") },
				{ value: "high", label: t("thinking.high") },
              ]}
            />
          }
        />
        <Row
          title={t("general.autoSummarizeTitle")}
          detail={t("general.autoSummarizeTitleDetail")}
          control={
            <Toggle
              checked={settings.autoSummarizeTitle !== false}
              onChange={(autoSummarizeTitle) => patch({ autoSummarizeTitle })}
            />
          }
        />
        <Row
          title={t("general.bottomPanel")}
          detail={t("general.bottomPanelDetail")}
          control={
            <Toggle
              checked={settings.editor.showBottomPanel}
              onChange={(showBottomPanel) =>
                patch({ editor: { ...settings.editor, showBottomPanel } })
              }
            />
          }
        />
        <Row
          title={t("general.keepAwake")}
          /*
           * 说明里写明合盖不算，而不是让人自己发现。
           *
           * 两个平台的合盖动作都不归应用管——macOS 的 clamshell sleep 要 `pmset disablesleep`，
           * Windows 是电源计划里的 LIDACTION，都要特权。一个开关不该替人改系统电源策略：那是退出
           * 应用之后还留在机器上的事。说清楚它保证什么、不保证什么，比含糊地承诺「不会睡」强。
           */
          detail={t("general.keepAwakeDetail")}
          control={
            <Toggle
              checked={settings.keepAwake === true}
              onChange={(keepAwake) => patch({ keepAwake })}
            />
          }
        />
        <Row
			title={t("general.platform")}
			detail={t("general.platformDetail")}
          control={
            <span className="text-label text-ink-faint">{platform}</span>
          }
        />
      </Card>

      {/*
       * Its own section, because it is two rules rather than one preference.
       *
       * It used to sit between 默认推理强度 and 智能标题总结 as a block of form fields inside a
       * card of label-and-control rows, which broke that card's rhythm in the middle and left its
       * heading crowded against the rule above it.
       */}
      <RetrySettings settings={settings} />

      {/*
       * The version and the update controls are not here.
       *
       * They are a page of their own — 关于 in the sidebar — with the changelog, the check button
       * and the auto-check interval on it. This section was a second copy of the first two, at the
       * bottom of an unrelated page, so the same fact was stated in two places and the fuller one
       * was the one nobody was looking at.
       */}
    </div>
  );
}

function LocaleMark({ value, mark }: { value: UiLocale; mark: string }) {
	if (value === "system") {
		return (
			<span className="flex h-[22px] w-[24px] shrink-0 items-center justify-center rounded-md bg-elevated text-ink-muted">
				<Languages size={13} strokeWidth={1.9} />
			</span>
		);
	}
	return (
		<span className="flex h-[22px] min-w-[24px] shrink-0 items-center justify-center rounded-md bg-elevated px-1 text-[9px] font-semibold tracking-tight text-ink-muted">
			{mark}
		</span>
	);
}
