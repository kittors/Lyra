/**
 * 填一台 MCP 服务要的钥匙：API key、访问令牌、连接串。
 *
 * 这件事从前没有地方做。包里的声明带着 `${BRAVE_API_KEY}` 这样的空位，设置页上只有「命令」和
 * 「参数」两个框，env 根本不显示——一个要钥匙的服务装上之后，唯一的办法是去手改
 * `~/.lyra/settings.json`，而改完的钥匙明文躺在那个会被同步、被拷贝、被贴进 issue 的文件里。
 *
 * 现在：每一个要填的值一行，写着它是什么、去哪里申请；填完失焦就存，存的时候进保险箱（见 core 的
 * `config/settings.ts`），文件里只留那个空位。登录 shell 里已经 export 过的，这里说一声「已从环境
 * 变量读取」，不逼人再填一遍——也可以填一个覆盖它。
 *
 * 市场的详情页和设置 › MCP 用的是这同一个组件：同一把钥匙在两处有两种填法，迟早会一处存进了保险箱、
 * 另一处存成了明文。
 */

import type { McpNeed, McpServerConfig } from "@lyra/core";
import { isPlaceholder, looksSecret, needsOf } from "@lyra/core/mcp-placeholders";
import { Check, ExternalLink, KeyRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useI18n } from "../../i18n/index.ts";
import { useApp } from "../../store/index.ts";
import { bridge } from "../../services/index.ts";
import { SecretInput, TextInput } from "../settings/index.ts";

/**
 * 这些变量名里，登录 shell 里已经有值的那几个。只问名字，值永远不过进程边界。
 */
export function useEnvironment(names: string[]): Set<string> {
	const key = [...new Set(names)].sort().join("|");
	const [present, setPresent] = useState<Set<string>>(() => new Set());
	useEffect(() => {
		if (!key) return setPresent(new Set());
		let alive = true;
		void bridge.plugins
			.environment?.(key.split("|"))
			.then((found) => alive && setPresent(new Set(found)))
			.catch(() => {});
		return () => {
			alive = false;
		};
	}, [key]);
	return present;
}

/** 一台服务还缺哪几个：不能不填、没填、环境里也没有的。 */
export function missingOf(server: McpServerConfig, present: Set<string>): string[] {
	return needsOf(server)
		.filter((need) => !need.optional && !filled(server, need.name) && !present.has(need.name))
		.map((need) => need.name);
}

function filled(server: McpServerConfig, name: string): boolean {
	const value = server.env?.[name];
	return value !== undefined && value !== "" && !isPlaceholder(value);
}

/**
 * 一组服务（通常是一个包带来的那一两台）要填的全部值，按名字合并：两台服务要同一个 token，就只问
 * 一次，存的时候两台都写上。
 */
export function McpKeys({
	servers,
	notes,
	compact,
}: {
	servers: McpServerConfig[];
	/** 包对这些值的说明，行里没带（旧版本装的）时用它补上。 */
	notes?: McpNeed[];
	/** 放在设置页的卡片里：不要标题，行距紧一点。 */
	compact?: boolean;
}) {
	const { t } = useI18n();
	const settings = useApp((s) => s.settings);
	const saveSettings = useApp((s) => s.saveSettings);

	const needs = useMemo(() => {
		const byName = new Map<string, McpNeed>();
		for (const server of servers) for (const need of needsOf(server)) if (!byName.has(need.name)) byName.set(need.name, need);
		for (const note of notes ?? []) {
			const had = byName.get(note.name);
			byName.set(note.name, had ? { ...note, ...had, description: had.description ?? note.description, url: had.url ?? note.url } : note);
		}
		return [...byName.values()];
	}, [servers, notes]);
	const present = useEnvironment(needs.map((need) => need.name));

	if (!settings || needs.length === 0) return null;

	const save = (name: string, value: string) => {
		const ids = new Set(servers.filter((server) => needsOf(server).some((need) => need.name === name) || servers.length === 1).map((server) => server.id));
		const trimmed = value.trim();
		void saveSettings({
			...settings,
			mcpServers: settings.mcpServers.map((server) => {
				if (!ids.has(server.id)) return server;
				// 清空就退回成空位：它仍然说着「这里要一个值」，而不是像空字符串那样什么都不说。
				return { ...server, env: { ...server.env, [name]: trimmed === "" ? `\${${name}}` : trimmed } } as McpServerConfig;
			}),
		});
	};

	return (
		<div data-mcp-keys="" className={compact ? "space-y-3" : "space-y-4"}>
			{needs.map((need) => {
				const holder = servers.find((server) => filled(server, need.name));
				const value = holder?.env?.[need.name] ?? "";
				return (
					<KeyRow
						key={need.name}
						need={need}
						value={value}
						fromShell={!value && present.has(need.name)}
						onSave={(next) => save(need.name, next)}
						compact={compact}
					/>
				);
			})}
			{!compact && <p className="text-caption leading-relaxed text-ink-faint">{t("mcpKeys.vaultNote")}</p>}
		</div>
	);
}

function KeyRow({
	need,
	value,
	fromShell,
	onSave,
	compact,
}: {
	need: McpNeed;
	value: string;
	fromShell: boolean;
	onSave: (value: string) => void;
	compact?: boolean;
}) {
	const { t } = useI18n();
	const [draft, setDraft] = useState(value);
	const [saved, setSaved] = useState(false);
	// 别处改了（另一个页面、自动更新带过来的），这一格跟着变——除非人正在这一格里打字。
	useEffect(() => setDraft(value), [value]);
	useEffect(() => {
		if (!saved) return;
		const timer = setTimeout(() => setSaved(false), 1800);
		return () => clearTimeout(timer);
	}, [saved]);

	const secret = need.secret ?? looksSecret(need.name);
	const commit = (next: string) => {
		if (next.trim() === value.trim()) return;
		onSave(next);
		setSaved(true);
	};

	return (
		<div data-mcp-key={need.name}>
			<div className="flex items-center gap-2 pb-1.5">
				<KeyRound size={12} strokeWidth={1.9} className="shrink-0 text-ink-faint" aria-hidden />
				<span className="font-mono text-detail text-ink">{need.name}</span>
				{need.optional && <span className="text-caption text-ink-faint">{t("mcpKeys.optional")}</span>}
				<span className="ml-auto flex items-center gap-2">
					{saved ? (
						<span className="flex items-center gap-1 text-caption text-ok">
							<Check size={11} strokeWidth={2.4} aria-hidden />
							{t("mcpKeys.saved")}
						</span>
					) : value ? (
						<span className="text-caption text-ink-faint">{t("mcpKeys.stored")}</span>
					) : fromShell ? (
						<span className="text-caption text-ink-faint">{t("mcpKeys.fromShell")}</span>
					) : null}
					{need.url && (
						<button
							type="button"
							onClick={() => void bridge.system.openExternal(need.url!)}
							className="flex items-center gap-1 text-caption text-ink-muted transition-colors duration-[var(--ly-t-quick)] hover:text-ink"
						>
							{t("mcpKeys.getOne")}
							<ExternalLink size={10} strokeWidth={2} aria-hidden />
						</button>
					)}
				</span>
			</div>
			{need.description && !compact && <p className="pb-2 text-caption leading-relaxed text-ink-muted">{need.description}</p>}
			<div
				onKeyDown={(event) => {
					if (event.key === "Enter") commit(draft);
				}}
			>
				{secret ? (
					<SecretInput value={draft} onChange={setDraft} onBlur={commit} placeholder={fromShell ? t("mcpKeys.overrideShell") : t("mcpKeys.paste")} />
				) : (
					<TextInput
						value={draft}
						onChange={setDraft}
						onBlur={() => commit(draft)}
						mono
						placeholder={fromShell ? t("mcpKeys.overrideShell") : t("mcpKeys.fill")}
					/>
				)}
			</div>
		</div>
	);
}
