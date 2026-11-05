import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AGENT_PERMISSION_MODES } from '@exawatt/core';
import { DEFAULT_AGENT_PERMISSION_MODE } from './agent-sources';
import { SessionPermissionMode } from './session-permission-mode';

describe('SessionPermissionMode', () => {
  it.each(AGENT_PERMISSION_MODES)(
    'states the %s mode an Agent was started in, and whether it is the default',
    mode => {
      render(<SessionPermissionMode mode={mode} />);
      const statement = document.querySelector(
        '[data-session-permission-mode]'
      );
      expect(statement).toHaveAttribute('data-session-permission-mode', mode);
      // BUG-331: the default is said in Exawatt, so the harness's own words
      // for it in the terminal read as Exawatt's choice.
      expect(statement?.hasAttribute('data-default')).toBe(
        mode === DEFAULT_AGENT_PERMISSION_MODE
      );
      expect(statement?.getAttribute('aria-label')).toBeTruthy();
    }
  );

  it('states nothing before main reports the mode', () => {
    render(<SessionPermissionMode mode={undefined} />);
    expect(document.querySelector('[data-session-permission-mode]')).toBeNull();
  });
});
