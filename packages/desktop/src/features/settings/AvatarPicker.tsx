/**
 * 给一个智能体挑脸：十六种形状、十六种颜色。
 *
 * 别人已经在用的那张不让选——「每个智能体都长得不一样」是这套东西的全部意义，允许撞脸就等于
 * 没有它。撞上的格子仍然看得见、仍然能悬停，提示里说是谁在用：藏起来的话，人会以为那种形状
 * 根本不存在。
 */

import { Check } from "lucide-react";
import { AVATAR_COLORS, AVATAR_SHAPES, formatAvatar, type Avatar, type AvatarColor, type AvatarShape } from "../../lib/agent-avatar.ts";
import { AgentAvatar } from "../../ui/avatar/AgentAvatar.tsx";
import { COLOR_ART } from "../../ui/avatar/art.ts";
import { useI18n, type MessageKey } from "../../i18n/index.ts";

/* 名字是 key，译发生在画的时候。 */
const shapeName = (shape: AvatarShape): MessageKey => `avatar.shape.${shape}`;
const colorName = (color: AvatarColor): MessageKey => `avatar.color.${color}`;

/** 「云朵 · 紫」。形状在前、中间一个点：各语言形容词和名词的语序、性数配合各不相同，拼成一句话总有一种语言读着别扭。 */
export function avatarName(avatar: Avatar, t: (key: MessageKey) => string): string {
	return `${t(shapeName(avatar.shape))} · ${t(colorName(avatar.color))}`;
}

export function AvatarPicker({ value, owners, onChange }: {
	value: Avatar;
	/** `形状-颜色` → 正在用它的那个智能体的名字。 */
	owners: ReadonlyMap<string, string>;
	onChange: (next: Avatar) => void;
}) {
	const { t } = useI18n();
	const tip = (face: Avatar, name: string) => {
		const owner = owners.get(formatAvatar(face));
		return owner ? t("agentEditor.avatarTaken", { name: owner }) : name;
	};
	return (
		<div className="w-[316px] p-3" data-avatar-picker="">
			<p className="mb-1.5 px-0.5 text-detail text-ink-faint">{t("agentEditor.avatarShapes")}</p>
			<div role="radiogroup" aria-label={t("agentEditor.avatarShapes")} className="grid grid-cols-8 gap-1">
				{AVATAR_SHAPES.map((shape) => {
					const face = { shape, color: value.color };
					const selected = shape === value.shape;
					const taken = !selected && owners.has(formatAvatar(face));
					return (
						<button key={shape} type="button" role="radio" aria-checked={selected} aria-disabled={taken || undefined}
							aria-label={t(shapeName(shape))} data-ly-tip={tip(face, t(shapeName(shape)))} data-avatar-shape={shape}
							onClick={() => { if (!taken) onChange(face); }}
							className={`grid h-9 w-9 place-items-center rounded-[10px] transition-[background-color,opacity] duration-[var(--ly-t-quick)] ${
								selected ? "bg-card-hover" : taken ? "cursor-not-allowed opacity-30" : "hover:bg-card-hover"
							}`}>
							<AgentAvatar avatar={face} size={24} seed={shape} interactive={!taken} />
						</button>
					);
				})}
			</div>
			<p className="mt-3 mb-1.5 px-0.5 text-detail text-ink-faint">{t("agentEditor.avatarColors")}</p>
			<div role="radiogroup" aria-label={t("agentEditor.avatarColors")} className="grid grid-cols-8 gap-1">
				{AVATAR_COLORS.map((color) => {
					const face = { shape: value.shape, color };
					const selected = color === value.color;
					const taken = !selected && owners.has(formatAvatar(face));
					return (
						<button key={color} type="button" role="radio" aria-checked={selected} aria-disabled={taken || undefined}
							aria-label={t(colorName(color))} data-ly-tip={tip(face, t(colorName(color)))} data-avatar-color={color}
							onClick={() => { if (!taken) onChange(face); }}
							className={`grid h-9 w-9 place-items-center rounded-full transition-opacity duration-[var(--ly-t-quick)] ${taken ? "cursor-not-allowed opacity-30" : ""}`}>
							{/* 选中的那一格外面套一圈字色的环，里面打个勾——光靠环，浅色的黄、薄荷在白底上看不清。 */}
							<span className={`grid h-[22px] w-[22px] place-items-center rounded-full transition-transform duration-[var(--ly-t-quick)] ${selected ? "ring-2 ring-ink/70 ring-offset-2 ring-offset-float" : "hover:scale-110"}`}
								style={{ background: COLOR_ART[color] }}>
								{selected && <Check size={12} strokeWidth={3} className="text-white" aria-hidden />}
							</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}
