import type { CommandRun } from "@lyra/core";
import { Check, CircleAlert, Minus, Terminal } from "lucide-react";
import { FlowRow } from "./FlowRow.tsx";
import { MessageActions } from "./MessageActions.tsx";

/**
 * A local command is part of the transcript, but never a prompt sent to the agent.
 *
 * 状态那一行走 `FlowRow`，和思考行、工具行同一个骨架。它从前是 `min-h-9`（36px）配 `gap-2`，
 * 旁边一个转圈的图标——三种行三个高度、三种「正在跑」的说法，连着排下来左边缘是散的。
 *
 * 转圈也去掉了：正在跑这件事由那句字上的扫光说，一行只留一种动效。图标退回它本来的职责——
 * 说这是一条命令，以及它最后是成了还是败了。
 */
export function CommandRunRow({ command }: { command: CommandRun }) {
	const running = command.status === "running";
	const Icon = running ? Terminal : command.status === "done" ? Check : command.status === "failed" ? CircleAlert : Minus;
	return <div className="group/msg mb-4" data-command-run={command.id} data-command-status={command.status}>
		<div className="flex justify-end">
			<p className="max-w-[85%] whitespace-pre-wrap break-words rounded-[16px] rounded-br-[6px] bg-card px-4 py-2.5 text-body leading-relaxed">
				<span className="ly-command-token">/compact</span>{command.input.slice(8)}
			</p>
		</div>
		<MessageActions timestamp={command.timestamp} text={command.input} className="justify-end pr-1" />
		<FlowRow
			icon={<Icon size={13} strokeWidth={1.8} />}
			summary={command.detail}
			running={running}
			className={command.status === "failed" ? "text-danger hover:text-danger" : ""}
		/>
	</div>;
}
