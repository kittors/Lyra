/**
 * The line under a memory that says where it came from and whether it is doing anything.
 *
 * Three facts, in the order someone reads them: who wrote it, when, and — the one the plan calls
 * easy to miss — when it last reached the model. A memory that has not been injected since it was
 * written is not a memory yet; one not injected for months is one whose subject is gone. Neither
 * is visible from the text.
 */

import { relativeTime } from "../../lib/relative-time.ts";
import { useI18n, type MessageKey } from "../../i18n/index.ts";

export type MemorySource = "user" | "auto" | "session" | "learn" | "extracted";

/* 这张表在模块加载时成型，那会儿还不知道窗口是哪种语言——存 key，渲染时才译。 */
const SOURCE_WORD: Record<MemorySource, MessageKey> = {
	user: "memoryMeta.manual",
	auto: "memoryMeta.auto",
	session: "memoryMeta.inChat",
	learn: "memoryMeta.learnTool",
	extracted: "memoryMeta.background",
};

export function MemoryMeta({
	source,
	createdAt,
	lastInjectedAt,
	now = Date.now(),
}: {
	source: MemorySource;
	/** Epoch millis. */
	createdAt: number;
	/** Epoch millis; absent when it has never reached the model. */
	lastInjectedAt?: number;
	now?: number;
}) {
	const { t } = useI18n();
	const when = (at: number) => relativeTime(new Date(at).toISOString(), now);
	return (
		<span data-memory-meta className="flex flex-wrap items-center gap-x-1.5 text-caption text-ink-faint">
			<span data-memory-source>{t(SOURCE_WORD[source])}</span>
			<span className="text-line">·</span>
			<span>{when(createdAt)}写下</span>
			<span className="text-line">·</span>
			{lastInjectedAt === undefined ? (
				<span data-memory-injected="never">{t("memoryMeta.neverUsed")}</span>
			) : (
				<span data-memory-injected="at">最后注入 {when(lastInjectedAt)}</span>
			)}
		</span>
	);
}
