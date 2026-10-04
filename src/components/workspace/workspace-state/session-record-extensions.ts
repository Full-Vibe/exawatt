import {
  isCanonicalSessionRecordField,
  safeSourceExtensions,
} from '@exawatt/core/desktop-bridge';
import type { PersistedSessionTab } from './persisted-layout';

export function splitSessionRecord(record: PersistedSessionTab): {
  known: PersistedSessionTab;
  extensions: Record<string, unknown>;
} {
  const known = Object.fromEntries(
    Object.entries(record).filter(
      ([key]) =>
        key !== 'sourceRecordExtensions' && isCanonicalSessionRecordField(key)
    )
  ) as unknown as PersistedSessionTab;
  return {
    known,
    extensions: safeSourceExtensions(
      record as unknown as Record<string, unknown>
    ),
  };
}
