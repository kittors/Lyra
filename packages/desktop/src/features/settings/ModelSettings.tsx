/**
 * The model settings page: a list of providers on one side, the selected one on the other.
 *
 * Only the layout lives here. What editing a provider actually does — and the consequences that
 * are easy to miss, like a removed provider orphaning the default model — is in `useProviders`,
 * and what a provider looks like is in `ProviderEditor`. Three files, three questions.
 */

import { useI18n } from "../../i18n/index.ts";
import type { ModelConfig } from "@lyra/core";
import { Box, FileDown, FileUp, Plus, RefreshCw } from "lucide-react";
import { useRef, useState } from "react";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { ScrollText } from "../../ui/scroll/ScrollText.tsx";
import { useConfirmer } from "../../ui/overlay/Confirm.tsx";
import { GhostButton } from "./controls.tsx";
import { FetchModelsModal } from "./FetchModelsModal.tsx";
import { ModelEditor } from "./ModelEditor.tsx";
import { ProviderEditor } from "./ProviderEditor.tsx";
import { ProviderImportModal } from "./ProviderImportModal.tsx";
import { useProviders } from "./useProviders.ts";
import { useProviderTransfer } from "./useProviderTransfer.ts";

export function ModelSettings() {
	const { t } = useI18n();
  const p = useProviders();
  const transfer = useProviderTransfer();
  const confirm = useConfirmer();
  const fileRef = useRef<HTMLInputElement>(null);
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
        {/*
          * Carrying the list to another machine, and testing the one in front of you: two
          * different jobs, so the rule between them rather than four identical icons in a row.
          */}
        <div className="mt-1 flex items-center gap-0.5">
          <button
            type="button"
            data-ly-tip={t("providerTransfer.importTip")}
            aria-label={t("providerTransfer.importTip")}
            onClick={() => fileRef.current?.click()}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-card-hover hover:text-ink"
          >
            <FileUp size={16} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            data-ly-tip={t("providerTransfer.exportTip")}
            aria-label={t("providerTransfer.exportTip")}
            disabled={!transfer.canExport}
            onClick={() =>
              confirm.ask({
                title: t("providerTransfer.exportConfirm"),
                detail: t("providerTransfer.exportConfirmDetail"),
                confirmLabel: t("providerTransfer.exportAction"),
                onConfirm: transfer.exportAll,
              })
            }
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-card-hover hover:text-ink disabled:pointer-events-none disabled:opacity-40"
          >
            <FileDown size={16} strokeWidth={1.8} />
          </button>

          <span aria-hidden className="mx-1 h-4 w-px bg-line" />

          <button
            type="button"
            data-ly-tip={t("modelSettings.testConnection")}
            aria-label={t("modelSettings.testConnection")}
            onClick={() => void p.test()}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-card-hover hover:text-ink"
          >
            <RefreshCw
              size={16}
              strokeWidth={1.8}
              className={p.testing ? "ly-pulse" : undefined}
            />
          </button>
        </div>

        {/* Reset after every pick, or choosing the same file twice fires no change event. */}
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void transfer.offer(file);
          }}
        />
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
              /*
               * Keyed, so switching provider resets the fields rather than carrying them over.
               *
               * The import counter is in the key for the same reason, and it is not decoration:
               * an import replaces the provider under the same id, so nothing about the key
               * changes and the URL and API Key boxes — which read their initial value once, on
               * mount — go on showing what was there before. The file said one thing, the form
               * says another, and the form is the one being read.
               */
              <ProviderEditor
                key={`${p.selected.id}:${transfer.imports}`}
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

      {transfer.pending && (
        <ProviderImportModal
          entries={transfer.pending.entries}
          dropped={transfer.pending.dropped}
          onCancel={transfer.cancelImport}
          onImport={(chosen) => void transfer.confirmImport(chosen)}
        />
      )}

      {confirm.element}
    </Scroller>
  );
}
