// @vitest-environment jsdom
import { act, render } from '@testing-library/react';
import { startTransition, useCallback, useEffect, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { useBoardRoute } from './use-board-route';

/**
 * A router double built from the boundary the board writes through: Next's
 * `replace` answers later, one navigation at a time, as a transition that
 * updates `useSearchParams` and the location together. The test decides when
 * each echo arrives, and can navigate from outside the board.
 */
function createRouter(initial = '') {
  const queued: string[] = [];
  let setParams: ((params: URLSearchParams) => void) | null = null;
  const land = (href: string) => {
    window.history.replaceState(null, '', href);
    const query = href.split('?')[1] ?? '';
    startTransition(() => setParams?.(new URLSearchParams(query)));
  };
  window.history.replaceState(null, '', `/fleet/spatial${initial}`);
  return {
    queued,
    useSearchParams() {
      const [params, set] = useState(
        () => new URLSearchParams(initial.replace(/^\?/, ''))
      );
      useEffect(() => {
        setParams = set;
      }, [set]);
      return params;
    },
    replace: (href: string) => void queued.push(href),
    /** The oldest pending `replace` lands. */
    echo: () => land(queued.shift()!),
    /** Someone else (a deep link, the palette) navigates. */
    outside: (href: string) => land(href),
  };
}

type Board = ReturnType<typeof useBoardRoute>;

function mount(router: ReturnType<typeof createRouter>) {
  const board: { current: Board | null } = { current: null };
  function Host() {
    const searchParams = router.useSearchParams();
    const replace = useCallback((href: string) => router.replace(href), []);
    const value = useBoardRoute({ searchParams, replace });
    // The test reads the committed owner, as an event handler would.
    useEffect(() => {
      board.current = value;
    });
    return <div data-rendered={JSON.stringify(value.route)} />;
  }
  const view = render(<Host />);
  const rendered = () =>
    JSON.parse(
      view.container
        .querySelector('[data-rendered]')!
        .getAttribute('data-rendered')!
    );
  return { board: () => board.current!, rendered };
}

afterEach(() => window.history.replaceState(null, '', '/'));

describe('useBoardRoute: the URL echo', () => {
  it('ignores an echo of its own older address once a newer one is asked', async () => {
    const router = createRouter();
    const { board, rendered } = mount(router);
    await act(async () => board().drillToProject('p1'));
    await act(async () => void board().overview());
    expect(rendered().altitude).toBe('fleet');

    // The router lands the drill's URL after the overview was asked.
    await act(async () => router.echo());
    expect(rendered().altitude).toBe('fleet');
    expect(board().ascend()).toBe(false);

    await act(async () => router.echo());
    expect(rendered().altitude).toBe('fleet');
  });

  it('adopts an address that arrives from outside as the latest one', async () => {
    const router = createRouter();
    const { board, rendered } = mount(router);
    await act(async () =>
      router.outside('/fleet/spatial?altitude=project&project=p2')
    );
    expect(rendered()).toMatchObject({ altitude: 'project', projectId: 'p2' });

    let moved = false;
    await act(async () => void (moved = board().overview()));
    expect(moved).toBe(true);
    expect(router.queued.at(-1)).toBe('/fleet/spatial');
  });

  it('keeps parameters it does not own when it writes the address', async () => {
    const router = createRouter('?q=build');
    const { board } = mount(router);
    await act(async () => board().drillToProject('p1'));
    expect(router.queued.at(-1)).toBe(
      '/fleet/spatial?q=build&altitude=project&project=p1'
    );
  });
});

describe('useBoardRoute: relative verbs answer from the latest address', () => {
  it('ascends Agent to its Project, Project to Fleet, and stops at Fleet', async () => {
    const router = createRouter('?altitude=agent&project=p1&agent=a1');
    const { board } = mount(router);
    await act(async () => expect(board().ascend()).toBe(true));
    expect(router.queued.at(-1)).toBe(
      '/fleet/spatial?altitude=project&project=p1'
    );
    await act(async () => expect(board().ascend()).toBe(true));
    expect(router.queued.at(-1)).toBe('/fleet/spatial');
    expect(board().ascend()).toBe(false);
  });

  it('ascends an Agent with no Project straight to Fleet', async () => {
    const router = createRouter('?altitude=agent&agent=a1');
    const { board } = mount(router);
    await act(async () => expect(board().ascend()).toBe(true));
    expect(router.queued.at(-1)).toBe('/fleet/spatial');
  });

  it('selects an Agent at the altitude the board is going to', async () => {
    const router = createRouter();
    const { board } = mount(router);
    await act(async () => void board().selectAgent('a1', 'p1'));
    expect(router.queued.at(-1)).toBe('/fleet/spatial?agent=a1');
    await act(async () => board().drillToProject('p1'));
    await act(async () => void board().selectAgent('a2', 'p1'));
    expect(router.queued.at(-1)).toBe(
      '/fleet/spatial?altitude=project&project=p1&agent=a2'
    );
  });

  it('toggles the projection from the latest asked, not the rendered one', async () => {
    const router = createRouter();
    const { board } = mount(router);
    await act(async () => {
      board().toggleProjection();
      board().toggleProjection();
    });
    expect(router.queued).toEqual([
      '/fleet/spatial?projection=fixed-angle',
      '/fleet/spatial',
    ]);
  });
});
