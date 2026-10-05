/**
 * The code hosts this app is signed in to.
 *
 * This page exists because the pull request pane used to be a GitHub feature wearing a general
 * name. It ran `gh`, so it needed a CLI installed, a separate login, and it had exactly one
 * identity — and to anybody on GitLab or Gitee it read as "this app does not work".
 *
 * What replaced it is here: an account is a host, an address and a token, and there can be as many
 * as somebody actually has. Each one becomes a tab in the pane.
 *
 * 令牌存在哪儿、封到什么程度，这件事仍然明说，只是不在这一页——它跟着令牌输入框走，在
 * `ForgeSignIn` 里。关心它的那一刻是手里捏着令牌准备粘进去的那一刻，而不是之后每一次打开这一页。
 */

import { translate } from "../../i18n/translate.ts";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { ForgeAccount, ForgeKindInfo } from "../../../electron/ipc-types.ts";
import { Avatar } from "../pull-requests/index.ts";
import { useAccountActions, useForgeAccounts } from "../pull-requests/index.ts";
import { IconButton } from "../../ui/primitives/IconButton.tsx";
import { Badge, Card, EmptyHint, ListRow, SectionTitle, TextInput, Toggle } from "./controls.tsx";
import { DialogAction } from "../../ui/overlay/Dialog.tsx";
import { ForgeBrandIcon } from "./ForgeBrandIcon.tsx";
import { ForgeSignIn } from "./ForgeSignIn.tsx";
import { bridge } from "../../services/index.ts";
import { useI18n } from "../../i18n/index.ts";

export function ForgeSettings() {
	const { t } = useI18n();
	const { accounts } = useForgeAccounts();
	const { setEnabled, signOut, rename } = useAccountActions();
	const [kinds, setKinds] = useState<ForgeKindInfo[]>([]);
	const [adding, setAdding] = useState(false);
	const [editing, setEditing] = useState<string | null>(null);

	useEffect(() => {
		void bridge.forge
			.kinds()
			.then((answer) => setKinds(answer.kinds ?? []))
			.catch(() => {});
	}, []);

	const nameOf = (account: ForgeAccount) => kinds.find((k) => k.kind === account.kind)?.name ?? account.kind;

	/**
	 * 第二行只说标题行还没说的那一部分，两样都没有就没有第二行。
	 *
	 * 它从前一律写 `登录名 · 主机`。而标题行画的就是登录名——`label` 默认取的正是它——旁边那枚
	 * 徽章又已经答了是哪一家，于是绝大多数账号的第二行是「kittors · github.com」：前半截和上面
	 * 一字不差，后半截是徽章说过的话换个写法。一行占位，零信息。
	 *
	 * 两样分开判断，各自只在真的有话说时出现：
	 *
	 * - **登录名**：只有名字被改过才写。改名的用途正是「这是我的工作号」，那时底下是谁就成了
	 *   必要信息；没改过时它和标题行是同一个字符串。
	 * - **主机**：只有自建实例才写。官方实例的地址是徽章的同义反复，而一个自建的
	 *   `git.company.com` 是这一行唯一说得出、别处说不出的事。
	 *
	 * `kinds` 还没到的时候不猜主机——宁可少说一行，也不要先画出来再让它消失。
	 */
	const identityOf = (account: ForgeAccount): string | null => {
		const parts: string[] = [];
		const login = account.login || "";
		if (login && login !== account.label) parts.push(login);
		const kindInfo = kinds.find((k) => k.kind === account.kind);
		const at = host(account.baseUrl);
		if (kindInfo && at && at !== host(kindInfo.baseUrl)) parts.push(at);
		return parts.length > 0 ? parts.join(" · ") : null;
	};

	return (
		<div className="pt-8">
			<h1 className="text-display leading-tight font-semibold tracking-tight text-ink">{t("forge.title")}</h1>
			<p className="mt-2 max-w-[600px] pb-7 text-label leading-relaxed text-ink-muted">
				{translate("forge.intro")}
			</p>

			<SectionTitle>{t("common.account")}</SectionTitle>
			<div className="mb-3">
				{accounts.length === 0 && !adding && (
					<Card>
						<EmptyHint>{t("forge.empty")}</EmptyHint>
					</Card>
				)}

				{accounts.map((account) => (
					<ListRow
						key={account.id}
						icon={<Avatar accountId={account.id} login={account.login} url={account.avatarUrl} size={26} />}
						title={
							editing === account.id ? (
								/*
								 * Renaming happens in place, not in a dialog.
								 *
								 * It is one field and its whole purpose is telling two rows apart — a modal
								 * for that hides the very thing being disambiguated.
								 */
								<RenameField
									initial={account.label}
									onDone={(value) => {
										void rename(account.id, value);
										setEditing(null);
									}}
									onCancel={() => setEditing(null)}
								/>
							) : (
								<span className="flex items-center gap-2">
									<span className="truncate">{account.label}</span>
									<Badge tone="muted">
										<span className="flex items-center gap-1.5">
											<span>{nameOf(account)}</span>
											<ForgeBrandIcon kind={account.kind} />
										</span>
									</Badge>
								</span>
							)
						}
						/*
						 * The last failure replaces the identity line rather than sitting beside the name.
						 *
						 * These messages are a sentence long — "GitLab 令牌无效或已过期，去设置里重新填一个" —
						 * and on the title row they pushed the name they were about into an ellipsis. The
						 * second line is where a row already says the less important thing, and when
						 * something is broken *this* is the less important thing to lose.
						 *
						 * Also drawn on the pane's tab strip, and it belongs in both places: this is where
						 * the fix is, and that is where the symptom appears.
						 */
						detail={
							account.lastError && account.enabled ? (
								<span className="text-danger">{account.lastError}</span>
							) : (
								identityOf(account)
							)
						}
						actions={
							editing === account.id ? null : (
								/*
								 * 无边框，因为这一行已经有一个边框了。
								 *
								 * 每个图标各自带一个方框，加上右边开关的轨道，一行里三个圆角矩形排着——
								 * 画出来的结构比这行的内容还多。`subtle` 只在悬停时给底色，指到哪里哪里
								 * 亮，这一行剩下的边框就只有开关那一个，而它是真的在表示状态。
								 */
								<>
									<IconButton
										className="ly-row-action"
										size="sm"
										label={t("common.rename")}
										icon={<Pencil size={13} strokeWidth={1.8} />}
										onClick={() => setEditing(account.id)}
									/>
									<IconButton
										className="ly-row-action"
										size="sm"
										label={t("forge.signOut")}
										icon={<Trash2 size={13} strokeWidth={1.8} />}
										onClick={() => void signOut(account.id)}
										tone="danger"
									/>
								</>
							)
						}
						control={
							editing === account.id ? undefined : (
								<Toggle checked={account.enabled} onChange={(on) => void setEnabled(account.id, on)} />
							)
						}
					/>
				))}
			</div>

			{adding ? (
				<ForgeSignIn kinds={kinds} onDone={() => setAdding(false)} onCancel={() => setAdding(false)} />
			) : (
				<DialogAction onClick={() => setAdding(true)} label={t("prList.addAccount")} data-ly-add-forge="">
					<Plus size={14} strokeWidth={2} aria-hidden />
					{t("prList.addAccount")}
				</DialogAction>
			)}

			{/*
			 * 令牌存在哪儿，这一段搬到登录表单里去了（见 `ForgeSignIn`）。
			 *
			 * 它说的事没有作废——令牌是用旁边那把钥匙封的，不是系统钥匙串，所以它防的是「跟着文件
			 * 一起旅行」，不防已经能读你主目录的东西。这句限度是要讲明的。
			 *
			 * 但它从前是常驻在账号列表下面的四行小字，而登录之后再读它的人是零：关心令牌存哪儿的
			 * 那一刻，正是手里捏着令牌、准备粘进去的那一刻。所以它跟着令牌输入框走，列表页留给账号。
			 */}
			<div className="pb-8" />
		</div>
	);
}

function host(baseUrl: string): string {
	try {
		return new URL(baseUrl).host;
	} catch {
		return baseUrl;
	}
}

/** Enter commits, Escape abandons — the two things anybody tries on an inline field. */
function RenameField({
	initial,
	onDone,
	onCancel,
}: {
	initial: string;
	onDone: (value: string) => void;
	onCancel: () => void;
}) {
	const [value, setValue] = useState(initial);
	return (
		<TextInput
			value={value}
			onChange={setValue}
			autoFocus
			className="pointer-events-auto h-[26px] w-full max-w-[280px]"
			onKeyDown={(event) => {
				if (event.key === "Enter") onDone(value);
				if (event.key === "Escape") onCancel();
			}}
			onBlur={() => onDone(value)}
		/>
	);
}
