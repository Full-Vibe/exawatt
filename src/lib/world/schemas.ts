import { z } from 'zod';
import { ARCHETYPE_IDS } from './archetypes';

export const MIN_POPULATION = 4;
export const MAX_POPULATION = 24;
export const MIN_TURNS = 1;
export const MAX_TURNS = 8;

export const simulateRequestSchema = z.object({
  profile: z.string().trim().min(1).max(200),
  topic: z.string().trim().max(280).optional(),
  populationSize: z.coerce.number().int().min(MIN_POPULATION).max(MAX_POPULATION),
  turns: z.coerce.number().int().min(MIN_TURNS).max(MAX_TURNS),
  archetypeIds: z
    .array(z.enum(ARCHETYPE_IDS as [string, ...string[]]))
    .min(1),
});
export type SimulateRequest = z.infer<typeof simulateRequestSchema>;

export const seedProfileSchema = z.object({
  name: z.string().describe('Display name'),
  handle: z.string().describe('Handle without the @'),
  bio: z.string().describe('Short bio, one sentence'),
  voice: z
    .string()
    .describe('One sentence describing tone, topics, and posting style'),
});
export type SeedProfile = z.infer<typeof seedProfileSchema>;

export const personaSchema = z.object({
  name: z.string(),
  handle: z.string().describe('Handle without the @, must be unique'),
  archetypeId: z.string(),
  bio: z.string().describe('Short bio, one sentence'),
  voice: z
    .string()
    .describe('One sentence describing tone, topics, and posting style'),
});
export type Persona = z.infer<typeof personaSchema>;

export const populationSchema = z.object({
  personas: z.array(personaSchema),
});

export const tweetDraftSchema = z.object({
  authorHandle: z
    .string()
    .describe('Handle of the poster, without @ — must match the seed or a persona'),
  kind: z.enum(['post', 'reply', 'quote']),
  inReplyToId: z
    .number()
    .int()
    .nullable()
    .describe('id of the tweet being replied to or quoted, else null'),
  text: z.string().max(280),
});
export type TweetDraft = z.infer<typeof tweetDraftSchema>;

export const turnBatchSchema = z.object({
  tweets: z.array(tweetDraftSchema),
});

export interface Tweet extends TweetDraft {
  id: number;
  turn: number;
  authorName: string;
  isSeed: boolean;
  likes: number;
  reposts: number;
}

// NDJSON events streamed from POST /api/world/simulate, one JSON object per
// line, in emission order.
export type SimulateEvent =
  | { type: 'status'; message: string }
  | { type: 'seed'; seed: SeedProfile; profileHintsFound: boolean }
  | { type: 'population'; personas: Persona[] }
  | { type: 'turn'; turn: number; tweets: Tweet[] }
  | { type: 'done' }
  | { type: 'error'; message: string };
