// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { ChoiceGroup } from './choice-group';

afterEach(cleanup);

const OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'high', label: 'High' },
  {
    value: 'max',
    label: 'Max',
    disabled: true,
    disabledReason: 'Not offered by this model.',
  },
] as const;

function Harness({ layout }: { layout?: 'segmented' | 'cards' }) {
  const [value, setValue] = useState<'low' | 'high' | 'max'>('low');
  return (
    <ChoiceGroup
      label="Effort"
      value={value}
      options={OPTIONS}
      onChange={setValue}
      layout={layout}
      optionAttribute="data-effort"
    />
  );
}

const pressed = () =>
  Array.from(document.querySelectorAll('[aria-checked="true"]'), element =>
    element.getAttribute('data-choice-value')
  );

describe('ChoiceGroup', () => {
  it.each(['segmented', 'cards'] as const)(
    'marks exactly the chosen option selected in the %s layout',
    layout => {
      render(<Harness layout={layout} />);
      expect(
        screen.getByRole('radiogroup', { name: 'Effort' })
      ).toHaveAttribute('data-choice-group', layout);
      expect(pressed()).toEqual(['low']);
      fireEvent.click(document.querySelector('[data-effort="high"]')!);
      expect(pressed()).toEqual(['high']);
      // The selected treatment is a state of the option, not of its label:
      // the marker and the checked state move together.
      expect(
        Array.from(document.querySelectorAll('[data-selected]'), element =>
          element.getAttribute('data-choice-value')
        )
      ).toEqual(['high']);
    }
  );

  it('refuses an option the source does not offer and says why', () => {
    const onChange = vi.fn();
    render(
      <ChoiceGroup
        label="Effort"
        value="low"
        options={OPTIONS}
        onChange={onChange}
      />
    );
    const max = document.querySelector('[data-choice-value="max"]')!;
    expect(max).toBeDisabled();
    expect(max).toHaveAttribute('title', 'Not offered by this model.');
    fireEvent.click(max);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('is one Tab stop, on the checked option, with arrow keys that skip what is not offered', () => {
    render(<Harness />);
    const radios = screen.getAllByRole('radio');
    expect(radios.map(radio => radio.tabIndex)).toEqual([0, -1, -1]);
    radios[0].focus();
    fireEvent.keyDown(radios[0], { key: 'ArrowRight' });
    expect(pressed()).toEqual(['high']);
    expect(document.activeElement).toBe(radios[1]);
    expect(radios.map(radio => radio.tabIndex)).toEqual([-1, 0, -1]);
    // Max is disabled, so the next stop wraps to Low.
    fireEvent.keyDown(radios[1], { key: 'ArrowDown' });
    expect(pressed()).toEqual(['low']);
    fireEvent.keyDown(radios[0], { key: 'ArrowLeft' });
    expect(pressed()).toEqual(['high']);
    fireEvent.keyDown(radios[1], { key: 'Home' });
    expect(pressed()).toEqual(['low']);
    fireEvent.keyDown(radios[0], { key: 'End' });
    expect(pressed()).toEqual(['high']);
  });

  it('puts the Tab stop on the first offered option when nothing is checked', () => {
    render(
      <ChoiceGroup
        label="Effort"
        value={null}
        options={OPTIONS}
        onChange={vi.fn()}
      />
    );
    expect(screen.getAllByRole('radio').map(radio => radio.tabIndex)).toEqual([
      0, -1, -1,
    ]);
    expect(pressed()).toEqual([]);
  });
});
