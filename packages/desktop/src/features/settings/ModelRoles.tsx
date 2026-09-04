/**
 * 按用途给模型起名字：`@fast`、`@deep`、`@review`。
 *
 * 这一层存在的理由是**可移植**。一个子代理定义写 `model: anthropic/claude-haiku-4-5`，只在写它
 * 的那台机器上成立；从市场装它的人有另一套供应商，拿到的是一次失败的派生，或者更糟——安静地
 * 退回会话当前的模型，行为变了而屏幕上什么都没说。所以定义写 `@fast`，每台机器自己决定
 * 「快」是谁。
 *
 * 在这之前，这几个角色只能手改 `settings.json`——而它们已经在跑了：把纠正判成规则用 `@fast`，
 * 后台抽取记忆也用 `@fast`。两个功能依赖一个没有界面的设置，那不是「还没做 UI」，
 * 那是一个只有读过源码的人才能用的功能。
 *
 * 「默认」不是一个角色，是没有角色时的去处，所以它不在这个表里——它在上面那个供应商列表里，
 * 是每个模型旁边的那颗星。
 */

import type { Settings } from "@lyra/core";
/*
 * 从子入口，不是从包根。
 *
 * 从 `@lyra/core` 导入一个**值**会把整个 index 拉进渲染器，而它一路碰到 `node:fs`、
 * `node:os`——包能加载，然后在第一个 Node 内置模块上抛出来，窗口一片空白。这条我是先撞上
 * 才想起来的：`ScheduledView.tsx` 里那段注释写的就是同一件事。类型编译时就没了，不要紧。
 */
import { availableModels, MODEL_ROLES, ROLE_DESCRIPTIONS, roleStatus, type ModelRole } from "@lyra/core/model-roles";
import { AlertTriangle } from "lucide-react";
import { useApp } from "../../store/index.ts";
import { Card, InlineSelect, Row, SectionTitle } from "./controls.tsx";

/** `default` 由那颗星决定，不在这里配。 */
const CONFIGURABLE: ModelRole[] = MODEL_ROLES.filter((role) => role !== "default");

const TITLES: Record<ModelRole, string> = {
	default: "默认",
	fast: "@fast · 快而便宜",
	deep: "@deep · 复杂推理",
	review: "@review · 审查与顾问",
};

const FOLLOW_DEFAULT = "";

export function ModelRoles() {
	const settings = useApp((s) => s.settings);
	const saveSettings = useApp((s) => s.saveSettings);
	if (!settings) return null;

	const status = new Map(roleStatus(settings).map((entry) => [entry.role, entry]));
	const models = availableModels(settings);

	/*
	 * 「跟随默认」永远排在第一个，而且是空字符串。
	 *
	 * 一个角色没有配，跟它配到了默认模型，不是同一件事：前者会跟着默认模型一起变，后者会在
	 * 有人换默认模型之后留在原地——而那正是「换了模型之后子代理还在用旧的」这种查起来最费劲的
	 * 一类问题。
	 */
	const options = [
		{ value: FOLLOW_DEFAULT, label: "跟随默认模型" },
		...models.map(({ provider, model }) => ({ value: model.id, label: model.name, detail: provider.name })),
	];

	const setRole = (role: ModelRole, id: string) => {
		const roles = { ...settings.modelRoles };
		if (id === FOLLOW_DEFAULT) delete roles[role];
		else roles[role] = id;
		void saveSettings({ ...settings, modelRoles: roles } as Settings);
	};

	return (
		<>
			<SectionTitle>模型角色</SectionTitle>
			<Card>
				{CONFIGURABLE.map((role) => {
					const current = status.get(role);
					/*
					 * 指到一个已经不存在的模型，比没配更糟。
					 *
					 * 用它的子代理会安静地退回会话当前的模型、跑出不一样的行为，而这一页会显示一个
					 * 看起来配好了的名字。所以这里显示的是「还在不在」，不只是「配了什么」。
					 */
					const dangling = Boolean(current?.id) && current?.resolves === false;
					return (
						<Row
							key={role}
							title={TITLES[role]}
							detail={
								dangling ? (
									<span className="flex items-center gap-1.5 text-danger">
										<AlertTriangle size={12} strokeWidth={2} aria-hidden />
										配的是 {current?.id}，这台机器上已经没有这个模型了——用到它的地方会退回默认模型。
									</span>
								) : (
									ROLE_DESCRIPTIONS[role]
								)
							}
							control={
								<InlineSelect
									value={dangling ? FOLLOW_DEFAULT : (current?.id ?? FOLLOW_DEFAULT)}
									onChange={(id) => setRole(role, id)}
									options={dangling ? [{ value: current!.id!, label: `${current!.id}（已失效）` }, ...options] : options}
									ariaLabel={`${TITLES[role]} 用哪个模型`}
								/>
							}
						/>
					);
				})}
			</Card>
		</>
	);
}
