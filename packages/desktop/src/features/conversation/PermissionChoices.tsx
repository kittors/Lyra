import { translate } from "../../i18n/translate.ts";
import { Check, ShieldCheck, X } from "lucide-react";
import { useRef, useState } from "react";
import { ApprovalButton } from "./ApprovalButton.tsx";

export function PermissionChoices({ subject, onceOnly = false, answer }: {
	subject?: string;
	/** Only this one call can be granted — an escalation — so there is no "stop asking" to offer. */
	onceOnly?: boolean;
	answer(decision: "once" | "always" | "reject"): Promise<void>;
}) {
	const submitting = useRef(false);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");
	async function submit(decision: "once" | "always" | "reject") {
		if (submitting.current) return;
		submitting.current = true;
		setPending(true); setError("");
		try { await answer(decision); }
		catch (failure) {
			submitting.current = false; setPending(false);
			setError(failure instanceof Error ? failure.message : String(failure));
		}
	}
	/*
	 * 字在按钮上，不在 tooltip 里。
	 *
	 * `2354076e` 那次统一把动作按钮的字收进了 tooltip，这一张卡片不该跟着走：三个选项里有两个
	 * 是不可撤销的（放行一次、以后都不再问），而图标分不出「盾牌」和「对勾」哪个是永久授权——
	 * 要停下来 hover 才敢点的按钮，等于没有默认答案。同一个卡片体系里的提问卡（`QuestionChoices`）
	 * 本来就是带字的，所以这里补上字是把两者**对齐**，不是开特例。
	 *
	 * 「拒绝」推到最左，和右边那两个隔开：相邻的一次误点代价不对称，最贵的那个不该挨着最便宜的。
	 */
	return <div className="shrink-0 px-4 pb-3 pt-1" data-ly-permission-choices="">
		<div className="flex flex-wrap items-center justify-end gap-1.5" aria-busy={pending}>
			<ApprovalButton disabled={pending} onClick={() => void submit("reject")} className="mr-auto" icon={<X size={14} />}>{translate("permission.reject")}</ApprovalButton>
			{!onceOnly && <ApprovalButton disabled={pending} onClick={() => void submit("always")} data-ly-tip={subject ? translate("permission.neverAskFor", { subject }) : translate("permission.neverAsk")} icon={<ShieldCheck size={14} />}>{translate("permission.never")}</ApprovalButton>}
			<ApprovalButton tone="primary" disabled={pending} onClick={() => void submit("once")} icon={<Check size={14} />}>{translate("permission.once")}</ApprovalButton>
		</div>
		{error && <p role="alert" className="mt-2 break-words text-caption text-danger">{error}</p>}
	</div>;
}
