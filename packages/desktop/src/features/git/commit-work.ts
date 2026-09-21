/**
 * 一次提交，活在弹窗外面。
 *
 * 提交弹窗是个 `Overlay`：关掉就卸载。而它做的几件事都是要等的——「留空自动生成」要模型写两三秒，
 * 「提交并推送」更久。这些状态从前全长在弹窗自己的 `useState` 上，于是按下 Esc 或点一下遮罩的
 * 那一刻：转圈没了，生成到一半的那句话没了，工具条上那颗按钮一无所知地画成禁用的灰色——而磁盘
 * 上那件事照样在跑。再打开弹窗，迎面是一个崭新的空框，刚才那一下有没有发生，界面上无从知道。
 *
 * 所以这一份状态归面板持有，弹窗只是它的视图。关掉再打开，看到的还是原来那一个：同一句话、
 * 同一行在转。按钮那边也终于有得可读——`active` 就是「这件事还在跑」，它既是转圈的理由，也是
 * 那颗按钮在忙的时候仍然该可以按下去的理由（按下去是回到弹窗，不是取消：本地的提交没有取消
 * 这回事，模型写到一半也叫不回来）。
 *
 * 不在这里的是 `includeUnstaged`：它跟着暂存区的数目走（一个没暂存就默认带上未暂存的），重开
 * 时按当下的数目重算才是对的，记住上一回的勾选反而会拿一个过期的判断盖住现状。
 */

import { useEffect, useState } from "react";

/** 弹窗底下那三行，哪一行正在跑。 */
type CommitAction = "commit" | "commitAndPush" | "push";

/** 提交到哪儿：当前这个分支，还是一个还没建出来的新分支。 */
type CommitTarget = { kind: "current" } | { kind: "new"; name: string };
export interface CommitWork {
	/** 输入框里那句话。生成出来的也写回这儿——它得比弹窗活得久。 */
	message: string;
	setMessage: (value: string) => void;
	/** 提交到哪个分支。新分支到真提交那一刻才创建，所以这里存的只是个名字。 */
	target: CommitTarget;
	setTarget: (value: CommitTarget) => void;
	/** 正在跑的那一个动作，没有就是 null。 */
	action: CommitAction | null;
	setAction: (value: CommitAction | null) => void;
	/** 模型正在写提交说明。它可以和 `action` 同时为真——提交的第一步就是把话写出来。 */
	generating: boolean;
	setGenerating: (value: boolean) => void;
	/** 有活在跑。工具条那颗按钮据此转圈，也据此在忙的时候仍然可以按。 */
	active: boolean;
}

export function useCommitWork(cwd: string | null): CommitWork {
	const [message, setMessage] = useState("");
	const [target, setTarget] = useState<CommitTarget>({ kind: "current" });
	const [action, setAction] = useState<CommitAction | null>(null);
	const [generating, setGenerating] = useState(false);

	/*
	 * 换一个仓库，草稿不跟着走。
	 *
	 * 一句写给 A 仓库的提交说明出现在 B 仓库的输入框里，是会被直接提交上去的——那句话读起来完全
	 * 正常，只是讲的是另一个仓库的事。分支目标同理：「新分支 fix/foo」是对着刚才那个仓库选的。
	 *
	 * 跑着的那件事不清：它属于按下按钮时的那个仓库，`finally` 会把它收干净。在这里抹掉只会让
	 * 转圈停在一件还没结束的事上。
	 */
	useEffect(() => {
		setMessage("");
		setTarget({ kind: "current" });
	}, [cwd]);

	return {
		message,
		setMessage,
		target,
		setTarget,
		action,
		setAction,
		generating,
		setGenerating,
		active: action !== null || generating,
	};
}
