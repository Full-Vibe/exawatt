import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { SessionModelControl } from './session-model-control';
import { demoModelCatalog } from '@/lib/demo-workspace/model-choice-source';

it('stages an exact model/effort choice in one menu and applies only on explicit action', async () => {
  const apply = vi.fn(async () => {});
  const catalog = await demoModelCatalog();
  const model = catalog.models[0];
  const effort = model.efforts[0];
  render(<SessionModelControl loadCatalog={demoModelCatalog} apply={apply} />);
  fireEvent.click(screen.getByRole('button', { name: 'Session model: Model' }));
  const option = await screen.findByRole('option', {
    name: `${model.label} · ${effort.label}`,
  });
  fireEvent.click(option);
  expect(screen.getAllByRole('listbox')).toHaveLength(1);
  expect(apply).not.toHaveBeenCalled();
  // The trigger must not claim that an uncommitted selection is in effect.
  expect(
    screen.getByRole('button', { name: 'Session model: Model' })
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Apply and resume' }));
  await waitFor(() =>
    expect(apply).toHaveBeenCalledWith({ model: model.id, effort: effort.id })
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
