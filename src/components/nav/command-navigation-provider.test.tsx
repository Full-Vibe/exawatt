import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CommandNavigationProvider,
  useCommandNavigation,
} from './command-navigation-provider';
import {
  ALTITUDE_HANDOFF_FALLBACK_EVENT,
  claimAltitudeHandoff,
  resetAltitudeHandoffForTests,
} from './altitude-handoff';

const navigation = vi.hoisted(() => ({
  pathname: '/workspace',
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({
    push: navigation.push,
    replace: navigation.replace,
  }),
}));

function Trigger() {
  const { navigateCommandSurface } = useCommandNavigation();
  return (
    <button onClick={() => navigateCommandSurface('/fleet/spatial')}>
      Fleet
    </button>
  );
}

function TriggerBoth() {
  const { navigateCommandSurface } = useCommandNavigation();
  return (
    <>
      <button onClick={() => navigateCommandSurface('/fleet/spatial')}>
        Fleet
      </button>
      <button onClick={() => navigateCommandSurface('/workspace')}>
        Workspace
      </button>
    </>
  );
}

describe('CommandNavigationProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    navigation.pathname = '/workspace';
    window.history.replaceState({}, '', '/workspace');
    navigation.push.mockReset();
    navigation.replace.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('clears a transition when navigation never reaches its target', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      callback(0);
      return 1;
    });
    render(
      <CommandNavigationProvider>
        <Trigger />
      </CommandNavigationProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Fleet' }));
    expect(navigation.push).toHaveBeenCalledWith('/fleet/spatial');
    expect(document.querySelector('[data-command-transition]')).not.toBeNull();

    act(() => vi.advanceTimersByTime(1_200));
    expect(document.querySelector('[data-command-transition]')).toBeNull();
  });
});

describe('Team → Fleet altitude handoff (ENG-004 V3.0)', () => {
  function mountHandoffCard(label: string) {
    const element = document.createElement('section');
    element.setAttribute('data-handoff-card', '');
    element.setAttribute('data-handoff-label', label);
    element.setAttribute('data-handoff-color', '#50E6FF');
    element.getBoundingClientRect = () =>
      ({
        left: 24,
        top: 80,
        right: 624,
        bottom: 280,
        width: 600,
        height: 200,
      }) as DOMRect;
    document.body.appendChild(element);
    return element;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    resetAltitudeHandoffForTests();
    vi.spyOn(navigator, 'hardwareConcurrency', 'get').mockReturnValue(8);
    navigation.pathname = '/workspace';
    window.history.replaceState({}, '', '/workspace?view=sessions');
    navigation.push.mockReset();
    navigation.replace.mockReset();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      callback(performance.now());
      return 1;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    delete (window as { matchMedia?: unknown }).matchMedia;
  });

  it('captures visible cards, publishes the snapshot, and shows ghosts', () => {
    mountHandoffCard('dispatch-engine');
    mountHandoffCard('grid-api');
    render(
      <CommandNavigationProvider>
        <Trigger />
      </CommandNavigationProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Fleet' }));
    expect(navigation.push).toHaveBeenCalledWith('/fleet/spatial');
    expect(
      document
        .querySelector('[data-command-transition]')
        ?.getAttribute('data-command-transition')
    ).toBe('handoff');
    expect(
      document.querySelectorAll('[data-altitude-handoff-ghost]')
    ).toHaveLength(2);
    // The board rig can claim exactly what was captured.
    const snapshot = claimAltitudeHandoff();
    expect(snapshot?.cards.map(card => card.key)).toEqual([
      'dispatch-engine',
      'grid-api',
    ]);
  });

  it('ends the handoff when the board declines (fallback is normal)', () => {
    mountHandoffCard('dispatch-engine');
    render(
      <CommandNavigationProvider>
        <Trigger />
      </CommandNavigationProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Fleet' }));
    expect(document.querySelector('[data-altitude-handoff]')).not.toBeNull();

    act(() => {
      window.dispatchEvent(new CustomEvent(ALTITUDE_HANDOFF_FALLBACK_EVENT));
    });
    expect(document.querySelector('[data-altitude-handoff]')).toBeNull();
    expect(document.querySelector('[data-command-transition]')).toBeNull();
  });

  it('skips the handoff under reduced motion', () => {
    (window as { matchMedia?: unknown }).matchMedia = () => ({
      matches: true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    mountHandoffCard('dispatch-engine');
    render(
      <CommandNavigationProvider>
        <Trigger />
      </CommandNavigationProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Fleet' }));
    expect(navigation.push).toHaveBeenCalledWith('/fleet/spatial');
    expect(
      document
        .querySelector('[data-command-transition]')
        ?.getAttribute('data-command-transition')
    ).not.toBe('handoff');
    expect(claimAltitudeHandoff()).toBeNull();
  });

  it('takes the directional transition when nothing can be captured', () => {
    render(
      <CommandNavigationProvider>
        <Trigger />
      </CommandNavigationProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Fleet' }));
    expect(
      document
        .querySelector('[data-command-transition]')
        ?.getAttribute('data-command-transition')
    ).not.toBe('handoff');
    expect(claimAltitudeHandoff()).toBeNull();
  });

  it('a new navigation mid-handoff tears the ghosts down immediately', () => {
    mountHandoffCard('dispatch-engine');
    render(
      <CommandNavigationProvider>
        <TriggerBoth />
      </CommandNavigationProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Fleet' }));
    expect(document.querySelector('[data-altitude-handoff]')).not.toBeNull();

    // Mid-handoff the operator changes their mind: obeyed immediately.
    window.history.replaceState({}, '', '/fleet/spatial');
    fireEvent.click(screen.getByRole('button', { name: 'Workspace' }));
    expect(navigation.push).toHaveBeenLastCalledWith('/workspace');
    expect(document.querySelector('[data-altitude-handoff]')).toBeNull();
  });
});
