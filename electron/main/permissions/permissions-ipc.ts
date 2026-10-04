import { handleBounded } from '../ipc-arguments';
import { handleTrusted } from '../ipc-security';
import type { PermissionService } from './permission-service';

/**
 * The renderer's four doors to the permission service (ENG-045): the last
 * snapshot (read once on first ask), a re-read, `ensure`, and the System Settings pane. None of them
 * can raise a system prompt unless the caller says the primer was shown, and
 * only `ensure` takes that flag.
 */
export function registerPermissionsIPC(service: PermissionService): void {
  handleTrusted('permissions:snapshot', () => {
    const last = service.snapshot();
    // A first ask reads every grant; later asks answer from the last read.
    return last.every(entry => entry.checkedAt !== null)
      ? last
      : service.refresh();
  });
  handleTrusted('permissions:refresh', () => service.refresh());
  handleBounded('permissions:ensure', (_event, id, request) =>
    service.ensure(id, request)
  );
  handleBounded('permissions:open-settings', (_event, id) =>
    service.openSettings(id)
  );
}
