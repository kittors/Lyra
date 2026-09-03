/**
 * The models one provider offers, and whether the connection works.
 *
 * Separate from the provider's own fields because they answer different questions. The fields
 * above are "how do I reach this thing"; this is "what can it do, and did it answer" — which is
 * also the order you fill them in, and the only part you come back to later.
 *
 * The test outcome lives here rather than beside the URL for the same reason: what a successful
 * test tells you is which models the endpoint reports, so it belongs next to the list you are
 * about to compare it against.
 */

import { Check, CircleAlert, CloudDownload, Link2, Loader2, Pencil, Play, Plus, RefreshCw, Trash2 } from "lucide-react";
import type { ModelConfig } from "@lyra/core";
import type { ProviderTestResult } from "../../../electron/ipc-types.ts";
import { useConfirmer } from "../../ui/overlay/Confirm.tsx";
import { ModelIcon } from "../ModelIcon.tsx";
import { formatWindow } from "../ModelMenu.tsx";
import { ScrollText } from "../../ui/scroll/ScrollText.tsx";
import { Badge, GhostButton } from "./controls.tsx";

export function ProviderModels({
	models,
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
	onEdit,
	onRemove,
	onSetDefault,
}: {
	models: ModelConfig[];
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
	/** `null` adds a new one. */
	onEdit: (model: ModelConfig | null) => void;
	onRemove: (modelId: string) => void;
	onSetDefault: (modelId: string) => void;
}) {
	return (
		<div className="pt-6">
			<div className="mb-2 flex items-center justify-between">
				<div className="flex items-center gap-2">
					<span className="text-label text-ink-muted">模型列表</span>
					{models.length > 0 && (
						<span className="rounded-md bg-card-hover px-1.5 py-0.5 text-micro font-medium text-ink-faint">
							{models.length}
						</span>
					)}
				</div>
				<div className="flex items-center gap-1.5">
					{onFetchModels && (
						<button
							type="button"
							onClick={onFetchModels}
							disabled={fetchingModels || testing}
							data-ly-tip="从当前 Base URL 端点自动获取可用模型列表"
							className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-caption font-medium text-ink-muted transition-colors hover:bg-card-hover hover:text-ink disabled:opacity-50 cursor-pointer"
						>
							{fetchingModels ? (
								<Loader2 size={13} strokeWidth={2} className="animate-spin text-accent" />
							) : (
								<CloudDownload size={13.5} strokeWidth={1.8} />
							)}
							<span>{fetchingModels ? "获取中…" : "拉取模型"}</span>
						</button>
					)}
					<GhostButton onClick={onTest} disabled={testing || !!testingModelId || fetchingModels}>
						<span>{testing ? "测试中…" : "测试全部"}</span>
					</GhostButton>
				</div>
			</div>

			{fetchModelsError && (
				<div className="mb-2 flex items-center gap-1.5 rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-caption text-rose-500">
					<CircleAlert size={13} className="shrink-0" />
					<span className="truncate">{fetchModelsError}</span>
				</div>
			)}

			<div className="space-y-2">
				{models.map((model) => (
					<ModelRow
						key={model.id}
						model={model}
						isDefault={defaultModelId === model.id}
						testing={testingModelId === model.id}
						testResult={modelTestResults?.[model.id]}
						onTest={() => onTestModel?.(model.id)}
						onEdit={() => onEdit(model)}
						onRemove={() => onRemove(model.id)}
						onSetDefault={() => onSetDefault(model.id)}
					/>
				))}

				<button
					type="button"
					onClick={() => onEdit(null)}
					className="flex h-[38px] items-center gap-2 rounded-[10px] border border-line px-3 text-label text-ink-muted transition-colors hover:border-ink-faint hover:text-ink cursor-pointer"
				>
					<Plus size={14} strokeWidth={1.9} />
					添加模型
				</button>
			</div>

			{testResult && <TestOutcome result={testResult} />}
		</div>
	);
}

function ModelRow({
	model,
	isDefault,
	testing,
	testResult,
	onTest,
	onEdit,
	onRemove,
	onSetDefault,
}: {
	model: ModelConfig;
	isDefault: boolean;
	testing: boolean;
	testResult?: ProviderTestResult;
	onTest: () => void;
	onEdit: () => void;
	onRemove: () => void;
	onSetDefault: () => void;
}) {
	const confirm = useConfirmer();

	return (
		<div className="group/row flex flex-col rounded-[10px] border border-line bg-input transition-colors duration-150">
			<div className="flex h-[46px] items-center gap-2.5 px-3.5">
				{/* Tighter than the row's own spacing: the mark belongs to the id beside it, and at the
				    row's 12px it read as a separate column. */}
				<span className="flex min-w-0 flex-1 items-center gap-2">
					<ModelIcon model={model.modelId} name={model.name} size={15} />
					<ScrollText text={model.modelId} className="min-w-0 flex-1 font-mono text-label text-ink" />
				</span>

				{/* Single model test quick status badge if tested */}
				{testResult && (
					<span
						data-ly-tip={`${testResult.ok ? "测试通过" : "测试失败"} · ${testResult.message}`}
						className={`flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-caption tabular-nums transition-colors ${
							testResult.ok ? "bg-ok/10 text-ok" : "bg-danger/10 text-danger"
						}`}
					>
						{testResult.ok ? (
							<Check size={11} strokeWidth={2.4} className="shrink-0" />
						) : (
							<CircleAlert size={11} strokeWidth={2.4} className="shrink-0" />
						)}
						{testResult.latencyMs > 0 && `${testResult.latencyMs}ms`}
					</span>
				)}

				{isDefault && <Badge tone="accent">默认</Badge>}
				<span className="rounded bg-card px-1.5 py-0.5 font-mono text-caption text-ink-faint">
					{formatWindow(model.contextWindow)}
				</span>

				<button
					type="button"
					data-ly-tip={testing ? "正在测试连接…" : "测试此模型"}
					aria-label="测试此模型"
					disabled={testing}
					onClick={onTest}
					className={`flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition-all hover:bg-card hover:text-ink active:scale-95 ${
						testing ? "text-accent" : ""
					}`}
				>
					{testing ? (
						<RefreshCw size={13} strokeWidth={2} className="animate-spin text-accent" />
					) : (
						<Play size={13} strokeWidth={1.9} className="ml-0.5" />
					)}
				</button>

				<button
					type="button"
					data-ly-tip="设为默认模型"
					aria-label="设为默认模型"
					onClick={onSetDefault}
					className="flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-card hover:text-ink"
				>
					<Link2 size={14} strokeWidth={1.8} />
				</button>
				<button
					type="button"
					data-ly-tip="编辑"
					aria-label="编辑模型"
					onClick={onEdit}
					className="flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-card hover:text-ink"
				>
					<Pencil size={14} strokeWidth={1.8} />
				</button>
				<button
					type="button"
					data-ly-tip="删除"
					aria-label="删除模型"
					onClick={() =>
						confirm.ask({
							title: `删除 ${model.modelId}？`,
							detail: isDefault ? "它是当前的默认模型，删掉之后要另选一个。" : undefined,
							confirmLabel: "删除",
							onConfirm: onRemove,
						})
					}
					className="flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-card hover:text-danger"
				>
					<Trash2 size={14} strokeWidth={1.8} />
				</button>
			</div>

			{/* If the individual test had an error, show a quiet informative line below the row */}
			{testResult && !testResult.ok && (
				<div className="border-t border-danger/20 bg-danger/5 px-3.5 py-1.5 text-detail text-danger">
					<span className="font-medium">连接失败: </span>
					{testResult.message}
				</div>
			)}

			{confirm.element}
		</div>
	);
}

/**
 * The verdict, and only the verdict.
 *
 * It used to hang the endpoint's whole model list off the result behind a disclosure — 47 names
 * nobody asked for, in answer to "does this work". A connection test has one useful answer and one
 * useful number: whether it went through, and how long it took. The names of models the endpoint
 * happens to serve are a different question, and the model list above is where it is asked.
 *
 * Failure is the exception: then the message *is* the answer, because something has to be fixed and
 * only the endpoint knows what.
 */
function TestOutcome({ result }: { result: ProviderTestResult }) {
	return (
		<div
			className={`mt-3 rounded-[10px] border px-3.5 py-2.5 text-label ${
				result.ok ? "border-ok/35 bg-ok/8 text-ok" : "border-danger/35 bg-danger/8 text-danger"
			}`}
		>
			{result.message}
			{result.latencyMs > 0 && <span className="opacity-70"> · {result.latencyMs} ms</span>}
		</div>
	);
}
