// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { publishActiveTenantKind } from '@/lib/tenancy/active-tenant';
import {
  consumePendingAgentComposerRequest,
  requestAgentComposer,
} from './session-jump';
import { useAgentComposerRequests } from './use-agent-composer-requests';
import type { Project } from './workspace-state/workspace-model';

const project = (dir: string) =>
  ({
    dir,
    name: dir,
    color: 'blue',
    tabs: [],
    activeTabId: null,
  }) as unknown as Project;

type Props = Parameters<typeof useAgentComposerRequests>[0];

function mount(initial: Omit<Props, 'createDraftTab' | 'summonProjectOpener'>) {
  const summonProjectOpener = vi.fn();
  const createDraftTab = vi.fn<Props['createDraftTab']>(() => 'draft');
  // Each render hands the hook fresh callbacks and arrays, the way the
  // workspace does whenever its state changes.
  const props = (next: Partial<Props> = {}): Props => ({
    ...initial,
    projects: [...initial.projects],
    createDraftTab: (...args) => createDraftTab(...args),
    summonProjectOpener: () => summonProjectOpener(),
    ...next,
  });
  const view = renderHook(
    (current: Props) => useAgentComposerRequests(current),
    {
      initialProps: props(),
    }
  );
  return { view, props, summonProjectOpener, createDraftTab };
}

beforeEach(() => {
  publishActiveTenantKind('personal');
  consumePendingAgentComposerRequest();
});
afterEach(() => {
  cleanup();
  consumePendingAgentComposerRequest();
});

describe('useAgentComposerRequests', () => {
  it('opens the chooser once for a request that waited for the workspace', () => {
    // New Agent asked for on another route, with no Project to put it in.
    requestAgentComposer();
    const { view, props, summonProjectOpener } = mount({
      enabled: true,
      ready: false,
      projects: [],
      activeProject: null,
    });
    // Before the layout loads, "no active Project" is not yet known.
    expect(summonProjectOpener).not.toHaveBeenCalled();

    view.rerender(props({ ready: true }));
    expect(summonProjectOpener).toHaveBeenCalledTimes(1);

    // The request stays pending until a composer consumes it; the workspace
    // re-rendering in the meantime must not reopen the chooser.
    view.rerender(props({ ready: true }));
    view.rerender(props({ ready: true, projects: [project('/p')] }));
    view.rerender(props({ ready: true }));
    expect(summonProjectOpener).toHaveBeenCalledTimes(1);
  });

  // BUG-327: the operator cancels the chooser, goes to Fleet and comes back
  // while the request is still pending. The workspace mounts again; the
  // request was already answered, so the chooser stays shut.
  it('does not answer a request again when the workspace remounts', () => {
    requestAgentComposer();
    const first = mount({
      enabled: true,
      ready: true,
      projects: [],
      activeProject: null,
    });
    expect(first.summonProjectOpener).toHaveBeenCalledTimes(1);
    first.view.unmount();

    const second = mount({
      enabled: true,
      ready: true,
      projects: [],
      activeProject: null,
    });
    expect(second.summonProjectOpener).not.toHaveBeenCalled();

    // A live request answered while mounted is not answered by a remount
    // either; a new request is.
    act(() => requestAgentComposer());
    expect(second.summonProjectOpener).toHaveBeenCalledTimes(1);
    second.view.unmount();
    const third = mount({
      enabled: true,
      ready: true,
      projects: [],
      activeProject: null,
    });
    expect(third.summonProjectOpener).not.toHaveBeenCalled();
    act(() => requestAgentComposer());
    expect(third.summonProjectOpener).toHaveBeenCalledTimes(1);
  });

  it('answers each live request once, from the state it arrives in', () => {
    const { view, props, summonProjectOpener, createDraftTab } = mount({
      enabled: true,
      ready: true,
      projects: [],
      activeProject: null,
    });
    act(() => requestAgentComposer());
    expect(summonProjectOpener).toHaveBeenCalledTimes(1);
    view.rerender(props());
    view.rerender(props());
    expect(summonProjectOpener).toHaveBeenCalledTimes(1);

    const open = project('/p');
    view.rerender(props({ projects: [open], activeProject: open }));
    act(() => requestAgentComposer('codex'));
    expect(createDraftTab).toHaveBeenLastCalledWith(undefined, {
      draftSource: 'codex',
      draftTouched: true,
    });
    act(() => requestAgentComposer({ projectDir: '/p' }));
    expect(createDraftTab).toHaveBeenLastCalledWith('/p');
    expect(summonProjectOpener).toHaveBeenCalledTimes(1);
  });
});
