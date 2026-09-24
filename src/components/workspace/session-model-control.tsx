'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { OptionMenu } from '@/components/ui/option-menu';
import type {
  AgentModelCatalog,
  SessionModelChange,
} from '@exawatt/core/desktop-bridge';

/** One list of exact model/effort choices over live and Demo source ports. */
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
  const [value, setValue] = useState<string | null>(null);
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
        setValue(
          initialModel
            ? JSON.stringify([initialModel, initialEffort ?? ''])
            : null
        );
      })
      .catch(() => {
        if (current) setError('Could not load models. Close and try again.');
      });
    return () => {
      current = false;
    };
  }, [open, loadCatalog, initialModel, initialEffort]);
  const choices = useMemo(
    () =>
      (catalog?.models ?? []).flatMap(model => {
        const efforts =
          catalog?.effortLocked || !model.efforts.length
            ? [null]
            : model.efforts;
        return efforts.map(effort => ({
          id: JSON.stringify([model.id, effort?.id ?? '']),
          label: effort ? `${model.label} · ${effort.label}` : model.label,
          group: model.label,
          keywords: model.id,
          choice: { model: model.id, ...(effort ? { effort: effort.id } : {}) },
        }));
      }),
    [catalog]
  );
  const selected = choices.find(choice => choice.id === value);
  const reason =
    unavailableReason ??
    (catalog?.selectionAction === 'choose-in-source'
      ? 'Choose a model inside this Agent Source.'
      : undefined);
  return (
    <OptionMenu
      label="Session model"
      triggerLabel={
        choices.find(
          choice =>
            choice.choice.model === initialModel &&
            choice.choice.effort === initialEffort
        )?.label ??
        initialModel ??
        'Model'
      }
      placeholder={initialModel ?? 'Model'}
      value={value}
      options={choices.map(choice => ({
        ...choice,
        disabled: pending || !!reason,
        disabledReason: reason ?? (pending ? 'Resuming…' : undefined),
      }))}
      onValueChange={setValue}
      closeOnSelect={false}
      open={open}
      onOpenChange={next => {
        if (!pending) setOpen(next);
      }}
      className="h-7 max-w-64 shrink-0 px-2"
      contentClassName="max-h-[min(32rem,var(--radix-popover-content-available-height,32rem))]"
      footer={
        <div className="space-y-2 p-2">
          {!catalog && !error && (
            <p role="status" className="text-chrome-meta text-muted-foreground">
              Loading models…
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
              disabled={!selected || pending || !!reason}
              onClick={async () => {
                if (!selected || pending) return;
                setPending(true);
                setError(null);
                setApplied(null);
                try {
                  await apply(selected.choice);
                  setApplied(selected.label);
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
