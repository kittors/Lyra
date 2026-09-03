import type { PermissionMode } from "@lyra/core";
import {
  Check,
  CircleAlert,
  Hand,
  SquareTerminal,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";

import {
  MenuBody,
  MenuItem,
  MenuLabel,
  Popover,
  type Anchor,
} from "../../ui/overlay/Popover.tsx";
import { Overlay } from "./Overlay.tsx";
import { Text } from "../../ui/primitives/Text.tsx";
import { useApp } from "../../store.ts";

const MODES: {
  value: PermissionMode;
  icon: typeof Hand;
  title: string;
  detail: string;
  danger?: boolean;
}[] = [
  {
    value: "ask",
    icon: Hand,
    title: "请求批准",
    detail: "编辑文件和访问网络时始终询问",
  },
  {
    value: "auto",
    icon: SquareTerminal,
    title: "帮我批准",
    detail: "仅对检测到的风险操作请求批准",
  },
  {
    value: "full",
    icon: CircleAlert,
    title: "完全访问权限",
    detail: "可不受限制地访问网络和你电脑上的任何文件",
    danger: true,
  },
];

/**
 * Permission mode, anchored to the chip that shows it.
 *
 * It was a centred dialog, which read as a decision about the whole app rather than a setting
 * attached to the control right there in the composer — the same reason the model and effort
 * menus hang off their own chips.
 */
export function PermissionPicker({
  anchor,
  onClose,
}: {
  anchor: Anchor;
  onClose: () => void;
}) {
  const settings = useApp((s) => s.settings);
  const saveSettings = useApp((s) => s.saveSettings);
  const current = settings?.permissionMode ?? "auto";
  const [confirming, setConfirming] = useState(false);

  function choose(mode: PermissionMode) {
    if (!settings) return;
    void saveSettings({ ...settings, permissionMode: mode });
    onClose();
  }

  return (
    <>
      {!confirming && (
        <Popover
          anchor={anchor}
          onClose={onClose}
          placement="top"
          align="start"
          width="wide"
          label="权限模式"
        >
          <MenuBody>
            <MenuLabel>应如何批准 Lyra 操作？</MenuLabel>
            {MODES.map((mode) => (
              <MenuItem
                key={mode.value}
                icon={
                  <mode.icon
                    size={13}
                    strokeWidth={1.8}
                    className={mode.danger ? "text-danger" : undefined}
                  />
                }
                detail={mode.detail}
                selected={current === mode.value}
                trailing={
                  current === mode.value ? (
                    <Check
                      size={13}
                      strokeWidth={2.2}
                      className={`mt-[3px] shrink-0 ${mode.danger ? "text-danger" : ""}`}
                    />
                  ) : undefined
                }
                onClick={() => {
                  /*
                   * Turning full access on is asked about once, deliberately.
                   *
                   * Every other row here narrows what happens without asking; this one
                   * removes the asking entirely, for the file system and the network
                   * both. A setting that consequential should not be one stray click
                   * away — and the click that reaches it is usually aimed at the row
                   * above.
                   */
                  if (mode.danger && current !== mode.value)
                    setConfirming(true);
                  else choose(mode.value);
                }}
              >
                {/* Full access keeps its colour even though every other row is plain ink: it is
						    the one setting that must never be quietly on. */}
                <span className={mode.danger ? "text-danger" : undefined}>
                  {mode.title}
                </span>
              </MenuItem>
            ))}
          </MenuBody>
        </Popover>
      )}

      {confirming && (
        <Overlay onClose={() => setConfirming(false)} width={420}>
          <div className="p-5">
            <div className="flex items-start gap-3">
              <TriangleAlert
                size={18}
                strokeWidth={1.9}
                className="mt-0.5 shrink-0 text-danger"
              />
              <div className="min-w-0">
                <Text as="div" size="title" weight="medium">
                  开启完全访问权限？
                </Text>
                <Text
                  as="div"
                  size="label"
                  tone="muted"
                  className="mt-1.5 leading-relaxed"
                >
                  Lyra 将不再就任何操作征求你的同意——包括删除文件、改写 Git
                  历史、访问网络，以及读写这台电脑上的任意位置，不限于当前项目。
                </Text>
                <Text
                  as="div"
                  size="label"
                  tone="muted"
                  className="mt-2 leading-relaxed"
                >
                  随时可以在这里改回「帮我批准」，它只在有风险的操作上停下来。
                </Text>
              </div>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="h-[30px] rounded-lg border border-line px-3 text-label text-ink-muted transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover hover:text-ink"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirming(false);
                  choose("full");
                }}
                className="h-[30px] rounded-lg bg-danger px-3 text-label font-medium text-shell transition-opacity duration-[var(--ly-t-quick)] hover:opacity-90"
              >
                开启完全访问权限
              </button>
            </div>
          </div>
        </Overlay>
      )}
    </>
  );
}
