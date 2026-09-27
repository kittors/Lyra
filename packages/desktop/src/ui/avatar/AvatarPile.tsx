/**
 * 一摞脸：派出去不止一个时，叠在一起说「有好几个」。
 *
 * 和 `AvatarStack` 是两件事。那一排并排摆开，每张脸都看得清表情，适合「这一批都是谁」的场合；
 * 这一摞叠着放，占地方小，说的是「这里有好几个，点开看」——输入框上方那条、面板顶上那个切换器
 * 用它。表情仍然在：在跑的还在颠，只是被邻居盖住半张脸。
 *
 * 叠放有先后：后一张压在前一张上面，像一张一张往右放下去的牌，最后放下的那张完整露出来，「+N」
 * 是最后一张。反过来（前一张压后一张）时，「+2」的加号被它左边那张盖住，读出来像「-2」，一摞
 * 牌也像是从右往左倒着放的。
 *
 * 每张脸垫一枚圆底、外面一圈底色，叠起来才分得清谁是谁：形状各不相同的脸直接叠，三角压着云朵，
 * 读起来是一团色块。指针进来的时候这一摞往右松开一点，像一叠牌被拨开。
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
