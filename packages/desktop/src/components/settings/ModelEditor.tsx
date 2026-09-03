import type { ModelConfig } from "@lyra/core";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { useState } from "react";
import { Overlay } from "../modals/Overlay.tsx";
import { Field, GhostButton, PrimaryButton, TextInput, Toggle } from "./controls.tsx";

export function ModelEditor({
	providerId,
	model,
	onSave,
	onCancel,
}: {
	providerId: string;
	model: ModelConfig | null;
	onSave: (model: ModelConfig) => void;
	onCancel: () => void;
}) {
	const [modelId, setModelId] = useState(model?.modelId ?? "");
	const [name, setName] = useState(model?.name ?? "");
	const [contextWindow, setContextWindow] = useState(String(model?.contextWindow ?? 200000));
	const [maxOutput, setMaxOutput] = useState(String(model?.maxOutputTokens ?? 16384));
	const [supportsThinking, setSupportsThinking] = useState(model?.supportsThinking ?? true);
	const [supportsImages, setSupportsImages] = useState(model?.supportsImages ?? true);
	const [priceIn, setPriceIn] = useState(String(model?.pricing?.input ?? ""));
	const [priceOut, setPriceOut] = useState(String(model?.pricing?.output ?? ""));

	const trimmedId = modelId.trim();
	/*
	 * Bounded, not merely positive.
	 *
	 * `> 0` let `1e99` and `1.5` through: the first makes the context meter read 0% forever and
	 * the second is sent to a provider that expects an integer. `maxOutput` also cannot exceed
	 * the window it is drawn from — a model that claims to write more than it can hold is a
	 * request that fails at the far end, with an error nobody can trace back to this form.
	 */
	const window_ = Number(contextWindow);
	const output = Number(maxOutput);
	const windowOk = Number.isInteger(window_) && window_ > 0 && window_ <= 100_000_000;
	const outputOk = Number.isInteger(output) && output > 0 && output <= window_;
	const valid = trimmedId.length > 0 && windowOk && outputOk;

	function submit() {
		if (!valid) return;
		const parsedIn = Number.parseFloat(priceIn);
		const parsedOut = Number.parseFloat(priceOut);
		onSave({
			// Keeping the id provider-scoped is what lets two providers expose the same model name.
			id: `${providerId}/${trimmedId}`,
			providerId,
			modelId: trimmedId,
			name: name.trim() || trimmedId,
			contextWindow: Number(contextWindow),
			maxOutputTokens: Number(maxOutput),
			supportsThinking,
			supportsImages,
			supportsTools: true,
			pricing:
				Number.isFinite(parsedIn) && Number.isFinite(parsedOut)
					? { input: parsedIn, output: parsedOut }
					: undefined,
		});
	}

	return (
		<Overlay onClose={onCancel} width={520}>
			<div className="border-b border-line px-5 py-3.5">
				<h3 className="text-body font-medium text-ink">{model ? "编辑模型" : "添加模型"}</h3>
			</div>

			<Scroller className="max-h-[60vh]" bottom="none" contentClassName="space-y-4 px-5 py-4">
				<Field label="模型 ID" hint="发送给供应商的实际模型名，例如 deepseek-v4-flash">
					<TextInput value={modelId} onChange={setModelId} placeholder="deepseek-v4-flash" mono spellCheck={false} />
				</Field>

				<Field label="显示名称" hint="留空则使用模型 ID">
					<TextInput value={name} onChange={setName} placeholder="DeepSeek V4 Flash" />
				</Field>

				{/* Marked on the field, not just by a dead Save button that says nothing about why. */}
				<div className="grid grid-cols-2 gap-3">
					<Field label="上下文窗口（token）" hint={windowOk ? undefined : "正整数，最大 1 亿"}>
						<TextInput
							value={contextWindow}
							onChange={setContextWindow}
							invalid={!windowOk}
							mono
							inputMode="numeric"
						/>
					</Field>
					<Field label="最大输出（token）" hint={outputOk ? undefined : "正整数，且不超过上下文窗口"}>
						<TextInput value={maxOutput} onChange={setMaxOutput} invalid={!outputOk} mono inputMode="numeric" />
					</Field>
				</div>

				<div className="grid grid-cols-2 gap-3">
					<Field label="输入价格（$/百万 token）">
						<TextInput value={priceIn} onChange={setPriceIn} placeholder="0.3" mono inputMode="decimal" />
					</Field>
					<Field label="输出价格（$/百万 token）">
						<TextInput value={priceOut} onChange={setPriceOut} placeholder="1.2" mono inputMode="decimal" />
					</Field>
				</div>

				<div className="space-y-3 rounded-[10px] border border-line px-3.5 py-3">
					<label className="flex items-center justify-between">
						<span className="text-label text-ink">支持思考 / 推理</span>
						<Toggle checked={supportsThinking} onChange={setSupportsThinking} />
					</label>
					<label className="flex items-center justify-between">
						<span className="text-label text-ink">支持图片输入</span>
						<Toggle checked={supportsImages} onChange={setSupportsImages} />
					</label>
				</div>
			</Scroller>

			<div className="flex justify-end gap-2 border-t border-line px-5 py-3">
				<GhostButton onClick={onCancel}>取消</GhostButton>
				<PrimaryButton onClick={submit} disabled={!valid}>
					保存
				</PrimaryButton>
			</div>
		</Overlay>
	);
}
