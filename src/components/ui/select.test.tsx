import { cleanup, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './select';

afterEach(cleanup);

// jsdom has no layout, so it has no scrollIntoView; Radix scrolls the
// selected option into view when the list opens.
const scrollIntoView = Element.prototype.scrollIntoView;
beforeAll(() => {
  Element.prototype.scrollIntoView = () => undefined;
});
afterAll(() => {
  Element.prototype.scrollIntoView = scrollIntoView;
});

describe('select items', () => {
  it('name each option by the value it selects', async () => {
    const values = ['first', 'second'];
    render(
      <Select defaultOpen defaultValue="first">
        <SelectTrigger aria-label="Fixture choice">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {values.map(value => (
            <SelectItem key={value} value={value}>
              {`Fixture ${value}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
    const options = await screen.findAllByRole('option');
    expect(
      options.map(option => option.getAttribute('data-select-value'))
    ).toEqual(values);
  });
});
