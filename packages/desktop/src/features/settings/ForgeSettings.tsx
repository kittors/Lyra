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
 * The page says out loud where the token goes and how it is protected, including when it is not.
 * A machine with no keyring stores it in plain text, and a settings page that quietly implied
 * otherwise would be the one thing here worth being angry about.
 */

import { Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { ForgeAccount, ForgeKindInfo } from "../../../electron/ipc-types.ts";
import { Avatar } from "../pull-requests/Avatar.tsx";
import { useAccountActions, useForgeAccounts } from "../pull-requests/useForgeAccounts.ts";
import { Badge, Card, EmptyHint, GhostButton, ListRow, SectionTitle, TextInput, Toggle } from "./controls.tsx";
import { ForgeSignIn } from "./ForgeSignIn.tsx";
import { bridge } from "../../services/index.ts";

export function ForgeSettings() {
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

	return (
		<div className="pt-8">
			<h1 className="text-display leading-tight font-semibold tracking-tight text-ink">代码托管</h1>
			<p className="mt-2 max-w-[600px] pb-7 text-label leading-relaxed text-ink-muted">
				添加账号后，「拉取请求」里会汇总所有账号下等你审查和由你创建的 Pull Request，可以直接评论、批准、请求修改。
				支持 GitHub、GitLab、Gitee、Gitea/Forgejo，<strong className="font-medium text-ink">自建实例填自己的域名即可</strong>
				，不依赖任何命令行工具。
			</p>

			<SectionTitle>账号</SectionTitle>
			<div className="mb-3">
				{accounts.length === 0 && !adding && (
					<Card>
						<EmptyHint>还没有账号。添加一个，就能在「拉取请求」里看到它的 Pull Request。</EmptyHint>
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
									<Badge tone="muted">{nameOf(account)}</Badge>
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
								`${account.login || "未知用户"} · ${host(account.baseUrl)}`
							)
						}
						actions={
							editing === account.id ? null : (
								<>
									<GhostButton title="重命名" icon={<Pencil size={13} strokeWidth={1.8} />} onClick={() => setEditing(account.id)} />
									<GhostButton
										title="退出登录并删除令牌"
										tone="danger"
										icon={<Trash2 size={13} strokeWidth={1.8} />}
										onClick={() => void signOut(account.id)}
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
				<GhostButton icon={<Plus size={14} strokeWidth={2} />} onClick={() => setAdding(true)}>
					添加账号
				</GhostButton>
			)}

			{/*
			 * Where the token lives, stated rather than assumed.
			 *
			 * One version, and it states the limit rather than implying there is none. The token was
			 * sealed by the OS keychain until the keychain turned out not to survive an update on
			 * macOS — every release is a different code identity to an ad-hoc signed app, so signing
			 * in again was part of updating. It is now sealed with a key kept beside it, which is a
			 * smaller claim: it keeps the token out of the files that travel, and it does not defend
			 * against something already reading your home directory. Saying so is the point.
			 */}
			<p className="mt-8 flex max-w-[600px] items-start gap-2 pb-8 text-detail leading-relaxed text-ink-faint">
				<ShieldCheck size={13} strokeWidth={1.8} className="mt-0.5 shrink-0" />
				令牌加密后存在 ~/.lyra/forges.json（权限
				0600），密钥在同目录的 vault.key，不会写进 settings.json，也不会同步到移动端。界面永远不会把它读回来。能读到你主目录的程序也能解开它——介意的话，给令牌设一个短一点的有效期。
			</p>
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
			className="h-[30px] w-full max-w-[280px]"
			onKeyDown={(event) => {
				if (event.key === "Enter") onDone(value);
				if (event.key === "Escape") onCancel();
			}}
			onBlur={() => onDone(value)}
		/>
	);
}
