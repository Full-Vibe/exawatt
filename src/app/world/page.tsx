'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { Loader2, Sparkles, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { ARCHETYPES } from '@/lib/world/archetypes';
import {
  MAX_POPULATION,
  MAX_TURNS,
  MIN_POPULATION,
  MIN_TURNS,
  type Persona,
  type SeedProfile,
  type SimulateEvent,
  type Tweet,
} from '@/lib/world/schemas';
import { TweetCard } from './_components/tweet-card';

interface TurnGroup {
  turn: number;
  tweets: Tweet[];
}

export default function WorldPage() {
  const [profile, setProfile] = useState('');
  const [topic, setTopic] = useState('');
  const [populationSize, setPopulationSize] = useState(10);
  const [turns, setTurns] = useState(5);
  const [archetypeIds, setArchetypeIds] = useState<string[]>(
    ARCHETYPES.map(a => a.id)
  );

  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seed, setSeed] = useState<SeedProfile | null>(null);
  const [profileHintsFound, setProfileHintsFound] = useState(false);
  const [population, setPopulation] = useState<Persona[]>([]);
  const [turnGroups, setTurnGroups] = useState<TurnGroup[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const tweetById = useMemo(() => {
    const map = new Map<number, Tweet>();
    for (const group of turnGroups) for (const t of group.tweets) map.set(t.id, t);
    return map;
  }, [turnGroups]);

  const toggleArchetype = (id: string) => {
    setArchetypeIds(current =>
      current.includes(id) ? current.filter(a => a !== id) : [...current, id]
    );
  };

  const reset = () => {
    setStatus(null);
    setError(null);
    setSeed(null);
    setProfileHintsFound(false);
    setPopulation([]);
    setTurnGroups([]);
  };

  const run = useCallback(async () => {
    if (!profile.trim() || archetypeIds.length === 0 || running) return;
    reset();
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch('/api/world/simulate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          profile,
          topic: topic.trim() || undefined,
          populationSize,
          turns,
          archetypeIds,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null);
        setError(body?.error ?? 'The simulation could not start.');
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
          const raw = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          if (!raw.trim()) continue;
          const event: SimulateEvent = JSON.parse(raw);
          switch (event.type) {
            case 'status':
              setStatus(event.message);
              break;
            case 'seed':
              setSeed(event.seed);
              setProfileHintsFound(event.profileHintsFound);
              break;
            case 'population':
              setPopulation(event.personas);
              break;
            case 'turn':
              setTurnGroups(current => [...current, { turn: event.turn, tweets: event.tweets }]);
              break;
            case 'done':
              setStatus(null);
              break;
            case 'error':
              setError(event.message);
              break;
          }
        }
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setError(err instanceof Error ? err.message : 'The simulation failed.');
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }, [profile, topic, populationSize, turns, archetypeIds, running]);

  const stop = () => abortRef.current?.abort();

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10">
      <div>
        <p className="text-sm font-medium text-primary">Hackathon toy</p>
        <h1 className="text-2xl font-semibold text-foreground">World</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Give it a public X profile. It casts a simulated population around
          it and plays the timeline forward, turn by turn. Everyone in it,
          including the seed account, is a fabricated persona for this toy —
          not the real person&apos;s actual posts.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Card className="h-fit lg:sticky lg:top-6">
          <CardHeader>
            <CardTitle className="text-base">Set up the timeline</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="world-profile">X handle or profile URL</Label>
              <Input
                id="world-profile"
                placeholder="@handle or x.com/handle"
                value={profile}
                onChange={e => setProfile(e.target.value)}
                disabled={running}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="world-topic">Starting topic (optional)</Label>
              <Textarea
                id="world-topic"
                placeholder="What are they posting about?"
                value={topic}
                onChange={e => setTopic(e.target.value)}
                disabled={running}
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="world-population">
                  Population ({populationSize})
                </Label>
                <Input
                  id="world-population"
                  type="number"
                  min={MIN_POPULATION}
                  max={MAX_POPULATION}
                  value={populationSize}
                  onChange={e =>
                    setPopulationSize(
                      Math.min(
                        MAX_POPULATION,
                        Math.max(MIN_POPULATION, Number(e.target.value) || MIN_POPULATION)
                      )
                    )
                  }
                  disabled={running}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="world-turns">Turns ({turns})</Label>
                <Input
                  id="world-turns"
                  type="number"
                  min={MIN_TURNS}
                  max={MAX_TURNS}
                  value={turns}
                  onChange={e =>
                    setTurns(
                      Math.min(
                        MAX_TURNS,
                        Math.max(MIN_TURNS, Number(e.target.value) || MIN_TURNS)
                      )
                    )
                  }
                  disabled={running}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Personae in the population</Label>
              <div className="flex flex-wrap gap-1.5">
                {ARCHETYPES.map(archetype => {
                  const active = archetypeIds.includes(archetype.id);
                  return (
                    <button
                      key={archetype.id}
                      type="button"
                      disabled={running}
                      onClick={() => toggleArchetype(archetype.id)}
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-50',
                        active
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-input bg-transparent text-muted-foreground hover:bg-accent'
                      )}
                    >
                      {archetype.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {running ? (
              <Button variant="outline" onClick={stop} className="gap-2">
                <Square className="h-4 w-4" />
                Stop
              </Button>
            ) : (
              <Button
                onClick={run}
                disabled={!profile.trim() || archetypeIds.length === 0}
                className="gap-2"
              >
                <Sparkles className="h-4 w-4" />
                Run simulation
              </Button>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          {status && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {status}
            </div>
          )}

          {seed && (
            <Card>
              <CardContent className="flex flex-col gap-1 py-4">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-foreground">{seed.name}</p>
                  <span className="text-sm text-muted-foreground">@{seed.handle}</span>
                  <span
                    className={cn(
                      'ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                      profileHintsFound
                        ? 'bg-emerald-500/15 text-emerald-500'
                        : 'bg-amber-500/15 text-amber-500'
                    )}
                    title={
                      profileHintsFound
                        ? 'Found public profile hints for this handle'
                        : 'No public profile hints found — persona inferred from the handle alone'
                    }
                  >
                    {profileHintsFound ? 'profile found' : 'inferred'}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">{seed.bio}</p>
              </CardContent>
            </Card>
          )}

          {population.length > 0 && (
            <Card>
              <CardContent className="py-4">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Population ({population.length})
                </p>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {population.map(p => (
                    <span key={p.handle}>@{p.handle}</span>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {turnGroups.length > 0 && (
            <Card className="overflow-hidden py-0">
              {turnGroups.map(group => (
                <div key={group.turn}>
                  <p className="border-b border-border bg-muted/40 px-4 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Turn {group.turn}
                  </p>
                  {group.tweets.map(tweet => (
                    <TweetCard
                      key={tweet.id}
                      tweet={tweet}
                      replyingToHandle={
                        tweet.inReplyToId != null
                          ? tweetById.get(tweet.inReplyToId)?.authorHandle
                          : undefined
                      }
                    />
                  ))}
                </div>
              ))}
            </Card>
          )}

          {!running && !seed && !error && (
            <p className="text-sm text-muted-foreground">
              Nothing simulated yet — set up the timeline and run it.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
