import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CommandNavigationProvider,
  useCommandNavigation,
} from './command-navigation-provider';

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
      Spatial
    </button>
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

    fireEvent.click(screen.getByRole('button', { name: 'Spatial' }));
    expect(navigation.push).toHaveBeenCalledWith('/fleet/spatial');
    expect(document.querySelector('[data-command-transition]')).not.toBeNull();

    act(() => vi.advanceTimersByTime(1_200));
    expect(document.querySelector('[data-command-transition]')).toBeNull();
  });
});
