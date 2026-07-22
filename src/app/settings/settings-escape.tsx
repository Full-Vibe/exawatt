'use client';

/**
 * esc dismisses Settings (ENG-016 D27): back through the app-location
 * stack, falling back to the workspace. Lives beside SettingsClient (a
 * page-level concern, not a widget one) so the settings policy tests can
 * keep mounting the client without a router. Recording editors and
 * dialogs own Escape while open — their events arrive defaultPrevented
 * or targeted inside a [role="dialog"].
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useCommandNavigation } from '@/components/nav/command-navigation-provider';

export function SettingsEscape() {
  const router = useRouter();
  const { navigateBack } = useCommandNavigation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (e.target instanceof Element && e.target.closest('[role="dialog"]'))
        return;
      e.preventDefault();
      if (!navigateBack()) router.push('/workspace');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigateBack, router]);
  return null;
}
