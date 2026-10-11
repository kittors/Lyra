/**
 * The rows of the 「会话」 section on the agents page: the ones that are not an agent.
 *
 * Out of `AgentsSettings` so that page stays about agents; these share its row shape and nothing else.
 */

import type { Settings } from "@lyra/core";
import { imageModelRows } from "@lyra/core/image-models";
import { Palette } from "lucide-react";
import { useI18n } from "../../i18n/index.ts";
import { ModelSelect } from "../models/index.ts";

/**
 * 会话那两行的下拉，和上面智能体那一列模型对齐：宽的时候后面空出思考等级和 ⋯ 那么宽（124 + 32
 * 加两道间距），窄的时候和智能体那几行一样掉到名字下面。
 */
export function SessionControl({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex w-full min-w-0 items-center pl-[46px] @xl:w-auto @xl:shrink-0 @xl:pl-0 @xl:pr-[164px]">
			<div className="min-w-0 flex-1 @xl:w-[196px] @xl:flex-none [&>button]:w-full [&>button]:max-w-none">{children}</div>
		</div>
	);
}

/** 会话那两行没有脸，用一枚圆底的记号占住头像那一列，文字才和上面的名字对齐。 */
export function SessionMark({ icon }: { icon: React.ReactNode }) {
	return <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full bg-card text-ink-muted">{icon}</span>;
}

/**
 * The model `image_generate` draws with, in the same row shape as the two above.
 *
 * "Automatic" is the first image model configured, so adding one is all it takes. With none, the row
 * says where to add one rather than offering an empty menu.
 */
export function ImageModelRow({ settings, disabled, onChange }: { settings: Settings; disabled: boolean; onChange: (modelId: string | null) => void }) {
	const { t } = useI18n();
	const rows = imageModelRows(settings.providers);
	return (
		<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[10px] px-2.5 py-2.5" data-agent-profile="image">
			<SessionMark icon={<Palette size={15} strokeWidth={1.8} />} />
			<div className="min-w-0 flex-1 @xl:min-w-[160px]">
				<div className="text-body text-ink">{t("agents.imageModel")}</div>
				<div className="mt-0.5 text-detail text-ink-faint">{rows.length > 0 ? t("agents.imageModelDetail") : t("agents.imageModelNone")}</div>
			</div>
			<SessionControl>
				<ModelSelect quiet kind="image" ariaLabel={t("agents.imageModel")} value={settings.imageModelId ?? ""} inheritLabel={t("agents.imageModelAuto")} inheritedModelId={rows[0]?.model.id} inheritedSource={t("agents.imageModelAutoShort")} inheritDetail={t("agents.imageModelDetail")} disabled={disabled || rows.length === 0}
					onChange={(modelId) => onChange(modelId || null)} />
			</SessionControl>
		</div>
	);
}
