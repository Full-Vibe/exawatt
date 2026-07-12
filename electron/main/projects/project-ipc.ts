import { handleTrusted } from '../ipc-security';
import {
  resolveProjectDirectory,
  scanProjectDirectory,
} from './project-library';

function failure(error: unknown) {
  return {
    ok: false as const,
    error: error instanceof Error ? error.message : String(error),
  };
}

export function registerProjectIPC(): void {
  handleTrusted('projects:resolve', async (_event, directory: string) => {
    try {
      const project = await resolveProjectDirectory(directory);
      return { ok: true as const, ...project };
    } catch (error) {
      return failure(error);
    }
  });
  handleTrusted(
    'projects:scan-directory',
    async (_event, directory: string) => {
      try {
        return {
          ok: true as const,
          candidates: await scanProjectDirectory(directory),
        };
      } catch (error) {
        return failure(error);
      }
    }
  );
}
