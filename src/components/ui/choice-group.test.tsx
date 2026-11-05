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
  Array.from(document.querySelectorAll('[aria-pressed="true"]'), element =>
    element.getAttribute('data-choice-value')
  );

describe('ChoiceGroup', () => {
  it.each(['segmented', 'cards'] as const)(
    'marks exactly the chosen option selected in the %s layout',
    layout => {
      render(<Harness layout={layout} />);
      expect(screen.getByRole('group', { name: 'Effort' })).toHaveAttribute(
        'data-choice-group',
        layout
      );
      expect(pressed()).toEqual(['low']);
      fireEvent.click(document.querySelector('[data-effort="high"]')!);
      expect(pressed()).toEqual(['high']);
      // The selected treatment is a state of the option, not of its label:
      // the marker and the pressed state move together.
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
});
