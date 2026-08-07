import { describe, expect, it } from 'vitest';
import { teamGridYieldsTo } from './team-grid-nav';

describe('teamGridYieldsTo (FIX-006)', () => {
  const inside = (html: string): Element => {
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.append(host);
    return host.firstElementChild as Element;
  };

  it('yields to a text field, so typing reaches it', () => {
    expect(teamGridYieldsTo(inside('<input aria-label="Agent name" />'))).toBe(
      true
    );
    expect(teamGridYieldsTo(inside('<textarea></textarea>'))).toBe(true);
    expect(
      teamGridYieldsTo(inside('<div contenteditable="true">goal</div>'))
    ).toBe(true);
  });

  it('yields from a descendant of the control, not just the control', () => {
    const wrapper = inside(
      '<div><label><span>Name</span><input /></label></div>'
    );
    expect(teamGridYieldsTo(wrapper.querySelector('input'))).toBe(true);
  });

  it('keeps the keys the grid legitimately owns', () => {
    expect(teamGridYieldsTo(inside('<button>Open</button>'))).toBe(false);
    expect(teamGridYieldsTo(inside('<div data-tile="1">tile</div>'))).toBe(
      false
    );
    expect(teamGridYieldsTo(null)).toBe(false);
  });
});
