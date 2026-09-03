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

import { ExternalLink } from "lucide-react";
import { useState } from "react";
import type { ForgeKind, ForgeKindInfo } from "../../../electron/ipc-types.ts";
import { useAccountActions } from "../pr/useForgeAccounts.ts";
import { Field, GhostButton, PrimaryButton, SecretInput, TextInput } from "./controls.tsx";
import { bridge } from "../../services/index.ts";

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
				<Field label="服务地址" hint="自建实例填自己的域名，接口路径由应用补齐">
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
						<span className="text-label text-ink-muted">访问令牌</span>
						{help && (
							<button
								type="button"
								onClick={() => void bridge.system.openExternal(help)}
								className="flex items-center gap-0.5 text-caption text-ink-faint transition-colors hover:text-ink"
							>
								去创建
								<ExternalLink size={10} strokeWidth={2} />
							</button>
						)}
						{info?.scopes && <span className="text-caption text-ink-faint">需要 {info.scopes}</span>}
					</div>
					<SecretInput value={token} onChange={setToken} placeholder="粘贴访问令牌" />
				</div>

				<Field label="备注名（可选）" hint="留空就用「用户名 · 域名」">
					<TextInput value={label} onChange={setLabel} placeholder="工作账号" />
				</Field>
			</div>

			{error && (
				<p className="mt-3 break-words rounded-[9px] border border-danger/35 bg-danger/8 px-3 py-2 text-detail leading-relaxed text-danger">
					{error}
				</p>
			)}

			<div className="mt-4 flex items-center gap-2">
				<PrimaryButton onClick={() => void save()} disabled={busy || !token.trim() || !baseUrl.trim()}>
					{busy ? "验证中…" : "验证并保存"}
				</PrimaryButton>
				<GhostButton onClick={onCancel}>取消</GhostButton>
			</div>
		</div>
	);
}
