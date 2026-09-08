/**
 * The model settings page: a list of providers on one side, the selected one on the other.
 *
 * Only the layout lives here. What editing a provider actually does — and the consequences that
 * are easy to miss, like a removed provider orphaning the default model — is in `useProviders`,
 * and what a provider looks like is in `ProviderEditor`. Three files, three questions.
 */

import { useI18n } from "../../i18n/index.ts";
import type { ModelConfig } from "@lyra/core";
import { Box, Plus, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { ScrollText } from "../../ui/scroll/ScrollText.tsx";
import { GhostButton } from "./controls.tsx";
import { FetchModelsModal } from "./FetchModelsModal.tsx";
import { ModelEditor } from "./ModelEditor.tsx";
import { ProviderEditor } from "./ProviderEditor.tsx";
import { useProviders } from "./useProviders.ts";

export function ModelSettings() {
	const { t } = useI18n();
  const p = useProviders();
  const [editingModel, setEditingModel] = useState<{
    providerId: string;
    model: ModelConfig | null;
  } | null>(null);

  return (
		// Keep the provider editor usable when a short window cannot fit its minimum height.
    <Scroller className="flex-1" contentClassName="flex flex-col">
      <header className="flex shrink-0 items-start justify-between pt-8 pb-6">
        <div>
          <h1 className="text-display leading-tight font-semibold tracking-tight text-ink">
            {t("modelSettings.title")}
          </h1>
          <p className="mt-2 text-label text-ink-muted">
            {t("modelSettings.intro")}
          </p>
        </div>
        <button
          type="button"
          data-ly-tip={t("modelSettings.testConnection")}
          aria-label={t("modelSettings.testConnection")}
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
              {t("modelSettings.customProviders")}
            </div>
            {p.providers.map((provider) => (
              <button
                key={provider.id}
                type="button"
                onClick={() => p.select(provider.id)}
                className={`ly-scroll flex h-[38px] w-full items-center gap-2.5 rounded-lg px-2.5 text-left transition-colors ${
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
              {t("modelSettings.addProvider")}
            </button>
          </Scroller>

          <Scroller className="min-w-0 flex-1" contentClassName="p-4 @2xl:p-6">
            {!p.selected ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <p className="text-label text-ink-muted">
                  {t("modelSettings.noProviders")}
                </p>
                <GhostButton onClick={() => void p.add()}>
                  {t("modelSettings.addFirst")}
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

      {editingModel && (
        <ModelEditor
          provider={
            p.providers.find((provider) => provider.id === editingModel.providerId) ?? {
              id: editingModel.providerId,
              baseUrl: "",
            }
          }
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
    </Scroller>
  );
}
