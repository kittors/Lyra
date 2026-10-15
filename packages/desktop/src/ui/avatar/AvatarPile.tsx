/**
 * A pile of faces: more than one sent off, stacked to say "there are several".
 *
 * Not the same thing as `AvatarStack`. That one lays faces side by side, each expression readable —
 * for "who is in this batch". This one stacks them in less room and says "there are a few here, open
 * it" — the bar above the composer, the switcher at the top of the panel and the "results are back"
 * row in the transcript use it. Expressions stay: a running one still bobs, half its face under a
 * neighbour.
 *
 * Order matters: each coin lies on the one before it, like cards dealt left to right, so the last one
 * dealt is whole and "+N" is the last of all. The other way round, the plus of "+2" sat under its
 * left neighbour and read as "-2", and the pile looked dealt backwards.
 *
 * Every face sits on a round coin: differently shaped faces stacked bare, a triangle on a cloud, read
 * as one blot. Under a coin, the one before it is cut away rather than painted over, so nothing of a
 * covered face shows through whatever the pile sits on (`styles/avatar.css`). Under the pointer the
 * pile fans out a little, like a hand of cards being spread.
 */

import type { Avatar } from "../../lib/agent-avatar.ts";
import { AgentAvatar, type AvatarMood } from "./AgentAvatar.tsx";

export interface PileFace {
	key: string;
	avatar: Avatar;
	mood?: AvatarMood;
	seed: string;
}

export function AvatarPile({ faces, size = 22, max = 3, focus, className = "" }: {
	faces: PileFace[];
	size?: number;
	max?: number;
	/**
	 * 要完整露出来的那一张（面板顶上：正在看的那个）。
	 *
	 * 它排在露出来的那几张的最后——也就是最上面，紧挨着旁边写它名字的标题。放不下的时候先让出别人的
	 * 位置，它自己一定在。
	 */
	focus?: string;
	className?: string;
}) {
	const lead = focus ? faces.find((face) => face.key === focus) : undefined;
	const others = lead ? faces.filter((face) => face !== lead) : faces;
	/** 放得下几张脸：放不下全部时，最后一格留给「+N」。 */
	const room = faces.length > max ? max - 1 : faces.length;
	const shown = lead ? [...others.slice(0, Math.max(0, room - 1)), lead] : others.slice(0, room);
	const rest = faces.length - shown.length;
	return (
		<span
			className={`ly-avatar-pile ${className}`}
			// 一共几枚（算上「+N」）——右边留白按它算，松开时最后一枚不压到旁边的字。
			style={{ "--ly-pile-size": `${size}px`, "--ly-pile-n": shown.length + (rest > 0 ? 1 : 0) } as React.CSSProperties}
			data-avatar-pile=""
			aria-hidden
		>
			{shown.map((face, index) => (
				<span key={face.key} className="ly-avatar-coin" style={{ "--ly-pile-i": index, zIndex: index + 1 } as React.CSSProperties} data-pile-face={face.key}>
					<AgentAvatar avatar={face.avatar} size={Math.round(size * 0.74)} mood={face.mood} seed={face.seed} interactive={false} />
				</span>
			))}
			{rest > 0 && (
				<span className="ly-avatar-coin ly-avatar-coin-more" style={{ "--ly-pile-i": shown.length, zIndex: shown.length + 1 } as React.CSSProperties} data-pile-more="">
					+{rest}
				</span>
			)}
		</span>
	);
}
