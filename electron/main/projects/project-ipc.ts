import { handleTrusted } from '../ipc-security';
import { createSuggestionsSource } from './harness-project-suggestions';
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
  // ENG-046 O1: read the harness stores when a surface asks, answer repeat
  // asks from the same read, and re-read on an explicit refresh.
  const suggestions = createSuggestionsSource();
  handleTrusted('projects:suggestions', (_event, request) =>
    suggestions({
      refresh:
        typeof request === 'object' && request !== null
          ? request.refresh === true
          : false,
    })
  );
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
