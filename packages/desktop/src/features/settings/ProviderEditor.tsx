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

import type { ApiFormat, ModelConfig, ProviderConfig } from "@lyra/core";
import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import type { ProviderTestResult } from "../../../electron/ipc-types.ts";
import { useConfirmer } from "../../ui/overlay/Confirm.tsx";
import { Badge, Field, GhostButton, SecretInput, Select, TextInput } from "./controls.tsx";
import { ProviderModels } from "./ProviderModels.tsx";
import { RollingText } from "../../ui/motion/RollingText.tsx";

const API_OPTIONS: { value: ApiFormat; label: string }[] = [
	{ value: "openai-responses", label: "Responses (/responses)" },
	{ value: "openai-chat-completions", label: "Chat Completions (/chat/completions)" },
	{ value: "anthropic-messages", label: "Messages (/messages)" },
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
	const [baseUrl, setBaseUrl] = useState(provider.baseUrl);
	const [apiKey, setApiKey] = useState(provider.apiKey);

	return (
		/*
		 * Not `h-full`, which quietly took the bottom padding away from the panel it sits in.
		 *
		 * A scroll container's `padding-bottom` is part of what can be scrolled to — but only for
		 * content that is laid out inside it. `h-full` pinned this column to the *visible* height,
		 * so once there were more models than fitted, the rows ran past the bottom of a box that
		 * had already ended, and out through the padding with it. Scrolled to the end, 添加模型 sat
		 * flush against the card's edge with the 24px that every other side has nowhere to be seen.
		 *
		 * Nothing needed the height: this column is a stack of fields whose height is its contents.
		 */
		<div className="flex flex-col">
			<ProviderHeading provider={provider} onChange={onChange} onRemove={onRemove} />

			<div className="space-y-4">
				<Field label="Base URL" hint="例如 https://relay.example.com 或 https://relay.example.com/v1">
					<TextInput
						value={baseUrl}
						onChange={(value) => {
							setBaseUrl(value);
							onChange({ baseUrl: value.trim() });
						}}
						placeholder="https://api.example.com/v1"
						spellCheck={false}
					/>
				</Field>

				<Field
					label="API 格式"
					hint="Lyra 只对接 Responses 与 Anthropic Messages，不支持 Chat Completions。"
				>
					<Select value={provider.api} onChange={(api) => onChange({ api })} options={API_OPTIONS} />
				</Field>

				<Field label="API Key">
					<SecretInput
						value={apiKey}
						onChange={(value) => {
							setApiKey(value);
							onChange({ apiKey: value });
						}}
						placeholder="sk-…"
					/>
				</Field>
			</div>

			<ProviderModels
				models={provider.models}
				defaultModelId={defaultModelId}
				testResult={testResult}
				testing={testing}
				testingModelId={testingModelId}
				modelTestResults={modelTestResults}
				fetchingModels={fetchingModels}
				fetchModelsError={fetchModelsError}
				onFetchModels={onFetchModels}
				onTest={onTest}
				onTestModel={onTestModel}
				onEdit={onEditModel}
				onRemove={onRemoveModel}
				onSetDefault={onSetDefault}
			/>
		</div>
	);
}

/** The name, its state, and the two things you can do to the provider as a whole. */
function ProviderHeading({
	provider,
	onChange,
	onRemove,
}: {
	provider: ProviderConfig;
	onChange: (patch: Partial<ProviderConfig>) => void;
	onRemove: () => void;
}) {
	const [name, setName] = useState(provider.name);
	const [renaming, setRenaming] = useState(false);
	const confirm = useConfirmer();

	return (
		<div className="flex items-center gap-2.5 pb-6">
			{renaming ? (
				<input
					autoFocus
					value={name}
					onChange={(e) => setName(e.target.value)}
					onBlur={() => {
						setRenaming(false);
						if (name.trim() && name !== provider.name) onChange({ name: name.trim() });
					}}
					onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
					className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-input px-2.5 text-title font-semibold text-ink focus:border-ink-faint"
				/>
			) : (
				<>
					<h2 className="text-title font-semibold tracking-tight text-ink">{provider.name}</h2>
					<button
						type="button"
						data-ly-tip="重命名"
						aria-label="重命名供应商"
						onClick={() => setRenaming(true)}
						className="text-ink-faint transition-colors hover:text-ink"
					>
						<Pencil size={13.5} strokeWidth={1.8} />
					</button>
				</>
			)}

			<Badge tone={provider.enabled ? "ok" : "muted"}>
				<RollingText>{provider.enabled ? "已启用" : "已禁用"}</RollingText>
			</Badge>
			<GhostButton onClick={() => onChange({ enabled: !provider.enabled })}>
				<RollingText>{provider.enabled ? "禁用" : "启用"}</RollingText>
			</GhostButton>

			<div className="flex-1" />
			<button
				type="button"
				data-ly-tip="删除供应商"
				aria-label="删除供应商"
				onClick={() =>
					confirm.ask({
						title: `删除 ${provider.name}？`,
						detail: `它的地址、密钥，以及配置在它下面的 ${provider.models.length} 个模型都会一起删掉。`,
						confirmLabel: "删除",
						onConfirm: onRemove,
					})
				}
				className="text-ink-faint transition-colors hover:text-danger"
			>
				<Trash2 size={15} strokeWidth={1.8} />
			</button>

			{confirm.element}
		</div>
	);
}
