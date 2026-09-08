import type { HookConfig } from "@lyra/core";
import { ScrollText } from "../../ui/scroll/ScrollText.tsx";
import { Anchor, Plus, Info } from "lucide-react";
import { IconButton } from "../../ui/primitives/IconButton.tsx";
import { RowDeleteButton } from "../../ui/primitives/RowDeleteButton.tsx";
import { useState } from "react";
import { useConfirmer } from "../../ui/overlay/Confirm.tsx";
import { useApp } from "../../store/index.ts";
import {
  Badge,
  Card,
  EmptyHint,
  Field,
  GhostButton,
  SectionTitle,
  Select,
  TextInput,
  Toggle,
} from "./controls.tsx";
import { ProjectOverrideNotice } from "./ProjectOverrideNotice.tsx";
import { useI18n, type MessageKey } from "../../i18n/index.ts";

/* 预设表在模块加载时成型，那会儿还不知道窗口是哪种语言——所以存 key，渲染时才译。 */
const PRESETS: { labelKey: MessageKey; hook: Omit<HookConfig, "id"> }[] = [
  {
    labelKey: "hooks.presetLog",
    hook: {
      command:
        'echo "$(date -u +%FT%TZ) $DW_TOOL $DW_ARGS" >> .lyra/tool-audit.log',
      tools: ["bash"],
      event: "after-tool",
      enabled: true,
      blocking: false,
    },
  },
  {
    labelKey: "hooks.presetLockfile",
    hook: {
      command:
        'case "$DW_ARGS" in *lock*) echo t("hooks.lockfileProtected") >&2; exit 1 ;; esac',
      tools: ["edit", "write"],
      event: "before-tool",
      enabled: true,
      blocking: true,
    },
  },
  {
    labelKey: "hooks.presetFormat",
    hook: {
      command:
        "command -v prettier >/dev/null && prettier --write . >/dev/null 2>&1 || true",
      tools: ["write", "edit"],
      event: "after-tool",
      enabled: false,
      blocking: false,
    },
  },
];

export function HooksSettings() {
	const { t } = useI18n();
  const settings = useApp((s) => s.settings);
  const saveSettings = useApp((s) => s.saveSettings);
  if (!settings) return null;

  const hooks = settings.hooks;
  const update = (id: string, patch: Partial<HookConfig>) =>
    void saveSettings({
      ...settings,
      hooks: hooks.map((h) => (h.id === id ? { ...h, ...patch } : h)),
    });
  const add = (hook: Omit<HookConfig, "id">) =>
    void saveSettings({
      ...settings,
      hooks: [...hooks, { ...hook, id: `hook-${Date.now().toString(36)}` }],
    });
  const remove = (id: string) =>
    void saveSettings({ ...settings, hooks: hooks.filter((h) => h.id !== id) });

  return (
    <div className="pt-8">
      <header className="flex items-start justify-between pb-7">
        <div>
          <h1 className="text-display leading-tight font-semibold tracking-tight text-ink">
            {t("hooks.title")}
          </h1>
          <p className="mt-2 max-w-[580px] text-label leading-relaxed text-ink-muted">
            {t("hooks.intro")}
          </p>
        </div>
        <div className="shrink-0 pt-1">
          <GhostButton
            onClick={() =>
              add({
                command: "echo $DW_TOOL",
                tools: [],
                event: "before-tool",
                enabled: true,
                blocking: false,
              })
            }
          >
            <span className="flex items-center gap-1.5">
              <Plus size={12} strokeWidth={2} />
              {t("common.new")}
            </span>
          </GhostButton>
        </div>
      </header>

      <ProjectOverrideNotice keys={["hooks"]} />
      <SectionTitle>{t("hooks.quickAdd")}</SectionTitle>
      <Card className="mb-7">
        {PRESETS.map((preset) => (
          /*
           * The badges and the button drop below the command when the row runs out.
           *
           * They are `shrink-0` — correctly, a badge that has been squeezed says
           * nothing — so on a narrow pane the truncating command had no width left to
           * truncate *to* and pushed the whole row past the edge instead.
           */
          <div
            key={t(preset.labelKey)}
            data-row-actions
            className="@container border-b border-line-soft px-4 py-3 last:border-b-0"
          >
            <div className="flex items-center gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Anchor
                  size={14}
                  strokeWidth={1.8}
                  className="shrink-0 text-ink-muted"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-label text-ink">{t(preset.labelKey)}</div>
                  <ScrollText text={preset.hook.command} className="mt-0.5 font-mono text-detail text-ink-faint" />
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <span data-ly-tip={`${preset.hook.event === "before-tool" ? t("hooks.beforeTool") : t("hooks.afterTool")}${preset.hook.blocking ? t("hooks.blockingSuffix") : ""}`} className="text-ink-faint"><Info size={13} /></span>
                <IconButton className="ly-row-action" label={t("hooks.addPreset", { label: t(preset.labelKey) })} icon={<Plus size={14} />} onClick={() => add(preset.hook)} />
              </div>
            </div>
          </div>
        ))}
      </Card>

      <SectionTitle>{t("hooks.configured", { n: hooks.length })}</SectionTitle>
      {hooks.length === 0 ? (
        <Card>
          <EmptyHint>{t("hooks.empty")}</EmptyHint>
        </Card>
      ) : (
        <div className="space-y-3">
          {hooks.map((hook) => (
            <HookCard
              key={hook.id}
              hook={hook}
              onChange={(patch) => update(hook.id, patch)}
              onRemove={() => remove(hook.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function HookCard({
  hook,
  onChange,
  onRemove,
}: {
  hook: HookConfig;
  onChange: (patch: Partial<HookConfig>) => void;
  onRemove: () => void;
}) {
	const { t } = useI18n();
  const [command, setCommand] = useState(hook.command);
  const confirm = useConfirmer();

  return (
    <Card>
			<div data-row-actions className="flex items-center gap-2.5 border-b border-line-soft px-4 py-3">
        <Anchor
          size={15}
          strokeWidth={1.8}
          className="shrink-0 text-ink-muted"
        />
        <Badge tone="muted">
          {hook.event === "before-tool" ? t("hooks.before") : t("hooks.after")}
        </Badge>
        {hook.blocking && <Badge tone="accent">{t("hooks.blocking")}</Badge>}
        <ScrollText
          text={hook.command}
          className="min-w-0 flex-1 font-mono text-detail text-ink-muted"
        />
        <Toggle
          checked={hook.enabled}
          onChange={(enabled) => onChange({ enabled })}
        />
				<RowDeleteButton
					label={t("hooks.deleteOne")}
          onClick={() =>
            confirm.ask({
              title: t("hooks.deleteConfirm"),
              detail: hook.command,
              confirmLabel: t("common.delete"),
              onConfirm: onRemove,
            })
          }
				/>

        {confirm.element}
      </div>

      <div className="space-y-3 px-4 py-3.5">
        {/*
         * An empty command is not saved.
         *
         * Blurring an empty field used to persist it, and a hook whose command is the empty
         * string still runs — the shell exits 0, so a *blocking* hook silently turns into
         * one that approves everything. The field keeps what you typed and says why.
         */}
        <Field
          label={t("commands.title")}
          hint={
            command.trim() ? t("hooks.commandDetail") : t("hooks.required")
          }
        >
          <TextInput
            value={command}
            onChange={setCommand}
            onBlur={() => {
              if (!command.trim()) return;
              if (command !== hook.command) onChange({ command });
            }}
            invalid={!command.trim()}
            mono
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t("hooks.when")}>
            <Select
              value={hook.event}
              onChange={(event) => onChange({ event })}
              options={[
                { value: "before-tool", label: t("hooks.beforeTool") },
                { value: "after-tool", label: t("hooks.afterTool") },
              ]}
            />
          </Field>
          <Field label={t("hooks.limitTools")} hint={t("hooks.limitToolsDetail")}>
            <TextInput
              value={hook.tools.join(", ")}
              onChange={(value) =>
                onChange({
                  tools: value
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean),
                })
              }
              mono
              placeholder="bash, write, edit"
            />
          </Field>
        </div>

        {hook.event === "before-tool" && (
          <label className="flex items-center justify-between rounded-[10px] border border-line px-3.5 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block text-label text-ink">
                {t("hooks.blockOnNonZero")}
              </span>
              <span className="block text-detail text-ink-muted">
                {t("hooks.nonZeroCode")}
                {t("hooks.blockDetail")}
              </span>
            </span>
            <Toggle
              checked={hook.blocking}
              onChange={(blocking) => onChange({ blocking })}
            />
          </label>
        )}
      </div>
    </Card>
  );
}
