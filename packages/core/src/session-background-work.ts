/** Source-reported work running independently of the foreground turn.
 * Tools and monitors are not delegated Agents; never count them as children.
 * Keep only identity/kind, never commands, task output, or prompt content. */
export interface SessionBackgroundTask {
  id: string;
  type: string;
}

/** Shared by main-process attention and every renderer/source projection. */
export function sessionHasBackgroundWork(
  report:
    | {
        children: readonly unknown[];
        backgroundTasks?: readonly SessionBackgroundTask[];
      }
    | null
    | undefined
): boolean {
  return (
    !!report && (report.children.length > 0 || !!report.backgroundTasks?.length)
  );
}
