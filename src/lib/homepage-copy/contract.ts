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

const scene = z.strictObject({
  kicker: z
    .string()
    .trim()
    .max(100)
    .refine(value => !/[\r\n]/.test(value)),
  headline: z.array(line(180)).min(1).max(5),
  body: z.array(line(320)).max(6),
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
