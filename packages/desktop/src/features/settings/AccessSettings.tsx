/**
 * The two lists that decide what gets asked and what gets refused.
 *
 * Both exist because of the same idea: a prompt that fires constantly stops being a safeguard.
 * So the app asks less — and the price of asking less is that the answers it stops asking for
 * have to be visible and revocable somewhere. This is that somewhere.
 *
 * **Always-allowed** is what you said yes to permanently. Until now it could only grow: every
 * 「始终允许」 added a line nobody could ever see again, which is a permission granted and then
 * lost track of.
 *
 * **Internal hosts** is the other direction. Private addresses are refused outright rather than
 * asked about, because a prompt showing `169.254.169.254` is a question almost nobody can answer
 * correctly. Somebody who really does run a service on their own network needs a way to say so,
 * and it should be a decision made here, deliberately, rather than one made under a prompt in the
 * middle of a turn.
 */

import { useI18n } from "../../i18n/index.ts";
import { Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { bridge } from "../../services/index.ts";
import { useApp } from "../../store/index.ts";
import { TextInput } from "./inputs.tsx";
import { Card, Row, SectionTitle } from "./layout.tsx";
import { ProjectOverrideNotice } from "./ProjectOverrideNotice.tsx";
import { EmptyHint, GhostButton, Toggle } from "./controls.tsx";

export function AccessSettings() {
	const { t } = useI18n();
	const settings = useApp((s) => s.settings);
	const saveSettings = useApp((s) => s.saveSettings);
	const [host, setHost] = useState("");
	/*
	 * Whether the network switch is offered at all, which is a property of the machine.
	 *
	 * The Windows backend confines a process token's access to file objects and has no statement
	 * about sockets in it, so `confine` refuses a policy that denies the network there rather than
	 * applying half of it. That refusal is the right call and it arrives at the worst moment —
	 * every command failing to start, one turn into somebody's work. Asking the platform here
	 * turns it into a sentence read before the switch is thrown.
	 */
	const [platform, setPlatform] = useState("darwin");
	useEffect(() => {
		void bridge.system.platform().then(setPlatform);
	}, []);
	const networkCanBeDenied = platform !== "win32";

	if (!settings) return null;

	const allowed = settings.alwaysAllow ?? [];
	const hosts = settings.allowedHosts ?? [];

	const addHost = () => {
		const value = host.trim().toLowerCase();
		if (!value || hosts.includes(value)) return;
		void saveSettings({ ...settings, allowedHosts: [...hosts, value] });
		setHost("");
	};

	return (
		<div className="pt-8">
			<h1 className="text-display leading-tight font-semibold tracking-tight text-ink">{t("access.title")}</h1>
			<p className="mt-2 max-w-[600px] pb-7 text-label leading-relaxed text-ink-muted">
				{t("access.intro")}
			</p>

			<ProjectOverrideNotice keys={["alwaysAllow", "permissionMode"]} />
			<SectionTitle>{t("access.alwaysAllow")}</SectionTitle>
			<Card className="mb-6">
				{allowed.length === 0 ? (
					<div className="px-4 py-6">
						<EmptyHint>{t("access.alwaysAllowEmpty")}</EmptyHint>
					</div>
				) : (
					allowed.map((subject, index) => (
						<div
							key={subject}
							className={`group/row flex items-center gap-3 px-4 py-2.5 ${index === 0 ? "" : "border-t border-line-soft"}`}
						>
							<ShieldCheck size={14} strokeWidth={1.8} className="shrink-0 text-ok" />
							{/* The whole subject, wrapped rather than cut: these are commands and origins, and
							    the end of one is often the part that tells you what it was. */}
							<span className="min-w-0 flex-1 font-mono text-detail leading-relaxed break-all text-ink">{subject}</span>
							<button
								type="button"
								data-ly-tip={t("access.stopAuto")}
								aria-label={t("access.stopAutoFor", { subject })}
								onClick={() =>
									void saveSettings({ ...settings, alwaysAllow: allowed.filter((entry) => entry !== subject) })
								}
								className="shrink-0 rounded p-1 text-ink-faint opacity-0 transition-all group-hover/row:opacity-100 hover:text-danger focus-visible:opacity-100"
							>
								<Trash2 size={13} strokeWidth={1.8} />
							</button>
						</div>
					))
				)}
			</Card>

			<SectionTitle>{t("access.intranet")}</SectionTitle>
			<p className="mb-2 max-w-[600px] text-detail leading-relaxed text-ink-faint">
				{t("access.privateDenied")}
				{t("access.addYourOwn")}
			</p>
			<Card className="mb-6">
				<div className="flex items-center gap-2 px-4 py-3">
					<TextInput
						value={host}
						onChange={setHost}
						placeholder={t("access.hostPlaceholder")}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								addHost();
							}
						}}
					/>
					<GhostButton onClick={addHost} disabled={!host.trim()}>
						<Plus size={13} strokeWidth={2} />
						{t("mcp.add")}
					</GhostButton>
				</div>

				{hosts.length > 0 && (
					<div className="flex flex-wrap gap-1.5 border-t border-line-soft px-4 py-3">
						{hosts.map((entry) => (
							<span
								key={entry}
								className="flex items-center gap-1.5 rounded-md border border-line bg-card px-2 py-1 font-mono text-caption text-ink"
							>
								{entry}
								<button
									type="button"
									aria-label={t("access.removeEntry", { entry })}
									onClick={() =>
										void saveSettings({ ...settings, allowedHosts: hosts.filter((h) => h !== entry) })
									}
									className="text-ink-faint transition-colors hover:text-danger"
								>
									<X size={11} strokeWidth={2.4} />
								</button>
							</span>
						))}
					</div>
				)}
			</Card>

			{/*
			 * The limit of what a name can buy you, said plainly — otherwise this list reads as a
			 * general override, and somebody would use it as one.
			 */}
			<p className="max-w-[600px] pb-7 text-detail leading-relaxed text-ink-faint">
				{t("access.hostOnly")}
			</p>

			{/*
			 * The switch that does not go through the lists above.
			 *
			 * Both lists are decisions about a name — this subject, that host — and every one of
			 * them is reached by reading command text first. That reading is a blacklist and will
			 * keep missing spellings, so the last row on this page is the one that does not read
			 * anything: the kernel either hands the command a socket or it does not.
			 */}
			<SectionTitle>{t("access.commandNetwork")}</SectionTitle>
			<Card className="mb-8">
				<Row
					title={t("access.denyCommandNetwork")}
					detail={
						networkCanBeDenied ? t("access.denyCommandNetworkDetail") : t("access.denyCommandNetworkUnsupported")
					}
					control={
						networkCanBeDenied ? (
							<Toggle
								checked={settings.denyCommandNetwork ?? false}
								onChange={(denyCommandNetwork) => void saveSettings({ ...settings, denyCommandNetwork })}
								ariaLabel={t("access.denyCommandNetwork")}
							/>
						) : undefined
					}
				/>
			</Card>
		</div>
	);
}
