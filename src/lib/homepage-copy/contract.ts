import { z } from 'zod';
import { DOWNLOAD_LABEL } from '@/components/site/bands/download';
import { STAGES, type StageId } from '@/components/site/fleet-story/stages';

/** Stable content keys. Scene order and behavior stay in STAGES, not the store. */
export const HOMEPAGE_SCENE_IDS = [
  'landing',
  'working',
  'needs-you',
  'third',
  'fleet',
] as const satisfies readonly StageId[];

const line = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(value => !/[\r\n]/.test(value), 'Keep each line in its own field');

const nonBlankLines = (maximum: number, maxLines: number, minLines = 0) =>
  z.preprocess(
    value =>
      Array.isArray(value)
        ? value.filter(line => typeof line !== 'string' || line.trim())
        : value,
    z.array(line(maximum)).min(minLines).max(maxLines)
  );

const scene = z.strictObject({
  kicker: z
    .string()
    .trim()
    .max(100)
    .refine(value => !/[\r\n]/.test(value)),
  headline: nonBlankLines(180, 5, 1),
  body: nonBlankLines(320, 6),
});

const schema = z.strictObject({
  version: z.literal(1),
  scenes: z.strictObject({
    landing: scene,
    working: scene,
    'needs-you': scene,
    third: scene,
    fleet: scene,
  }),
  actions: z.strictObject({
    downloadLabel: line(80),
    githubLabel: line(80),
  }),
});

export type HomepageCopyDocument = z.infer<typeof schema>;

export type HomepageCopyIssue = {
  fieldId: string;
  message: string;
};

function issueFieldId(path: PropertyKey[]): string | null {
  if (path[0] === 'scenes' && typeof path[1] === 'string') {
    const field = path[2];
    if (field === 'kicker' || field === 'headline' || field === 'body') {
      return `${path[1]}-${field}`;
    }
  }
  if (path[0] === 'actions') {
    if (path[1] === 'downloadLabel') return 'download-label';
    if (path[1] === 'githubLabel') return 'github-label';
  }
  return null;
}

function issueMessage(issue: z.core.$ZodIssue): string {
  const lineIndex = issue.path[3];
  if (issue.code === 'too_big') {
    if (typeof lineIndex === 'number') {
      return `Line ${lineIndex + 1} must be ${issue.maximum} characters or fewer.`;
    }
    if (issue.path[0] === 'scenes' && issue.path[2] !== 'kicker') {
      return `Use ${issue.maximum} lines or fewer.`;
    }
    return `Use ${issue.maximum} characters or fewer.`;
  }
  if (issue.code === 'too_small') {
    if (typeof lineIndex === 'number') return `Line ${lineIndex + 1} is blank.`;
    if (issue.path[0] === 'actions') return 'Enter a button label.';
    return 'Add at least one line.';
  }
  if (issue.code === 'custom') return 'Keep this text on one line.';
  return 'Check this field.';
}

/** Human-readable, field-addressed errors for the editor and server action. */
export function validateHomepageCopyDocument(
  value: unknown
):
  | { success: true; document: HomepageCopyDocument }
  | { success: false; issues: HomepageCopyIssue[] } {
  const result = schema.safeParse(value);
  if (result.success) return { success: true, document: result.data };
  return {
    success: false,
    issues: result.error.issues
      .map(issue => {
        const fieldId = issueFieldId(issue.path);
        return fieldId ? { fieldId, message: issueMessage(issue) } : null;
      })
      .filter((issue): issue is HomepageCopyIssue => issue !== null),
  };
}

/** The checked-in public copy, used by Community and as the hosted fallback. */
export const HOMEPAGE_COPY_BASELINE: HomepageCopyDocument = {
  version: 1,
  scenes: Object.fromEntries(
    STAGES.map(stage => [
      stage.id,
      {
        kicker: stage.copy.canon.kicker ?? '',
        headline: [...stage.copy.canon.headline],
        body: [...(stage.copy.canon.body ?? [])],
      },
    ])
  ) as HomepageCopyDocument['scenes'],
  actions: {
    downloadLabel: DOWNLOAD_LABEL,
    githubLabel: 'View on GitHub',
  },
};

/** Reject partial, foreign-version, and malformed snapshots before rendering. */
export function parseHomepageCopyDocument(
  value: unknown
): HomepageCopyDocument {
  return schema.parse(value);
}
