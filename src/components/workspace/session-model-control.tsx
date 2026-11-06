'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ChoiceGroup } from '@/components/ui/choice-group';
import { OptionMenu } from '@/components/ui/option-menu';
import {
  chosenEffort,
  derivedEffort,
  effortForModel,
  modelEfforts,
  type EffortSelection,
} from './launch-axes';
import type {
  AgentModelCatalog,
  SessionModelChange,
} from '@exawatt/core/desktop-bridge';

/**
 * A running Agent's model and effort, over live and Demo source ports.
 *
 * Two axes, staged together and applied once: the model list, and under it
 * the efforts that model declares (BUG-334). The operator asked for effort
 * as "an orthogonal selector, not just a flattened list"; the list used to
 * hold one row per model and effort ("GPT-6 · Low" … "GPT-6 · Ultra"), so a
 * catalog of five models read as thirty rows.
 *
 * Apply resumes the Agent with exactly what is staged, so it stays disabled
 * until the staging is a choice the catalog declares: a model it lists and,
 * when that model declares efforts, one of them. A running effort the
 * catalog does not declare is never dropped silently in favour of the
 * harness default; the operator picks one first.
 */
export function SessionModelControl({
  loadCatalog,
  apply,
  unavailableReason,
  initialModel,
  initialEffort,
}: {
  loadCatalog: () => Promise<AgentModelCatalog>;
  apply: (choice: SessionModelChange) => Promise<void>;
  unavailableReason?: string;
  initialModel?: string;
  initialEffort?: string;
}) {
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<AgentModelCatalog | null>(null);
  const [model, setModel] = useState<string | null>(null);
  // The running effort is what the operator launched with, so it counts as
  // chosen and carries across a model change wherever the new model offers it.
  const [effortSelection, setEffortSelection] = useState<EffortSelection>(
    derivedEffort(null)
  );
  const effort = effortSelection.value;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let current = true;
    loadCatalog()
      .then(next => {
        if (!current) return;
        setCatalog(next);
        setError(null);
        setModel(initialModel ?? null);
        setEffortSelection(
          initialEffort ? chosenEffort(initialEffort) : derivedEffort(null)
        );
      })
      .catch(() => {
        if (current) setError('Could not load models. Close and try again.');
      });
    return () => {
      current = false;
    };
  }, [open, loadCatalog, initialModel, initialEffort]);

  const models = catalog?.models ?? [];
  const efforts = modelEfforts(catalog, model);
  const labelOf = (modelId: string | undefined, effortId?: string | null) => {
    const option = models.find(candidate => candidate.id === modelId);
    const effortLabel = option?.efforts.find(
      candidate => candidate.id === effortId
    )?.label;
    const name = option?.label ?? modelId;
    return name && effortLabel ? `${name} · ${effortLabel}` : name;
  };
  const reason =
    unavailableReason ??
    (catalog?.selectionAction === 'choose-in-source'
      ? 'Choose a model inside this Agent Source.'
      : undefined);
  const locked = pending || !!reason;
  const stagedModel = models.find(option => option.id === model) ?? null;
  const effortDeclared =
    efforts.length === 0 || efforts.some(option => option.id === effort);
  const staged: SessionModelChange | null =
    stagedModel && effortDeclared
      ? {
          model: stagedModel.id,
          ...(efforts.length > 0 && effort ? { effort } : {}),
        }
      : null;
  const effortMissing = stagedModel !== null && !effortDeclared;

  return (
    <OptionMenu
      label="Session model"
      attributes={{ 'data-session-model': '' }}
      triggerLabel={labelOf(initialModel, initialEffort) ?? 'Model'}
      placeholder={initialModel ?? 'Model'}
      value={model}
      options={models.map(option => ({
        id: option.id,
        label: option.label,
        keywords: option.id,
        disabled: locked,
        disabledReason: reason ?? (pending ? 'Resuming…' : undefined),
      }))}
      onValueChange={next => {
        setModel(next);
        // The effort axis carries across the model change whenever the new
        // model offers it, the same rule the New Agent window applies.
        setEffortSelection(
          effortForModel({ catalog, modelId: next, current: effortSelection })
        );
      }}
      closeOnSelect={false}
      open={open}
      onOpenChange={next => {
        if (!pending) setOpen(next);
      }}
      className="h-7 max-w-64 shrink-0 px-2"
      contentClassName="max-h-[min(32rem,var(--radix-popover-content-available-height,32rem))]"
      footer={
        <div className="space-y-2 p-2">
          {efforts.length > 0 ? (
            <div className="space-y-1">
              <p className="font-mono text-chrome-micro text-hud-text-dim">
                Effort
              </p>
              <ChoiceGroup
                label="Effort"
                value={effort}
                options={efforts.map(option => ({
                  value: option.id,
                  label: option.label,
                }))}
                optionAttribute="data-session-effort"
                disabled={locked}
                onChange={value => setEffortSelection(chosenEffort(value))}
                className="flex-wrap self-stretch font-mono text-chrome-micro"
                optionClassName="h-7 px-2"
              />
            </div>
          ) : null}
          {!catalog && !error && (
            <p role="status" className="text-chrome-meta text-muted-foreground">
              Loading models…
            </p>
          )}
          {effortMissing && !reason && (
            <p
              data-session-effort-required
              className="text-chrome-meta text-muted-foreground"
            >
              Choose an effort for {stagedModel.label}.
            </p>
          )}
          {reason && (
            <p className="text-chrome-meta text-muted-foreground">{reason}</p>
          )}
          {catalog?.effortLocked && (
            <p className="text-chrome-meta text-muted-foreground">
              Effort is controlled by your environment.
            </p>
          )}
          <p className="text-chrome-meta text-muted-foreground">
            Resumes the same conversation. Unsent terminal input is not
            preserved.
          </p>
          {initialModel && (
            <p className="text-chrome-meta text-muted-foreground">
              Launched with {initialModel}. Native changes may differ.
            </p>
          )}
          {error && (
            <p role="alert" className="text-chrome-meta text-destructive">
              {error}
            </p>
          )}
          {applied && (
            <p role="status" className="text-chrome-meta">
              Resumed with {applied} requested.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              data-session-model-apply
              disabled={!staged || locked}
              onClick={async () => {
                if (!staged || pending) return;
                setPending(true);
                setError(null);
                setApplied(null);
                try {
                  await apply(staged);
                  setApplied(labelOf(staged.model, staged.effort) ?? null);
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : 'Could not change model.'
                  );
                } finally {
                  setPending(false);
                }
              }}
            >
              {pending ? 'Resuming…' : 'Apply and resume'}
            </Button>
          </div>
        </div>
      }
    />
  );
}
