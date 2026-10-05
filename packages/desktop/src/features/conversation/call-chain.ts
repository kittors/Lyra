import type { AppearanceSettings } from "@lyra/core";
import { useApp } from "../../store/index.ts";

export type CallChain = NonNullable<AppearanceSettings["callChain"]>;

/**
 * Which tool-call layout the transcript draws — 设置 › 外观 › 调用链.
 *
 * `collapsed` before settings have loaded, which is the default. The chevron's half of the switch is CSS, keyed off `data-call-chain` on the
 * root (see `applyAppearance`).
 */
export function useCallChain(): CallChain {
	return useApp((s) => s.settings?.appearance.callChain ?? "collapsed");
}
