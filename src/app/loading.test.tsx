import { render } from '@testing-library/react';
import { expect, it } from 'vitest';
import RootLoading from './loading';

it('marks the route transition state for anything waiting it out', () => {
  const { container } = render(<RootLoading />);
  expect(container.querySelectorAll('[data-route-loading]')).toHaveLength(1);
});
