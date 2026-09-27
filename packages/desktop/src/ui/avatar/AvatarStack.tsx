/**
 * 一排小脸：这一批派出去的是谁、各自在干什么。
 *
 * 并排而不是叠着：叠起来的头像组说的是「有这么些人」，而这里每张脸自己有话说——谁在颠着干活、
 * 谁眯着眼在排队、谁已经交差——被邻居盖住半张脸，表情就读不出来了。
 *
 * 放不下的收成一个「+N」，数字本身就是提示：想看全的点开面板。
 */

import type { Avatar } from "../../lib/agent-avatar.ts";
import { AgentAvatar, type AvatarMood } from "./AgentAvatar.tsx";

export interface StackFace {
	key: string;
	avatar: Avatar;
	mood?: AvatarMood;
	/** 名字，决定眨眼的节奏。 */
	seed: string;
	/** 悬停时的那句话，同时是读屏念的名字。 */
	tip: string;
	onClick?: () => void;
}

export function AvatarStack({ faces, size = 20, max = 6, className = "" }: { faces: StackFace[]; size?: number; max?: number; className?: string }) {
	const shown = faces.length > max ? faces.slice(0, max - 1) : faces;
	const rest = faces.length - shown.length;
	return (
		<span className={`flex shrink-0 items-center gap-0.5 ${className}`} data-avatar-stack="">
			{shown.map((face) =>
				face.onClick ? (
					<button key={face.key} type="button" aria-label={face.tip} data-ly-tip={face.tip} data-stack-face={face.key} data-ly-avatar-host=""
						onClick={face.onClick} className="grid place-items-center rounded-md p-[3px] transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover">
						<AgentAvatar avatar={face.avatar} size={size} mood={face.mood} seed={face.seed} host="[data-ly-avatar-host]" />
					</button>
				) : (
					<span key={face.key} role="img" aria-label={face.tip} data-ly-tip={face.tip} data-stack-face={face.key} data-ly-avatar-host="" className="grid place-items-center p-[3px]">
						<AgentAvatar avatar={face.avatar} size={size} mood={face.mood} seed={face.seed} host="[data-ly-avatar-host]" />
					</span>
				),
			)}
			{rest > 0 && <span className="px-1 text-caption tabular-nums text-ink-faint">+{rest}</span>}
		</span>
	);
}
