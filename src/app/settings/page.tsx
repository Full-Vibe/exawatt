import { SettingsClient } from './settings-client';

// No server-side auth gate: settings is an Electron surface (⌘,) that must
// render offline and signed out (ENG-016 D18 offline authority). Sections
// that sync through Supabase handle the signed-out state client-side.
export default function SettingsPage() {
  return <SettingsClient />;
}
