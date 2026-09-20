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

import { translate } from "../../i18n/translate.ts";
import { Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { ForgeAccount, ForgeKindInfo } from "../../../electron/ipc-types.ts";
import { Avatar } from "../pull-requests/index.ts";
import { useAccountActions, useForgeAccounts } from "../pull-requests/index.ts";
import { IconButton } from "../../ui/primitives/IconButton.tsx";
import { Badge, Card, EmptyHint, ListRow, SectionTitle, TextInput, Toggle } from "./controls.tsx";
import { DialogAction } from "../../ui/overlay/Dialog.tsx";
import { ForgeSignIn } from "./ForgeSignIn.tsx";
import { bridge } from "../../services/index.ts";
import { useI18n } from "../../i18n/index.ts";

function ForgeBrandIcon({ kind }: { kind: string }) {
	switch (kind) {
		case "github":
			return (
				<svg width={13} height={13} viewBox="0 0 24 24" fill="currentColor" aria-hidden className="shrink-0 text-[#24292f] dark:text-[#f0f6fc]">
					<path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
				</svg>
			);
		case "gitlab":
			return (
				<svg width={13} height={13} viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0">
					<path d="M23.6 9.58 22.3.62a.75.75 0 0 0-1.38-.15L18.1 7.6H5.9L3.08.47A.75.75 0 0 0 1.7.62L.4 9.58a1.5 1.5 0 0 0 .54 1.48l11.06 8.04 11.06-8.04a1.5 1.5 0 0 0 .54-1.48z" fill="#E24329" />
					<path d="m12 19.1-3.9-11.5h7.8L12 19.1z" fill="#E24329" />
					<path d="M12 19.1 8.1 7.6H5.9l6.1 11.5z" fill="#FC6D26" />
					<path d="m12 19.1 3.9-11.5h2.2L12 19.1z" fill="#FC6D26" />
					<path d="m.94 11.06 11.06 8.04-8.8-11.5-2.26 3.46z" fill="#FCA326" />
					<path d="m23.06 11.06-11.06 8.04 8.8-11.5 2.26 3.46z" fill="#FCA326" />
				</svg>
			);
		case "gitee":
			return (
				<svg width={13} height={13} viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0">
					<path fillRule="evenodd" clipRule="evenodd" d="M11.999 0C5.373 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.6.111.82-.26.82-.577v-2.234c-3.338.726-4.043-1.61-4.043-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.09-.745.083-.729.083-.729 1.205.084 1.84 1.237 1.84 1.237 1.07 1.834 2.809 1.304 3.493.997.108-.775.419-1.304.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .32.218.694.825.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12.001-12z" fill="#C71D23" />
				</svg>
			);
		case "gitea":
			return (
				<svg width={13} height={13} viewBox="0 0 24 24" fill="currentColor" aria-hidden className="shrink-0 text-[#609926]">
					<path d="M12.002 0A12 12 0 0 0 0 12c0 4.72 2.73 8.8 6.69 10.74l1.37-3.75A8 8 0 1 1 20 12h-4l5.5 8.5L24 12a12 12 0 0 0-11.998-12z" />
				</svg>
			);
		default:
			return null;
	}
}

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
				{translate("forge.tokenStorageInline")}
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
			className="pointer-events-auto h-[26px] w-full max-w-[280px]"
			onKeyDown={(event) => {
				if (event.key === "Enter") onDone(value);
				if (event.key === "Escape") onCancel();
			}}
			onBlur={() => onDone(value)}
		/>
	);
}
