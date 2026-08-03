import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { Command } from '@/components/ui/command';
import { ThemePickerCommand } from './theme-picker-command';

afterEach(cleanup);

const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
  if (originalScrollIntoView) {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: originalScrollIntoView,
    });
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  }
});

describe('ThemePickerCommand', () => {
  it('renders the built-ins with appearance and current-state labels', () => {
    render(
      <Command value="exawatt-classic-dark">
        <ThemePickerCommand
          search=""
          currentThemeId="exawatt-classic-dark"
          busy={false}
          error={null}
          onSearchChange={() => undefined}
          onSelect={() => undefined}
        />
      </Command>
    );

    expect(screen.getByText('Air')).toBeInTheDocument();
    expect(screen.getByText('Classic Dark')).toBeInTheDocument();
    expect(screen.getByText('Night')).toBeInTheDocument();
    expect(screen.getByText('Current')).toBeInTheDocument();
    expect(screen.getAllByText('Dark')).toHaveLength(2);
    expect(screen.getByText('Light')).toBeInTheDocument();
  });

  it('previews on keyboard highlight and applies only on selection', async () => {
    const onPreview = vi.fn();
    const onSelect = vi.fn();
    render(
      <Command value="exawatt-classic-dark" onValueChange={onPreview}>
        <ThemePickerCommand
          search=""
          currentThemeId="exawatt-classic-dark"
          busy={false}
          error={null}
          onSearchChange={() => undefined}
          onSelect={onSelect}
        />
      </Command>
    );

    fireEvent.keyDown(screen.getByPlaceholderText('Search themes…'), {
      key: 'ArrowDown',
    });
    await waitFor(() => expect(onPreview).toHaveBeenCalled());
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Night'));
    expect(onSelect).toHaveBeenCalledWith('exawatt-night-dark');
  });

  it('keeps a failed commit actionable', () => {
    render(
      <Command>
        <ThemePickerCommand
          search=""
          currentThemeId="exawatt-air-light"
          busy={false}
          error="Theme could not be saved. Try again."
          onSearchChange={() => undefined}
          onSelect={() => undefined}
        />
      </Command>
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Theme could not be saved. Try again.'
    );
  });
});
