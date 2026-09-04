/**
 * The model settings page: a list of providers on one side, the selected one on the other.
 *
 * Only the layout lives here. What editing a provider actually does — and the consequences that
 * are easy to miss, like a removed provider orphaning the default model — is in `useProviders`,
 * and what a provider looks like is in `ProviderEditor`. Three files, three questions.
 */

import type { ModelConfig } from "@lyra/core";
import { Box, Plus, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { ScrollText } from "../../ui/scroll/ScrollText.tsx";
import { GhostButton } from "./controls.tsx";
import { FetchModelsModal } from "./FetchModelsModal.tsx";
import { ModelEditor } from "./ModelEditor.tsx";
import { ModelRoles } from "./ModelRoles.tsx";
import { ProviderEditor } from "./ProviderEditor.tsx";
import { useProviders } from "./useProviders.ts";

export function ModelSettings() {
  const p = useProviders();
  const [editingModel, setEditingModel] = useState<{
    providerId: string;
    model: ModelConfig | null;
  } | null>(null);

  return (
    /*
     * 整页可滚，因为它不再只有那一块两栏了。
     *
     * 两栏原本是 `flex-1` 独占整个高度，模型角色接在它下面之后，在 680px 高的窗口里把它压成了
     * 一条——供应商列表还在，右边的编辑器一点不剩。给两栏一个下限、让页面自己滚，是这两块
     * 都能好好待着的唯一排法。
     */
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <header className="flex shrink-0 items-start justify-between pt-8 pb-6">
        <div>
          <h1 className="text-display leading-tight font-semibold tracking-tight text-ink">
            模型设置
          </h1>
          <p className="mt-2 text-label text-ink-muted">
            管理自定义模型供应商，配置后可在聊天时选择使用。
          </p>
        </div>
        <button
          type="button"
          data-ly-tip="测试当前供应商连接"
          aria-label="测试当前供应商连接"
          onClick={() => void p.test()}
          className="mt-1 flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-card-hover hover:text-ink"
        >
          <RefreshCw
            size={16}
            strokeWidth={1.8}
            className={p.testing ? "ly-pulse" : undefined}
          />
        </button>
      </header>

      {/*
       * Side by side when there is room, stacked when there is not.
       *
       * The list used to be a fixed 268px that never gave any of it back, so in a narrow
       * window the editor beside it was left with whatever remained — at 420px that was
       * 70px, and every field became a slot with one character in it. Measured against
       * this container rather than the window, because the settings pane is the full width
       * of a narrow window and a fraction of a wide one.
       */}
      {/* The query element and the queried element cannot be the same one: a container is
				    sized by its contents, so it is only ever asked about by its descendants. */}
      <div className="@container flex min-h-[340px] flex-1">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-line bg-card/30 @2xl:flex-row">
          {/* Each pane scrolls on its own, so a long provider list never moves the editor. */}
          <Scroller
            className="max-h-[168px] shrink-0 border-b border-line @2xl:max-h-none @2xl:w-[268px] @2xl:border-r @2xl:border-b-0"
            contentClassName="p-2.5"
          >
            <div className="px-2 pt-1.5 pb-1 text-detail text-ink-faint">
              自定义供应商
            </div>
            {p.providers.map((provider) => (
              <button
                key={provider.id}
                type="button"
                onClick={() => p.select(provider.id)}
                className={`flex h-[38px] w-full items-center gap-2.5 rounded-lg px-2.5 text-left transition-colors ${
                  p.selected?.id === provider.id
                    ? "bg-card-hover"
                    : "hover:bg-card-hover/60"
                }`}
              >
                <Box
                  size={15}
                  strokeWidth={1.7}
                  className="shrink-0 text-ink-muted"
                />
                <ScrollText
                  text={provider.name}
                  className="min-w-0 flex-1 text-label text-ink"
                />
                <span
                  className={`h-[6px] w-[6px] shrink-0 rounded-full ${provider.enabled ? "bg-ok" : "bg-ink-faint/60"}`}
                />
              </button>
            ))}

            <button
              type="button"
              onClick={() => void p.add()}
              className="flex h-[38px] w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-label text-ink-muted transition-colors hover:bg-card-hover hover:text-ink"
            >
              <Plus size={15} strokeWidth={1.9} className="shrink-0" />
              添加供应商
            </button>
          </Scroller>

          <Scroller className="min-w-0 flex-1" contentClassName="p-4 @2xl:p-6">
            {!p.selected ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <p className="text-label text-ink-muted">
                  还没有配置任何供应商
                </p>
                <GhostButton onClick={() => void p.add()}>
                  添加第一个供应商
                </GhostButton>
              </div>
            ) : (
              /* Keyed, so switching provider resets the fields rather than carrying them over. */
              <ProviderEditor
                key={p.selected.id}
                provider={p.selected}
                defaultModelId={p.defaultModelId}
                testResult={p.testResult}
                testing={p.testing}
                testingModelId={p.testingModelId}
                modelTestResults={p.modelTestResults}
                fetchingModels={p.fetchingModels}
                fetchModelsError={p.fetchModelsError}
                onFetchModels={() => void p.fetchModelsFromEndpoint()}
                onTest={() => void p.test()}
                onTestModel={(modelId) => void p.test(modelId)}
                onChange={(patch) => void p.update(p.selected!.id, patch)}
                onRemove={() => void p.remove(p.selected!.id)}
                onEditModel={(model) =>
                  setEditingModel({ providerId: p.selected!.id, model })
                }
                onRemoveModel={(modelId) =>
                  void p.removeModel(p.selected!.id, modelId)
                }
                onSetDefault={(modelId) => void p.setDefaultModel(modelId)}
              />
            )}
          </Scroller>
        </div>
      </div>

      {/*
       * 角色排在供应商列表下面。
       *
       * 它问的是「已经配好的这些模型，分别派什么用场」——放在一个还空着的列表上面，
       * 就是在问一个还没有答案的问题。
       */}
      {p.providers.length > 0 && (
        <div className="shrink-0 pt-8 pb-2">
          <ModelRoles />
        </div>
      )}

      {editingModel && (
        <ModelEditor
          providerId={editingModel.providerId}
          model={editingModel.model}
          onCancel={() => setEditingModel(null)}
          onSave={(model) => {
            void p.saveModel(editingModel.providerId, model, editingModel.model);
            setEditingModel(null);
          }}
        />
      )}

      {p.discoveredModels && (
        <FetchModelsModal
          open={Boolean(p.discoveredModels)}
          models={p.discoveredModels}
          existingModelIds={new Set(p.selected?.models.map((m) => m.modelId) ?? [])}
          onClose={p.closeDiscoveredModal}
          onImport={(selectedIds) => void p.importDiscoveredModels(selectedIds)}
        />
      )}
    </div>
  );
}
