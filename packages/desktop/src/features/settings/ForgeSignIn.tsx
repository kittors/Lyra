/**
 * Adding an account: pick a host, say where it is, paste a token.
 *
 * Three fields, and the middle one is the reason this app is not GitHub-only. Every host here runs
 * somewhere other than its own domain — a company GitLab, a self-run Gitea, GitHub Enterprise —
 * and the address is the whole difference between them.
 *
 * The token is the step that loses people, so the link beside it goes to the page that creates one
 * on *their* instance, with the scopes already filled in where the host allows it. Pointing at
 * gitlab.com's token page for somebody signing in to `git.corp` would be worse than no link.
 *
 * Nothing is stored until the host has confirmed who the token belongs to. A rejected token fails
 * here, on the form, while it is still on the clipboard — rather than in a pane somewhere else as
 * an empty list.
 */

import { translate } from "../../i18n/translate.ts";
import { ExternalLink, ShieldCheck } from "lucide-react";
import { ActionSpinner } from "../../ui/motion/loaders.tsx";
import { useState } from "react";
import type { ForgeKind, ForgeKindInfo } from "../../../electron/ipc-types.ts";
import { useAccountActions } from "../pull-requests/index.ts";
import { Field, GhostButton, PrimaryButton, SecretInput, TextInput } from "./controls.tsx";
import { bridge } from "../../services/index.ts";
import { useI18n } from "../../i18n/index.ts";

/**
 * Where a host keeps its token page, for the instance actually being signed in to.
 *
 * The hosted instances get the URL from the main process, scopes and all. Anything else gets the
 * path that host uses, appended to whatever address was typed — right for every self-hosted
 * deployment except one served from a sub-path, which is rare enough to be worth the link that
 * lands one click away instead of a link that lands nowhere.
 */
function tokenUrl(info: ForgeKindInfo, baseUrl: string): string | null {
	const base = baseUrl.trim().replace(/\/+$/, "");
	if (!base) return info.tokenUrl || null;
	if (info.baseUrl && base === info.baseUrl) return info.tokenUrl;

	switch (info.kind) {
		case "github":
			return `${base}/settings/tokens/new?scopes=repo,read:org,read:user&description=Lyra`;
		case "gitlab":
			return `${base}/-/user_settings/personal_access_tokens?name=Lyra&scopes=api`;
		case "gitee":
			return `${base}/personal_access_tokens/new`;
		case "gitea":
			return `${base}/user/settings/applications`;
	}
}

export function ForgeSignIn({ kinds, onDone, onCancel }: { kinds: ForgeKindInfo[]; onDone: () => void; onCancel: () => void }) {
	const { t } = useI18n();
	const { signIn } = useAccountActions();
	const [kind, setKind] = useState<ForgeKind>("github");
	const [baseUrl, setBaseUrl] = useState(kinds.find((k) => k.kind === "github")?.baseUrl ?? "https://github.com");
	const [token, setToken] = useState("");
	const [label, setLabel] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const info = kinds.find((entry) => entry.kind === kind) ?? kinds[0];
	const help = info ? tokenUrl(info, baseUrl) : null;

	/*
	 * Switching host refills the address, unless it has been edited into something else.
	 *
	 * A blank field after every switch means retyping `https://github.com` to try the obvious
	 * thing; keeping a stale `https://gitlab.com` under a GitHub heading is worse. Comparing
	 * against the defaults distinguishes "never touched it" from "typed my own", which is the
	 * only case where holding on to it is right.
	 */
	const choose = (next: ForgeKind) => {
		const untouched = kinds.some((entry) => entry.baseUrl && entry.baseUrl === baseUrl.trim()) || !baseUrl.trim();
		setKind(next);
		setError(null);
		if (untouched) setBaseUrl(kinds.find((entry) => entry.kind === next)?.baseUrl ?? "");
	};

	const save = async () => {
		setBusy(true);
		setError(null);
		const result = await signIn({ kind, baseUrl, token, label });
		setBusy(false);
		if (result.error) {
			setError(result.error);
			return;
		}
		onDone();
	};

	return (
		<div className="rounded-[12px] border border-line bg-card/40 p-4">
			<div className="mb-4 flex flex-wrap gap-1.5">
				{kinds.map((entry) => (
					<button
						key={entry.kind}
						type="button"
						onClick={() => choose(entry.kind)}
						className={`h-[30px] rounded-lg border px-3 text-label transition-colors ${
							kind === entry.kind ? "border-ink-faint bg-card-hover text-ink" : "border-line text-ink-muted hover:text-ink"
						}`}
					>
						{entry.name}
					</button>
				))}
			</div>

			{/* What is different about this host, said while the choice is still being made. */}
			{info?.note && <p className="mb-4 text-detail leading-relaxed text-ink-faint">{info.note}</p>}

			<div className="flex flex-col gap-3.5">
				<Field label={t("forge.baseUrl")} hint={t("forge.baseUrlDetail")}>
					<TextInput
						value={baseUrl}
						onChange={setBaseUrl}
						placeholder="https://git.example.com"
						mono
						spellCheck={false}
						autoComplete="off"
					/>
				</Field>

				<div>
					<div className="mb-1.5 flex items-center gap-2">
						<span className="text-label text-ink-muted">{t("forge.token")}</span>
						{help && (
							<button
								type="button"
								data-ly-tip={translate("forgeSignIn.create")}
								aria-label={translate("forgeSignIn.create")}
								onClick={() => void bridge.system.openExternal(help)}
								className="grid h-5 w-5 place-items-center rounded text-ink-faint transition-colors hover:text-ink"
							>
								<ExternalLink size={11} strokeWidth={2} aria-hidden />
							</button>
						)}
						{info?.scopes && <span className="text-caption text-ink-faint">{translate("forgeSignIn.needsScopes")} {info.scopes}</span>}
					</div>
					<SecretInput value={token} onChange={setToken} placeholder={t("forge.pasteToken")} />
					{/*
					 * 令牌存在哪儿、封到什么程度，说在粘贴框底下。
					 *
					 * 从前它是账号列表页底部常驻的一段小字，登录完之后再没人读——而关心这件事的那一刻
					 * 正是此刻：手里捏着一个刚生成的令牌，在决定要不要交给这个程序。最后那句「介意的话
					 * 给它设一个短一点的有效期」在这里是句能照做的建议，在列表页上只是一句感慨。
					 */}
					<p className="mt-2 flex items-start gap-1.5 text-caption leading-relaxed text-ink-faint">
						<ShieldCheck size={12} strokeWidth={1.8} className="mt-0.5 shrink-0" />
						{translate("forge.tokenStorageInline")}
					</p>
				</div>

				<Field label={t("forge.nickname")} hint={t("forge.nicknameDetail")}>
					<TextInput value={label} onChange={setLabel} placeholder={t("forge.nicknamePlaceholder")} />
				</Field>
			</div>

			{error && (
				<p className="mt-3 break-words rounded-[9px] border border-danger/35 bg-danger/8 px-3 py-2 text-detail leading-relaxed text-danger">
					{error}
				</p>
			)}

			{/* 动词写在按钮上。这两颗曾经是一个盾牌一个叉，名字挂在 tooltip 上——见 `DialogAction`。 */}
			<div className="mt-4 flex items-center gap-2">
				<PrimaryButton
					onClick={() => void save()}
					disabled={busy || !token.trim() || !baseUrl.trim()}
					icon={busy ? <ActionSpinner size={13} /> : <ShieldCheck size={13} strokeWidth={1.9} />}
				>
					{busy ? t("forge.verifying") : t("forge.verifyAndSave")}
				</PrimaryButton>
				<GhostButton onClick={onCancel}>{t("common.cancel")}</GhostButton>
			</div>
		</div>
	);
}
