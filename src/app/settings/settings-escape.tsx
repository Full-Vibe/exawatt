'use client';

/**
 * esc dismisses Settings (ENG-016 D27): back through the app-location
 * stack, falling back to the workspace. It is Settings' altitude rung of the
 * back-out ladder, so a dialog, a recording editor or a field that takes
 * Escape answers first and this only runs once nothing above it did. Lives
 * beside SettingsClient (a page-level concern, not a widget one) so the
 * settings policy tests can keep mounting the client without a router.
 */
import { useRouter } from 'next/navigation';
import { useCommandNavigation } from '@/components/nav/command-navigation-provider';
import { useBackOut } from '@/lib/shortcuts/back-out';

export function SettingsEscape() {
  const router = useRouter();
  const { navigateBack } = useCommandNavigation();
  useBackOut({
    rung: 'altitude',
    ambient: true,
    back: () => {
      if (!navigateBack()) router.push('/workspace');
      return true;
    },
  });
  return null;
}
