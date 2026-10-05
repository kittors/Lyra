/**
 * One provider, as a form.
 *
 * Everything needed to reach an endpoint: what to call it, where it is, which protocol it speaks
 * and the key. Its models are next door in `ProviderModels` — a different question, asked after
 * this one is answered.
 *
 * The text fields commit on every keystroke rather than on blur. Waiting for blur meant "测试连接"
 * clicked straight after typing a URL tested the previous one, which is the exact moment you are
 * least willing to believe the answer.
 */

import { useI18n } from "../../i18n/index.ts";
import { Input } from "../../ui/inputs/NativeField.tsx";
import type { ApiFormat, ModelConfig, ProviderConfig } from "@lyra/core";
import { Activity, Check, CircleAlert, CircleHelp, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import type { ProviderTestResult } from "../../../electron/ipc-types.ts";
import { useConfirmer } from "../../ui/overlay/Confirm.tsx";
import { DialogAction } from "../../ui/overlay/Dialog.tsx";
import { ActionSpinner } from "../../ui/motion/loaders.tsx";
import { IconButton } from "../../ui/primitives/IconButton.tsx";
import { SecretInput, Segmented, TextInput, Toggle } from "./controls.tsx";
import { Card, SectionTitle } from "./layout.tsx";
import { ProviderAvatar } from "./ProviderAvatar.tsx";
import { ProviderModels } from "./ProviderModels.tsx";

/*
 * Short names in the switch; which path each one posts to is in the help beside it. With the
 * paths the three segments no longer fit a 420px pane side by side.
 */
const API_OPTIONS: { value: ApiFormat; label: string }[] = [
	{ value: "openai-responses", label: "Responses" },
	{ value: "openai-chat-completions", label: "Chat Completions" },
	{ value: "anthropic-messages", label: "Messages" },
];

export function ProviderEditor({
	provider,
	defaultModelId,
	testResult,
	testing,
	testingModelId,
	modelTestResults,
	fetchingModels,
	fetchModelsError,
	onFetchModels,
	onTest,
	onTestModel,
	onChange,
	onRemove,
	onEditModel,
	onRemoveModel,
	onSetDefault,
}: {
	provider: ProviderConfig;
	defaultModelId: string | null;
	testResult: ProviderTestResult | null;
	testing: boolean;
	testingModelId?: string | null;
	modelTestResults?: Record<string, ProviderTestResult>;
	fetchingModels?: boolean;
	fetchModelsError?: string | null;
	onFetchModels?: () => void;
	onTest: () => void;
	onTestModel?: (modelId: string) => void;
	onChange: (patch: Partial<ProviderConfig>) => void;
	onRemove: () => void;
	onEditModel: (model: ModelConfig | null) => void;
	onRemoveModel: (modelId: string) => void;
	onSetDefault: (modelId: string) => void;
}) {
	const { t } = useI18n();
	const [baseUrl, setBaseUrl] = useState(provider.baseUrl);
	const [apiKey, setApiKey] = useState(provider.apiKey);

	return (
		/*
		 * Not `h-full`, which quietly took the bottom padding away from the panel it sits in.
		 *
		 * A scroll container's `padding-bottom` is part of what can be scrolled to — but only for
		 * content that is laid out inside it. `h-full` pinned this column to the *visible* height,
		 * so once there were more models than fitted, the rows ran past the bottom of a box that
		 * had already ended, and out through the padding with it.
		 *
		 * Nothing needed the height: this column is a stack of fields whose height is its contents.
		 */
		<div className="@container flex flex-col">
			<ProviderHeading provider={provider} onChange={onChange} onRemove={onRemove} />

			{/* A switched-off provider stays editable, only quieter: it is not the one in use. */}
			<div className={`transition-opacity ${provider.enabled ? "" : "opacity-60"}`}>
				<section className="pt-7">
					<SectionTitle>{t("provider.connection")}</SectionTitle>
					<Card data-ly-provider-connection="">
						<FieldRow label="Base URL">
							<TextInput
								mono
								value={baseUrl}
								onChange={(value) => {
									setBaseUrl(value);
									onChange({ baseUrl: value.trim() });
								}}
								placeholder="https://api.example.com/v1"
								spellCheck={false}
							/>
						</FieldRow>

						<FieldRow label={t("provider.apiFormat")}>
							<Segmented value={provider.api} onChange={(api) => onChange({ api })} options={API_OPTIONS} />
							<span role="img" aria-label={t("provider.apiFormatDetail")} data-ly-tip={t("provider.apiFormatDetail")} className="shrink-0 text-ink-faint">
								<CircleHelp size={14} strokeWidth={1.8} />
							</span>
						</FieldRow>

						{/*
						 * The test sits beside the key because the key is what it mostly tests: a wrong
						 * key is the usual failure, and the answer lands on the button you just pressed.
						 */}
						<FieldRow
							label="API Key"
							// Failure is the one outcome whose words matter: something has to be fixed, and only the endpoint knows what.
							note={testResult && !testResult.ok ? <p className="text-detail break-words text-danger">{testResult.message}</p> : null}
						>
							<SecretInput
								value={apiKey}
								onChange={(value) => {
									setApiKey(value);
									onChange({ apiKey: value });
								}}
								placeholder="sk-…"
							/>
							<TestButton result={testResult} testing={testing} onTest={onTest} />
						</FieldRow>
					</Card>
				</section>

				<ProviderModels
					models={provider.models}
					defaultModelId={defaultModelId}
					testing={testing}
					testingModelId={testingModelId}
					modelTestResults={modelTestResults}
					fetchingModels={fetchingModels}
					fetchModelsError={fetchModelsError}
					onFetchModels={onFetchModels}
					onTestModel={onTestModel}
					onEdit={onEditModel}
					onRemove={onRemoveModel}
					onSetDefault={onSetDefault}
				/>
			</div>
		</div>
	);
}

/**
 * A label and its control on one line; the label goes on top once the pane is too narrow for both.
 * Padded and ruled like `Row`, so this card reads as the same kind of card as every other page's.
 */
function FieldRow({ label, note, children }: { label: string; note?: React.ReactNode; children: React.ReactNode }) {
	return (
		<div className="grid grid-cols-1 gap-x-3 gap-y-1.5 border-b border-line-soft px-4 py-3 last:border-b-0 @md:grid-cols-[84px_minmax(0,1fr)] @md:items-center">
			<span className="text-label font-medium text-ink">{label}</span>
			<div className="flex min-w-0 items-center gap-2">{children}</div>
			{note && <div className="@md:col-start-2">{note}</div>}
		</div>
	);
}

/**
 * The verdict, on the button that asked for it.
 *
 * It used to be a box of its own at the foot of the page, under the model list — out of sight of
 * the key it was judging. A pass is a latency and a tick; the full message is in the tooltip.
 */
function TestButton({ result, testing, onTest }: { result: ProviderTestResult | null; testing: boolean; onTest: () => void }) {
	const { t } = useI18n();
	if (testing) {
		return (
			<DialogAction disabled className="shrink-0">
				<ActionSpinner size={13} />
				{t("providerModels.testing")}
			</DialogAction>
		);
	}
	if (result && !result.ok) {
		return (
			<DialogAction tone="danger" onClick={onTest} label={t("modelSettings.testConnection")} className="shrink-0" data-ly-provider-test="failed">
				<CircleAlert size={13} strokeWidth={2} aria-hidden />
				{t("providerModels.testFailed")}
			</DialogAction>
		);
	}
	return (
		<DialogAction
			onClick={onTest}
			label={result ? `${result.message}${result.latencyMs > 0 ? ` · ${result.latencyMs} ms` : ""}` : t("modelSettings.testConnection")}
			className="shrink-0"
			data-ly-provider-test={result ? "passed" : "idle"}
		>
			{result ? (
				// Coloured on the children: the secondary action's own colour is unlayered and outranks a utility on the button.
				<span className="flex items-center gap-1.5 text-ok">
					<Check size={13} strokeWidth={2.2} aria-hidden />
					<span className="font-mono tabular-nums">{result.latencyMs > 0 ? `${result.latencyMs}ms` : t("providerModels.testPassed")}</span>
				</span>
			) : (
				<>
					<Activity size={13} strokeWidth={1.9} aria-hidden />
					{t("provider.test")}
				</>
			)}
		</DialogAction>
	);
}

/** The name, what it is, and the things you can do to the provider as a whole. */
function ProviderHeading({
	provider,
	onChange,
	onRemove,
}: {
	provider: ProviderConfig;
	onChange: (patch: Partial<ProviderConfig>) => void;
	onRemove: () => void;
}) {
	const { t } = useI18n();
	const [name, setName] = useState(provider.name);
	const [renaming, setRenaming] = useState(false);
	const confirm = useConfirmer();
	const api = API_OPTIONS.find((option) => option.value === provider.api)?.label ?? provider.api;

	return (
		<div className="flex items-center gap-3">
			<ProviderAvatar name={provider.name} size="lg" className={provider.enabled ? "" : "opacity-50"} />
			<div className="min-w-0 flex-1">
				{renaming ? (
					<Input
						autoFocus
						value={name}
						onChange={(e) => setName(e.target.value)}
						onBlur={() => {
							setRenaming(false);
							if (name.trim() && name !== provider.name) onChange({ name: name.trim() });
						}}
						onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
						className="-mx-1.5 h-7 w-full max-w-[320px] rounded-md bg-card px-1.5 text-title font-semibold text-ink"
					/>
				) : (
					// The name is the rename control: a pencil beside it was a second thing saying the same.
					<button
						type="button"
						onClick={() => setRenaming(true)}
						data-ly-tip={t("provider.rename")}
						className="-mx-1.5 block h-7 max-w-full truncate rounded-md px-1.5 text-left text-title font-semibold tracking-tight text-ink transition-colors hover:bg-card-hover"
					>
						{provider.name}
					</button>
				)}
				<p className="text-detail text-ink-muted">{t("provider.summary", { api, n: provider.models.length })}</p>
			</div>

			{/* A switch says the state and the action at once, which the badge and the power button beside it had to split between them. */}
			<Toggle checked={provider.enabled} onChange={(enabled) => onChange({ enabled })} ariaLabel={t("provider.enable")} />
			{/* Two actions, both in sight: behind a ⋯ they were a menu to open before either could be found. */}
			<span className="flex items-center">
				<IconButton label={t("provider.rename")} onClick={() => setRenaming(true)} icon={<Pencil size={14} strokeWidth={1.8} />} data-ly-provider-rename="" />
				<IconButton
					label={t("provider.delete")}
					tone="danger"
					onClick={() =>
						confirm.ask({
							title: t("provider.deleteConfirm", { name: provider.name }),
							detail: t("provider.deleteDetail", { n: provider.models.length }),
							confirmLabel: t("common.delete"),
							onConfirm: onRemove,
						})
					}
					icon={<Trash2 size={14} strokeWidth={1.8} />}
					data-ly-provider-delete=""
				/>
			</span>

			{confirm.element}
		</div>
	);
}
