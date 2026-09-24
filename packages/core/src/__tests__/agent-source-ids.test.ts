import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  AGENT_HARNESSES,
  AGENT_SOURCE_ADAPTER_IDS,
  AGENT_SOURCE_CATALOG_IDS,
  isAgentHarness,
  isAgentSourceAdapterId,
} from '../agent-sources';

interface ContractEntry {
  adapterId: string;
  harness?: string | null;
}

const contract = JSON.parse(
  readFileSync(
    new URL('../../../../contracts/agent-sources.json', import.meta.url),
    'utf8'
  )
) as { sources: ContractEntry[]; comingSoon: ContractEntry[] };

describe('Agent Source ids', () => {
  it('derive from the contract, in contract order', () => {
    expect(AGENT_SOURCE_ADAPTER_IDS).toEqual(
      contract.sources.map(source => source.adapterId)
    );
    expect(AGENT_HARNESSES).toEqual(
      contract.sources.flatMap(source =>
        source.harness ? [source.harness] : []
      )
    );
    expect(AGENT_SOURCE_CATALOG_IDS).toEqual([
      ...AGENT_SOURCE_ADAPTER_IDS,
      ...contract.comingSoon.map(entry => entry.adapterId),
    ]);
  });

  it('guard untrusted input by declaration, not by string shape', () => {
    for (const harness of AGENT_HARNESSES) {
      expect(isAgentHarness(harness)).toBe(true);
      expect(isAgentSourceAdapterId(harness)).toBe(true);
    }
    for (const source of contract.sources.filter(entry => !entry.harness)) {
      expect(isAgentHarness(source.adapterId)).toBe(false);
      expect(isAgentSourceAdapterId(source.adapterId)).toBe(true);
    }
    for (const value of [
      'shell',
      'custom',
      'CLAUDE',
      '',
      null,
      undefined,
      1,
      {},
    ]) {
      expect(isAgentHarness(value)).toBe(false);
    }
    expect(isAgentSourceAdapterId('custom')).toBe(false);
    expect(isAgentSourceAdapterId('toString')).toBe(false);
  });
});
