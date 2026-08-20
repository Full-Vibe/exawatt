import { anthropic } from '@ai-sdk/anthropic';
import { generateText, Output } from 'ai';
import type { z } from 'zod';
import { archetypeById, type Archetype } from './archetypes';
import type { ProfileHints } from './profile-fetch';
import {
  populationSchema,
  seedProfileSchema,
  turnBatchSchema,
  type Persona,
  type SeedProfile,
  type Tweet,
  type TweetDraft,
} from './schemas';

const MODEL = anthropic('claude-sonnet-5');

const TIMELINE_WINDOW = 40;

async function generateStructured<T>(
  schema: z.ZodType<T>,
  prompt: string
): Promise<T> {
  const { output } = await generateText({
    model: MODEL,
    output: Output.object({ schema }),
    prompt,
  });
  return output;
}

export async function buildSeedProfile(
  handle: string,
  topic: string | undefined,
  hints: ProfileHints | null
): Promise<SeedProfile> {
  const hintLines = hints
    ? [
        hints.ogTitle ? `Public page title: ${hints.ogTitle}` : null,
        hints.ogDescription ? `Public page bio: ${hints.ogDescription}` : null,
      ].filter(Boolean)
    : [];

  const object = await generateStructured(
    seedProfileSchema,
    [
      `You are reconstructing a plausible public persona for the X (Twitter) account @${handle}, for a fictional social-simulation toy. This is not the real person — invent a consistent, plausible persona.`,
      hintLines.length
        ? `Real public hints found for this account:\n${hintLines.join('\n')}\nStay consistent with these.`
        : `No public hints were found for this handle — infer a plausible persona from the handle text alone.`,
      topic ? `They are about to post about: ${topic}` : '',
      `Return their display name (use the hint title if one was found), handle "${handle}", a one-sentence bio, and a one-sentence description of their posting voice/tone/topics.`,
    ]
      .filter(Boolean)
      .join('\n\n')
  );
  return { ...object, handle };
}

export async function buildPopulation(
  size: number,
  archetypeIds: string[]
): Promise<Persona[]> {
  const archetypes = archetypeIds
    .map(archetypeById)
    .filter((a): a is Archetype => Boolean(a));
  const roster = archetypes
    .map(a => `- ${a.id}: ${a.label} — ${a.voice}`)
    .join('\n');

  const object = await generateStructured(
    populationSchema,
    [
      `Invent a cast of exactly ${size} fictional X (Twitter) users for a social-simulation toy.`,
      `Distribute them across these archetypes (mix freely, roughly balanced):`,
      roster,
      `Each persona needs a distinct name, a unique lowercase handle (no spaces, no @), the archetypeId it was drawn from, a one-sentence bio, and a one-sentence voice description covering tone and typical topics. Make the cast feel like a real varied timeline, not ${size} copies of the same person.`,
    ].join('\n\n')
  );
  return object.personas.slice(0, size);
}

interface TurnContext {
  turn: number;
  totalTurns: number;
  seed: SeedProfile;
  population: Persona[];
  timeline: Tweet[];
  topic: string | undefined;
}

function formatTimeline(timeline: Tweet[]): string {
  const recent = timeline.slice(-TIMELINE_WINDOW);
  if (recent.length === 0) return '(nothing posted yet)';
  return recent
    .map(
      t =>
        `[${t.id}] @${t.authorHandle} (${t.kind}${t.inReplyToId != null ? ` → [${t.inReplyToId}]` : ''}): ${t.text}`
    )
    .join('\n');
}

function rosterLine(seed: SeedProfile, population: Persona[]): string {
  const seedLine = `@${seed.handle} (${seed.name}) — THE SEED ACCOUNT — ${seed.voice}`;
  const rest = population
    .map(p => `@${p.handle} (${p.name}, ${p.archetypeId}) — ${p.voice}`)
    .join('\n');
  return [seedLine, rest].join('\n');
}

export async function generateTurn(ctx: TurnContext): Promise<TweetDraft[]> {
  const { turn, totalTurns, seed, population, timeline, topic } = ctx;

  const instructions =
    turn === 1
      ? [
          `This is the opening turn. Only @${seed.handle} posts, exactly one tweet.`,
          topic
            ? `The tweet is about: ${topic}`
            : `Invent something plausible for them to post about, in their voice.`,
        ]
      : [
          `Turn ${turn} of ${totalTurns}. Simulate how the timeline moves next: a handful of the cast (3-8 tweets total) reply, quote, dogpile, joke, or post new unrelated content, reacting to what's above.`,
          `Favor replies/quotes over fresh posts as the thread heats up. Let drama, memes, or consensus emerge naturally. @${seed.handle} may post again if it fits, but does not have to.`,
          turn === totalTurns
            ? `This is the final turn — let it land somewhere (a punchline, a pile-on, a fizzle, whatever is true to how it's been going).`
            : '',
        ];

  const object = await generateStructured(
    turnBatchSchema,
    [
      `You are simulating a small slice of X (Twitter) for a social-simulation toy. Cast (handle — voice):`,
      rosterLine(seed, population),
      `Timeline so far (id, author, kind, text):`,
      formatTimeline(timeline),
      instructions.filter(Boolean).join('\n'),
      `Each tweet: authorHandle must be exactly one of the handles above (no @). kind is "post" for a fresh tweet, "reply" or "quote" referencing an existing tweet id via inReplyToId (null for "post"). Keep tweets under 280 characters, in-character, and varied in tone across the batch.`,
    ].join('\n\n')
  );
  return object.tweets;
}

// `startId` is the caller's running timeline length — ids assigned here are
// request-local, never shared module state, so concurrent simulations never
// collide.
export function materializeTweets(
  drafts: TweetDraft[],
  turn: number,
  seed: SeedProfile,
  population: Persona[],
  startId: number
): Tweet[] {
  const byHandle = new Map<string, { name: string; isSeed: boolean }>();
  byHandle.set(seed.handle, { name: seed.name, isSeed: true });
  for (const p of population) byHandle.set(p.handle, { name: p.name, isSeed: false });

  let id = startId;
  return drafts
    .filter(d => byHandle.has(d.authorHandle))
    .map(d => {
      const author = byHandle.get(d.authorHandle)!;
      const virality = 1 + turn * 0.6;
      const likes = Math.floor(Math.random() * 60 * virality);
      const reposts = Math.floor(likes * (0.05 + Math.random() * 0.25));
      return {
        ...d,
        id: id++,
        turn,
        authorName: author.name,
        isSeed: author.isSeed,
        likes,
        reposts,
      };
    });
}
