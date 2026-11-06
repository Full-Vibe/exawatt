'use client';

import { useEffect } from 'react';
import { NoticeLaneItem } from '@/components/ui/notice-lane';
import { OperationReceipt } from '@/components/ui/operation-receipt';
import {
  dismissNativeDialogFailure,
  useNativeDialogFailure,
} from './native-dialog';

/** Long enough to read a sentence; the next request clears it sooner. */
const NATIVE_DIALOG_NOTICE_MS = 8_000;

/**
 * The one place a folder request says why it ended without the operator's
 * answer (BUG-339), mounted once for the app. Browse, Import and Locate,
 * from the chooser, the Start screen or ⌘K, all fail here.
 *
 * It carries no controls on purpose: it often appears over the chooser,
 * whose focus trap keeps the keyboard from reaching anything outside it,
 * and a click outside would close the chooser the operator is still using.
 * It clears on the next request or once it has had time to be read.
 */
export function NativeDialogNotice() {
  const failure = useNativeDialogFailure();
  useEffect(() => {
    if (!failure) return;
    const timer = setTimeout(
      () => dismissNativeDialogFailure(failure.id),
      NATIVE_DIALOG_NOTICE_MS
    );
    return () => clearTimeout(timer);
  }, [failure]);

  if (!failure) return null;
  return (
    <NoticeLaneItem lane="hint">
      <OperationReceipt
        state="error"
        title={failure.message}
        data-native-dialog-failure=""
      />
    </NoticeLaneItem>
  );
}
