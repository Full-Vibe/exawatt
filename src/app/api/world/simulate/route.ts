import { NextRequest } from 'next/server';
import { extractHandle, fetchProfileHints } from '@/lib/world/profile-fetch';
import { simulateRequestSchema, type SimulateEvent, type Tweet } from '@/lib/world/schemas';
import { buildPopulation, buildSeedProfile, generateTurn, materializeTweets } from '@/lib/world/simulate';

export const maxDuration = 300;

function line(event: SimulateEvent): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(event) + '\n');
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = simulateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: parsed.error.message }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }
  const { profile, topic, populationSize, turns, archetypeIds } = parsed.data;
  const handle = extractHandle(profile);
  if (!handle) {
    return new Response(JSON.stringify({ error: 'Could not read a handle from that profile.' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: SimulateEvent) => controller.enqueue(line(event));
      try {
        emit({ type: 'status', message: `Looking up @${handle}...` });
        const hints = await fetchProfileHints(handle);

        emit({ type: 'status', message: 'Building seed profile...' });
        const seed = await buildSeedProfile(handle, topic, hints);
        emit({ type: 'seed', seed, profileHintsFound: hints !== null });

        emit({ type: 'status', message: `Casting ${populationSize} personas...` });
        const population = await buildPopulation(populationSize, archetypeIds);
        emit({ type: 'population', personas: population });

        const timeline: Tweet[] = [];
        for (let turn = 1; turn <= turns; turn++) {
          emit({ type: 'status', message: `Simulating turn ${turn} of ${turns}...` });
          const drafts = await generateTurn({
            turn,
            totalTurns: turns,
            seed,
            population,
            timeline,
            topic,
          });
          const tweets = materializeTweets(drafts, turn, seed, population, timeline.length);
          timeline.push(...tweets);
          emit({ type: 'turn', turn, tweets });
        }

        emit({ type: 'done' });
      } catch (error) {
        emit({
          type: 'error',
          message: error instanceof Error ? error.message : 'Simulation failed.',
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson',
      'cache-control': 'no-store',
    },
  });
}
