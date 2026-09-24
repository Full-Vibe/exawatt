import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import ConnectFlowBenchPage from './page';

afterEach(cleanup);

/**
 * The study exists for review, so its tests pin only what the review depends
 * on: every specimen renders, both send-access options are on screen side by
 * side, and choosing a remote coworker in ⌘T changes what Start does. Copy is
 * deliberately not asserted; the operator judges it by eye.
 */
describe('Connect in one step study', () => {
  it('renders every specimen the review walks through', () => {
    const { container } = render(<ConnectFlowBenchPage />);
    const ids = [...container.querySelectorAll('[data-connect-specimen]')].map(
      node => node.getAttribute('data-connect-specimen')
    );
    expect(ids).toEqual(
      expect.arrayContaining([
        'entry-n',
        'entry-t',
        'choose',
        'fail',
        'confirm',
        'confirm-copy',
        'landing',
      ])
    );
  });

  it('offers send access as one click or as commands to run, per server', () => {
    const { container } = render(<ConnectFlowBenchPage />);
    const blocks = [...container.querySelectorAll('[data-send-access]')];
    expect(blocks.map(node => node.getAttribute('data-send-access'))).toEqual([
      'offer',
      'copy',
    ]);
    for (const block of blocks) {
      expect(
        block.querySelector('[data-send-access-action="approve"]')
      ).not.toBeNull();
      expect(
        block.querySelector('[data-send-access-action="copy"]')
      ).not.toBeNull();
    }
    fireEvent.click(
      blocks[0].querySelector('[data-send-access-action="approve"]') as Element
    );
    expect(
      container.querySelector('[data-send-access="approved"]')
    ).not.toBeNull();
  });

  it('lets a remote coworker be chosen in ⌘T like any setup', () => {
    const { container } = render(<ConnectFlowBenchPage />);
    const launcher = container.querySelector('[data-launcher-specimen]');
    expect(launcher).not.toBeNull();
    const local = container.querySelector('[data-setup-chip="claude"]');
    const remote = container.querySelector('[data-setup-chip="scout"]');
    expect(remote).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(local as Element);
    expect(local).toHaveAttribute('aria-pressed', 'true');
    expect(remote).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getAllByText('Start').length).toBeGreaterThan(0);
  });
});
