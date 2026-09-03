import type { PermissionMode } from "@lyra/core";
import { FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { matchTarget, useOpenTargets } from "../files/open-targets.ts";
import { useApp } from "../../store/index.ts";
import { bridge } from "../../services/index.ts";
import {
  Card,
  InlineSelect,
  Row,
  SectionTitle,
  Segmented,
  Toggle,
} from "./controls.tsx";

export function GeneralSettings() {
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

  return (
    <div className="pt-8">
      <h1 className="pb-7 text-display leading-tight font-semibold tracking-tight text-ink">
        常规
      </h1>

      <SectionTitle>权限</SectionTitle>
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
          title="默认权限"
          detail="Lyra 始终可以读取和编辑当前工作区内的文件。需要时它会请求额外的访问权限。"
          control={
            <span className="text-label text-ink-faint">始终开启</span>
          }
        />
        <Row
          title="自动审核"
          detail="只读命令（git status、ls、grep 等）自动放行，写入和未知命令仍会请求批准。"
          control={
            <Toggle
              checked={mode !== "ask"}
              onChange={(on) => setMode(on ? "auto" : "ask")}
            />
          }
        />
        <Row
          title="完整访问权限"
          detail="开启后 Lyra 无需批准即可修改文件、执行命令并访问网络。这会显著提高数据丢失或意外行为的风险。"
          control={
            <Toggle
              checked={mode === "full"}
              onChange={(on) => setMode(on ? "full" : "auto")}
            />
          }
        />
      </Card>

      <SectionTitle>常规</SectionTitle>
      <Card className="mb-9">
        <Row
          title="默认文件打开目标"
          detail="点击文件路径时用哪个应用打开"
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
          title="默认推理强度"
          detail="新会话使用的思考预算。每个会话都可以在输入框右侧单独调整，互不影响"
          control={
            <Segmented
              value={settings.thinking}
              onChange={(thinking) => patch({ thinking })}
              options={[
                { value: "off", label: "关" },
                { value: "low", label: "低" },
                { value: "medium", label: "中" },
                { value: "high", label: "高" },
              ]}
            />
          }
        />
        <Row
          title="请求重试次数"
          detail="模型请求因网络中断失败时的重试次数（含首次）。中继或代理不稳时值得调高；设为 1 则失败立即报错。已经开始输出的回答不会重试。"
          control={
            <Segmented
              value={String(settings.retryAttempts)}
              onChange={(value) => patch({ retryAttempts: Number(value) })}
              options={[
                { value: "1", label: "不重试" },
                { value: "2", label: "2 次" },
                { value: "3", label: "3 次" },
                { value: "5", label: "5 次" },
              ]}
            />
          }
        />
        <Row
          title="底部面板"
          detail="在会话底部显示用量与状态信息"
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
          title="平台"
          detail="当前运行环境"
          control={
            <span className="text-label text-ink-faint">{platform}</span>
          }
        />
      </Card>

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
