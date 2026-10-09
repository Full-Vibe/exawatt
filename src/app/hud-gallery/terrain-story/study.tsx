'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Layers3,
  RotateCcw,
  ScanLine,
} from 'lucide-react';
import { StatusLightMark } from '@/components/status-light/status-light';
import { STATUS_LIGHT_META } from '@/components/status-light/protocol';
import { usePrefersReducedMotion } from '@/lib/motion/use-prefers-reduced-motion';
import {
  agentAt,
  teamOf,
  TEAMS,
  CHAPTERS,
  WORLDS,
  type Voice,
  type WorldStyle,
} from './model';
import {
  copyOpacity,
  createMotionPort,
  storyFleetCount,
  type FocusScale,
} from './motion';
import styles from './study.module.css';

const World = dynamic(() => import('./world'), {
  ssr: false,
  loading: () => <div className={styles.fallback}>Preparing your fleet…</div>,
});
type Mode = 'story' | 'lab' | 'outline';

export function TerrainStudy() {
  const [mode, setMode] = useState<Mode>('story');
  const [kind, setKind] = useState<WorldStyle>('prism');
  const [voice, setVoice] = useState<Voice>('control');
  const [chapter, setChapter] = useState(0);
  const [count, setCount] = useState(10);
  const [motion] = useState(createMotionPort);
  const [focus, setFocus] = useState<FocusScale>('fleet');
  const copyNodes = useRef(new Map<number, HTMLDivElement>());
  const inspectorNodes = useRef(new Map<number, HTMLDivElement>());
  const paintProgress = useCallback((progress: number) => {
    for (const [i, el] of copyNodes.current) {
      const opacity = copyOpacity(progress, i);
      el.style.opacity = String(opacity);
      el.style.visibility = opacity > 0.01 ? 'visible' : 'hidden';
      el.style.pointerEvents = opacity > 0.85 ? 'auto' : 'none';
      el.inert = opacity < 0.85;
    }
    for (const [i, el] of inspectorNodes.current) {
      const opacity = copyOpacity(progress, i);
      el.style.opacity = String(opacity);
      el.style.visibility = opacity > 0.01 ? 'visible' : 'hidden';
      el.inert = opacity < 0.85;
    }
  }, []);
  const [selected, setSelected] = useState(0);
  const [inspected, setInspected] = useState<number | null>(null);
  const [links, setLinks] = useState(true);
  const [wire, setWire] = useState(false);
  const [scan, setScan] = useState(0);
  const [approved, setApproved] = useState(false);
  const [shortlisted, setShortlisted] = useState<WorldStyle | null>(null);
  const [notice, setNotice] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastChapter = useRef(-1);
  const reduced = usePrefersReducedMotion();
  const shownCount = count;
  const picked = Math.min(selected, shownCount - 1);
  const currentWorld = WORLDS.find(w => w.id === kind)!;
  const setFleet = useCallback((n: number) => {
    setCount(Math.min(100, Math.max(1, n)));
    setInspected(id => (id !== null && id >= n ? null : id));
  }, []);
  const selectAgent = useCallback((id: number) => {
    setSelected(id);
    setInspected(id);
  }, []);
  const addAgent = useCallback(
    (id = shownCount) => {
      setFleet(id + 1);
    },
    [shownCount, setFleet]
  );

  useEffect(() => {
    try {
      const saved = localStorage.getItem('exa-terrain-shortlist');
      if (WORLDS.some(w => w.id === saved)) setShortlisted(saved as WorldStyle);
    } catch {
      /* A private-browser session can still review the study. */
    }
  }, []);
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || mode !== 'story') return;
    let pending = 0;
    const read = () => {
      pending = 0;
      const progress = Math.max(
        0,
        Math.min(CHAPTERS.length - 1, root.scrollTop / root.clientHeight)
      );
      motion.change({ progress, mode: 'story' });
      setCount(storyFleetCount(progress));
      const next = Math.min(
        CHAPTERS.length - 1,
        Math.max(0, Math.round(root.scrollTop / root.clientHeight))
      );
      setChapter(next);
      if (next !== lastChapter.current) {
        setSelected(next === 2 ? 1 : next === 3 ? 4 : 0);
        setInspected(null);
        lastChapter.current = next;
      }
    };
    const onScroll = () => {
      if (!pending) pending = requestAnimationFrame(read);
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    read();
    return () => {
      root.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(pending);
    };
  }, [mode, motion]);
  const jump = (i: number) => {
    if (mode !== 'story') {
      setChapter(i);
      setMode('story');
    }
    requestAnimationFrame(() =>
      scrollRef.current?.scrollTo({
        top: i * scrollRef.current.clientHeight,
        behavior: reduced ? 'instant' : 'smooth',
      })
    );
  };
  const shortlist = () => {
    setShortlisted(kind);
    try {
      localStorage.setItem('exa-terrain-shortlist', kind);
      setNotice(`${currentWorld.name} saved on this browser.`);
    } catch {
      setNotice(`${currentWorld.name} selected for this session.`);
    }
  };
  const switchMode = (next: Mode) => {
    setMode(next);
    if (next !== 'outline') motion.change({ mode: next });
    if (next === 'lab')
      requestAnimationFrame(() =>
        scrollRef.current?.scrollTo({ top: 0, behavior: 'instant' })
      );
  };
  const renderInspector = (
    isStory: boolean,
    storyChapter = chapter,
    id = picked
  ) => {
    const agent = agentAt(id, approved);
    return (
      <div className={styles.inspector} data-state={agent.state}>
        <div className={styles.inspectorTop}>
          <span className={styles.eyebrow}>
            {storyChapter === 3 && isStory ? 'Next in line' : 'Agent detail'}
          </span>
          <span className={styles.meta}>{agent.source}</span>
        </div>
        <h3>{agent.name}</h3>
        <div className={styles.stateLine}>
          <StatusLightMark state={agent.state} size={17} animated={!reduced} />
          <span>{STATUS_LIGHT_META[agent.state].label}</span>
        </div>
        <div className={styles.detailRule} />
        {storyChapter === 3 && isStory ? (
          <>
            <span className={styles.concept}>Scheduling concept</span>
            <p>Waiting for the checkout review.</p>
            <div className={styles.dependency}>
              <span>01</span> Review the pull request <ArrowDown size={13} />
              <span>02</span> Test the payment flow
            </div>
            <button
              className={styles.textButton}
              onClick={() => setSelected(1)}
            >
              Inspect the dependency <ArrowUpRight size={14} />
            </button>
          </>
        ) : agent.state === 'needs-you' ? (
          <>
            <p>Ready to run the migration against the staging database.</p>
            <div className={styles.request}>Your approval is required.</div>
            <button
              className={styles.approve}
              onClick={() => {
                setApproved(true);
                setNotice(
                  'Demo approval received. The agent is working again.'
                );
              }}
            >
              Approve in demo <ArrowUpRight size={15} />
            </button>
          </>
        ) : (
          <>
            <p>
              {agent.state === 'active'
                ? 'Working through the next step. The session is ready when you want a closer look.'
                : agent.state === 'result'
                  ? 'The result is ready for you to review.'
                  : agent.state === 'fault'
                    ? 'The tool call failed. Open the session to investigate.'
                    : 'At rest. Ready for the next instruction.'}
            </p>
            <dl>
              <div>
                <dt>Project</dt>
                <dd>{TEAMS[teamOf(id)]}</dd>
              </div>
              <div>
                <dt>Context</dt>
                <dd>
                  {agent.parent === null
                    ? 'Primary session'
                    : `Delegated by agent ${agent.parent + 1}`}
                </dd>
              </div>
            </dl>
            {approved && id === 1 && (
              <span className={styles.receipt}>
                <Check size={14} /> Approval received
              </span>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <main className={styles.study}>
      <header className={styles.header}>
        <a className={styles.brand} href="/hud-gallery">
          <span className={styles.brandMark}>e</span> Exawatt{' '}
          <span className={styles.headerDivider}>/</span>
          <span className={styles.studyName}>Homepage study</span>
        </a>
        <nav className={styles.modeTabs} aria-label="Study view">
          {(
            [
              ['story', 'Scroll story'],
              ['lab', 'Visual lab'],
              ['outline', 'Storyboard'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              aria-pressed={mode === id}
              onClick={() => switchMode(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <span className={styles.draft}>Concept preview</span>
      </header>
      <div className={styles.toolbar}>
        <div className={styles.worldTabs} aria-label="Visual direction">
          {WORLDS.map((w, i) => (
            <button
              key={w.id}
              data-material-tab={w.id}
              aria-pressed={kind === w.id}
              onClick={() => {
                setKind(w.id);
                if (mode === 'lab')
                  scrollRef.current?.scrollTo({ top: 0, behavior: 'instant' });
                setScan(n => n + 1);
              }}
            >
              <span>0{i + 1}</span>
              {w.name}
              {shortlisted === w.id && <Check size={12} />}
            </button>
          ))}
        </div>
        <div className={styles.voice}>
          <span>Message</span>
          <select
            aria-label="Messaging direction"
            value={voice}
            onChange={e => setVoice(e.target.value as Voice)}
          >
            <option value="control">Stay in control</option>
            <option value="momentum">Build momentum</option>
          </select>
        </div>
        <button
          className={styles.lofi}
          aria-pressed={wire}
          onClick={() => setWire(v => !v)}
        >
          <Layers3 size={14} /> Lo-fi
        </button>
      </div>

      {mode === 'outline' ? (
        <div className={styles.outline}>
          <div className={styles.outlineIntro}>
            <span className={styles.eyebrow}>The story in six movements</span>
            <h1>One world. A clearer story.</h1>
            <p>
              A persistent fleet moves from the promise to the individual, then
              opens out to show the whole operation.
            </p>
          </div>
          <div className={styles.storyboards}>
            {CHAPTERS.map((item, i) => (
              <button
                key={item.id}
                onClick={() => jump(i)}
                className={styles.storyboard}
              >
                <div className={styles.storyboardMeta}>
                  <span>
                    0{i + 1} / {item.label}
                  </span>
                  <span>Slide {item.slide}</span>
                </div>
                <div className={styles.sketch} data-beat={i}>
                  <div className={styles.sketchWorld}>
                    {Array.from({ length: i === 4 ? 37 : 13 }, (_, j) => (
                      <i key={j} />
                    ))}
                  </div>
                  {i > 0 && i < 4 && (
                    <div className={styles.sketchPanel}>
                      <b />
                      <i />
                      <i />
                    </div>
                  )}
                  <span>
                    {i === 0
                      ? 'A useful fleet at first glance'
                      : i === 4
                        ? 'Pull back. Keep individual agents visible.'
                        : i === 5
                          ? 'A simple next step'
                          : 'One agent. One meaningful state.'}
                  </span>
                </div>
                <h2>{item[voice][0]}</h2>
                <p>{item[voice][1]}</p>
                <span className={styles.openBeat}>
                  Experience this beat <ArrowUpRight size={16} />
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div
          ref={scrollRef}
          className={`${styles.scroller} ${mode === 'lab' ? styles.labScroller : ''}`}
          tabIndex={0}
          aria-label={
            mode === 'story'
              ? 'Homepage scroll preview'
              : 'Fleet visual laboratory'
          }
        >
          <div
            className={styles.track}
            style={{
              height: mode === 'story' ? `${CHAPTERS.length * 100}%` : '100%',
            }}
          >
            <div
              className={styles.stage}
              data-chapter={mode === 'lab' ? 'lab' : chapter}
              data-wire={wire}
              data-material={kind}
            >
              <div className={styles.stageNoise} />
              <div className={styles.previewBrand}>
                Exawatt<span>Command your agents.</span>
              </div>
              <span className={styles.demoBadge}>Illustrative fleet</span>
              <div className={styles.worldArea}>
                <World
                  kind={kind}
                  count={shownCount}
                  selected={picked}
                  motion={motion}
                  onProgress={paintProgress}
                  links={links}
                  scan={scan}
                  approved={approved}
                  wire={wire}
                  onSelect={selectAgent}
                  inspected={
                    inspected !== null && inspected < shownCount
                      ? inspected
                      : null
                  }
                />
              </div>
              {mode === 'story' ? (
                <>
                  {CHAPTERS.map((beat, index) => (
                    <div
                      className={styles.storyCopy}
                      key={beat.id}
                      data-copy={index}
                      ref={el => {
                        if (el) copyNodes.current.set(index, el);
                        else copyNodes.current.delete(index);
                      }}
                      style={{
                        opacity: index === 0 ? 1 : 0,
                        visibility: index === 0 ? 'visible' : 'hidden',
                      }}
                    >
                      <span className={styles.eyebrow}>
                        {index === 0
                          ? 'A command surface for your AI agents'
                          : `0${index} / ${beat.label}`}
                      </span>
                      <h1>{beat[voice][0]}</h1>
                      <p>{beat[voice][1]}</p>
                      {index === 0 && (
                        <button
                          className={styles.primary}
                          onClick={() => jump(1)}
                        >
                          See it in motion <ArrowDown size={16} />
                        </button>
                      )}
                      {index === 5 && (
                        <>
                          <a
                            className={styles.primary}
                            href="/download/community"
                          >
                            Download for macOS <ArrowUpRight size={16} />
                          </a>
                          <span className={styles.closeNote}>
                            Explore the available Community build
                          </span>
                        </>
                      )}
                    </div>
                  ))}
                  {inspected !== null &&
                    [1, 2, 3].map(i => (
                      <div
                        key={i}
                        className={styles.storyInspector}
                        data-inspector={i}
                        ref={el => {
                          if (el) inspectorNodes.current.set(i, el);
                          else inspectorNodes.current.delete(i);
                        }}
                        style={{ opacity: 0, visibility: 'hidden' }}
                      >
                        {renderInspector(
                          true,
                          i,
                          chapter === i
                            ? picked
                            : Math.min(count - 1, i === 2 ? 1 : i === 3 ? 4 : 0)
                        )}
                      </div>
                    ))}
                  {chapter === 4 && (
                    <div className={styles.fleetCaption}>
                      <strong>{shownCount}</strong>
                      <span>agents, one view · scroll to grow</span>
                      <button
                        onClick={() => setFleet(shownCount === 100 ? 10 : 100)}
                      >
                        {shownCount === 100
                          ? 'Collapse to 10'
                          : 'Expand to 100'}{' '}
                        <ArrowUpRight size={14} />
                      </button>
                    </div>
                  )}
                  <nav
                    className={styles.chapterNav}
                    aria-label="Story chapters"
                  >
                    {CHAPTERS.map((c, i) => (
                      <button
                        key={c.id}
                        aria-current={chapter === i ? 'step' : undefined}
                        aria-label={c.label}
                        onClick={() => jump(i)}
                      >
                        <span />
                        {chapter === i && <em>{c.label}</em>}
                      </button>
                    ))}
                  </nav>
                  <div className={styles.scrollCue}>
                    <span>{String(chapter + 1).padStart(2, '0')} / 06</span>
                    <button
                      onClick={() => jump(chapter === 5 ? 0 : chapter + 1)}
                    >
                      {chapter === 5
                        ? 'Back to the beginning'
                        : 'Scroll to explore'}{' '}
                      {chapter === 5 ? (
                        <RotateCcw size={13} />
                      ) : (
                        <ArrowDown size={13} />
                      )}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className={styles.labIntro}>
                    <span className={styles.eyebrow}>
                      0{WORLDS.findIndex(w => w.id === kind) + 1} / Spatial
                      direction
                    </span>
                    <h1>{currentWorld.name}</h1>
                    <p>{currentWorld.description}</p>
                    <button className={styles.textButton} onClick={shortlist}>
                      {shortlisted === kind ? <Check size={15} /> : null}
                      {shortlisted === kind
                        ? 'Shortlisted'
                        : 'Shortlist this direction'}{' '}
                      <ArrowUpRight size={14} />
                    </button>
                    <span className={styles.dragHint}>
                      Drag the world to orbit · select an agent to inspect
                    </span>
                  </div>
                  {inspected !== null && (
                    <aside className={styles.labInspector}>
                      {renderInspector(false)}
                    </aside>
                  )}
                </>
              )}
              {mode === 'lab' && (
                <div
                  className={styles.focusControls}
                  aria-label="Inspection scale"
                >
                  {(['agent', 'team', 'fleet'] as const).map(scale => (
                    <button
                      key={scale}
                      aria-pressed={focus === scale}
                      onClick={() => {
                        setFocus(scale);
                        motion.change({ focus: scale });
                      }}
                    >
                      {scale}
                    </button>
                  ))}
                </div>
              )}
              {mode === 'lab' && focus === 'team' && (
                <div className={styles.teamCaption}>
                  {TEAMS[teamOf(picked)]}
                  <span>
                    {
                      Array.from({ length: count }, (_, i) => i).filter(
                        i => teamOf(i) === teamOf(picked)
                      ).length
                    }{' '}
                    agents · shared territory
                  </span>
                </div>
              )}
              <div className={styles.worldControls}>
                <div className={styles.countControl}>
                  <span>Agents</span>
                  {[1, 10, 100].map(n => (
                    <button
                      key={n}
                      aria-pressed={shownCount === n}
                      onClick={() => setFleet(n)}
                    >
                      {n}
                    </button>
                  ))}
                  <button
                    aria-label="Add one demo agent"
                    disabled={shownCount >= 100}
                    onClick={() => addAgent()}
                  >
                    Add agent
                  </button>
                </div>
                <div className={styles.cameraControl}>
                  <button
                    aria-label="Rotate camera left"
                    onClick={() => motion.orbit(-0.42, 0)}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span>Perspective</span>
                  <button
                    aria-label="Rotate camera right"
                    onClick={() => motion.orbit(0.42, 0)}
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
                <button
                  className={styles.relationships}
                  aria-pressed={links}
                  onClick={() => setLinks(v => !v)}
                >
                  Relationships
                </button>
                {kind === 'survey' && (
                  <button onClick={() => setScan(n => n + 1)}>
                    <ScanLine size={15} /> Scan
                  </button>
                )}
              </div>
            </div>
          </div>
          {mode === 'lab' && (
            <section className={styles.agentIndex}>
              <h2>Every agent is reachable.</h2>
              <p>
                Select a name to inspect it. Outlines show where the fleet can
                grow.
              </p>
              <div className={styles.agentList}>
                {Array.from({ length: shownCount }, (_, i) => {
                  const a = agentAt(i, approved);
                  return (
                    <button
                      key={i}
                      aria-pressed={picked === i}
                      onClick={() => selectAgent(i)}
                    >
                      <StatusLightMark
                        state={a.state}
                        size={17}
                        animated={!reduced}
                      />
                      <span>{a.name}</span>
                      <small>{STATUS_LIGHT_META[a.state].label}</small>
                    </button>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}
      <div className={styles.liveNotice} role="status">
        {notice}
      </div>
    </main>
  );
}
