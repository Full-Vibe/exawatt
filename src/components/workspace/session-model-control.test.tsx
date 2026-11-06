import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { SessionModelControl } from './session-model-control';
import { demoModelCatalog } from '@/lib/demo-workspace/model-choice-source';

it('stages a model and its effort as two axes and applies only on explicit action', async () => {
  const apply = vi.fn(async () => {});
  const catalog = await demoModelCatalog();
  const model = catalog.models[0];
  const effort = model.efforts[2];
  render(<SessionModelControl loadCatalog={demoModelCatalog} apply={apply} />);
  fireEvent.click(screen.getByRole('button', { name: 'Session model: Model' }));
  // BUG-334: one row per model, never one per model and effort.
  expect(
    (await screen.findAllByRole('option')).map(option =>
      option.getAttribute('data-option-id')
    )
  ).toEqual(catalog.models.map(candidate => candidate.id));
  expect(document.querySelector('[data-session-effort]')).toBeNull();
  fireEvent.click(screen.getByRole('option', { name: model.label }));
  // The effort axis offers exactly what the staged model declares and starts
  // on its default.
  const efforts = () =>
    Array.from(document.querySelectorAll('[data-session-effort]'), element =>
      element.getAttribute('data-session-effort')
    );
  expect(efforts()).toEqual(model.efforts.map(option => option.id));
  expect(
    document.querySelector('[data-session-effort][aria-checked="true"]')
  ).toHaveAttribute('data-session-effort', model.defaultEffort);
  fireEvent.click(
    document.querySelector(`[data-session-effort="${effort.id}"]`)!
  );
  // A second model keeps the chosen effort: the axes are independent.
  fireEvent.click(
    screen.getByRole('option', { name: catalog.models[1].label })
  );
  expect(
    document.querySelector('[data-session-effort][aria-checked="true"]')
  ).toHaveAttribute('data-session-effort', effort.id);
  expect(screen.getAllByRole('listbox')).toHaveLength(1);
  expect(apply).not.toHaveBeenCalled();
  // The trigger must not claim that an uncommitted selection is in effect.
  expect(
    screen.getByRole('button', { name: 'Session model: Model' })
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Apply and resume' }));
  await waitFor(() =>
    expect(apply).toHaveBeenCalledWith({
      model: catalog.models[1].id,
      effort: effort.id,
    })
  );
});

it('keeps a failed change visible and never invokes a busy Session', async () => {
  const apply = vi.fn(async () => {
    throw new Error('Process could not resume');
  });
  const { rerender } = render(
    <SessionModelControl loadCatalog={demoModelCatalog} apply={apply} />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Session model: Model' }));
  fireEvent.click((await screen.findAllByRole('option'))[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Apply and resume' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Process could not resume'
  );
  rerender(
    <SessionModelControl
      loadCatalog={demoModelCatalog}
      apply={apply}
      unavailableReason="Agent is working"
    />
  );
  expect(
    screen.getByRole('button', { name: 'Apply and resume' })
  ).toBeDisabled();
  expect(apply).toHaveBeenCalledTimes(1);
});

it('marks its trigger and its apply action for anything driving the control', async () => {
  render(
    <SessionModelControl loadCatalog={demoModelCatalog} apply={vi.fn()} />
  );
  const trigger = document.querySelector('[data-session-model]')!;
  expect(trigger).toHaveAttribute('data-option-menu-trigger');
  fireEvent.click(trigger);
  await screen.findAllByRole('option');
  expect(document.querySelectorAll('[data-session-model-apply]')).toHaveLength(
    1
  );
});

it('keeps Apply disabled until the running effort is one the catalog declares, never dropping it silently', async () => {
  const apply = vi.fn(async () => {});
  const catalog = await demoModelCatalog();
  const model = catalog.models.find(candidate => candidate.efforts.length > 1)!;
  render(
    <SessionModelControl
      loadCatalog={demoModelCatalog}
      apply={apply}
      initialModel={model.id}
      initialEffort="not-declared"
    />
  );
  fireEvent.click(document.querySelector('[data-session-model]')!);
  await screen.findAllByRole('option');
  const applyButton = screen.getByRole('button', { name: 'Apply and resume' });
  // Nothing on the effort axis is checked, and Apply says why it waits.
  expect(
    document.querySelector('[data-session-effort][aria-checked="true"]')
  ).toBeNull();
  expect(applyButton).toBeDisabled();
  expect(
    document.querySelector('[data-session-effort-required]')
  ).toHaveTextContent(model.label);
  fireEvent.click(applyButton);
  expect(apply).not.toHaveBeenCalled();
  const chosen = model.efforts[0];
  fireEvent.click(
    document.querySelector(`[data-session-effort="${chosen.id}"]`)!
  );
  expect(applyButton).toBeEnabled();
  fireEvent.click(applyButton);
  await waitFor(() =>
    expect(apply).toHaveBeenCalledWith({ model: model.id, effort: chosen.id })
  );
});
