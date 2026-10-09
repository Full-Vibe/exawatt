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
  CHAPTERS,
  WORLDS,
  type Voice,
  type WorldStyle,
} from './model';
import styles from './study.module.css';

const World = dynamic(() => import('./world'), {
  ssr: false,
  loading: () => <div className={styles.fallback}>Preparing your fleet…</div>,
});
type Mode = 'story' | 'lab' | 'outline';

export function TerrainStudy() {
  const [mode, setMode] = useState<Mode>('story');
  const [kind, setKind] = useState<WorldStyle>('terrace');
  const [voice, setVoice] = useState<Voice>('control');
  const [chapter, setChapter] = useState(0);
  const [count, setCount] = useState(10);
  const [manualCount, setManualCount] = useState(false);
  const [selected, setSelected] = useState(0);
  const [angle, setAngle] = useState(20);
  const [links, setLinks] = useState(true);
  const [wire, setWire] = useState(false);
  const [scan, setScan] = useState(0);
  const [approved, setApproved] = useState(false);
  const [shortlisted, setShortlisted] = useState<WorldStyle | null>(null);
  const [notice, setNotice] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastChapter = useRef(-1);
  const reduced = usePrefersReducedMotion();
  const shownCount =
    mode === 'story' && !manualCount
      ? chapter === 4
        ? 100
        : chapter === 5
          ? 1
          : 10
      : count;
  const picked = Math.min(selected, shownCount - 1);
  const agent = agentAt(picked, approved);
  const beat = CHAPTERS[chapter];
  const currentWorld = WORLDS.find(w => w.id === kind)!;
  const setFleet = useCallback((n: number) => {
    setCount(Math.min(100, Math.max(1, n)));
    setManualCount(true);
  }, []);
  const selectAgent = useCallback((id: number) => setSelected(id), []);
  const addAgent = useCallback(
    (id = shownCount) => {
      setFleet(id + 1);
      setSelected(Math.min(99, id));
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
      const next = Math.min(
        CHAPTERS.length - 1,
        Math.max(0, Math.round(root.scrollTop / root.clientHeight))
      );
      setChapter(next);
      if (next !== lastChapter.current) {
        setSelected(next === 2 ? 1 : next === 3 ? 4 : 0);
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
  }, [mode]);
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
    if (next === 'lab') {
      setCount(shownCount);
      setManualCount(true);
    }
  };
  const renderInspector = (isStory: boolean) => (
    <div className={styles.inspector} data-state={agent.state}>
      <div className={styles.inspectorTop}>
        <span className={styles.eyebrow}>
          {chapter === 3 && isStory ? 'Next in line' : 'Agent detail'}
        </span>
        <span className={styles.meta}>{agent.source}</span>
      </div>
      <h3>{agent.name}</h3>
      <div className={styles.stateLine}>
        <StatusLightMark state={agent.state} size={17} animated={!reduced} />
        <span>{STATUS_LIGHT_META[agent.state].label}</span>
      </div>
      <div className={styles.detailRule} />
      {chapter === 3 && isStory ? (
        <>
          <span className={styles.concept}>Scheduling concept</span>
          <p>Waiting for the checkout review.</p>
          <div className={styles.dependency}>
            <span>01</span> Review the pull request <ArrowDown size={13} />
            <span>02</span> Test the payment flow
          </div>
          <button className={styles.textButton} onClick={() => setSelected(1)}>
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
              setNotice('Demo approval received. The agent is working again.');
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
              <dd>Storefront</dd>
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
          {approved && picked === 1 && (
            <span className={styles.receipt}>
              <Check size={14} /> Approval received
            </span>
          )}
        </>
      )}
    </div>
  );

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
              aria-pressed={kind === w.id}
              onClick={() => {
                setKind(w.id);
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
                  chapter={mode === 'story' ? chapter : 0}
                  angle={angle}
                  links={links}
                  scan={scan}
                  approved={approved}
                  wire={wire}
                  onSelect={selectAgent}
                  onAdd={addAgent}
                />
              </div>
              {mode === 'story' ? (
                <>
                  <div className={styles.storyCopy} key={`${chapter}-${voice}`}>
                    <span className={styles.eyebrow}>
                      {chapter === 0
                        ? 'A command surface for your AI agents'
                        : `0${chapter} / ${beat.label}`}
                    </span>
                    <h1>{beat[voice][0]}</h1>
                    <p>{beat[voice][1]}</p>
                    {chapter === 0 && (
                      <button
                        className={styles.primary}
                        onClick={() => jump(1)}
                      >
                        See it in motion <ArrowDown size={16} />
                      </button>
                    )}
                    {chapter === 5 && (
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
                  {chapter >= 1 && chapter <= 3 && (
                    <div className={styles.storyInspector}>
                      {renderInspector(true)}
                    </div>
                  )}
                  {chapter === 4 && (
                    <div className={styles.fleetCaption}>
                      <strong>{shownCount}</strong>
                      <span>agents, one view</span>
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
                  </div>
                  <aside className={styles.labInspector}>
                    {renderInspector(false)}
                  </aside>
                </>
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
                    +
                  </button>
                </div>
                <div className={styles.cameraControl}>
                  <button
                    aria-label="Rotate camera left"
                    onClick={() => setAngle(a => a - 25)}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span>Perspective</span>
                  <button
                    aria-label="Rotate camera right"
                    onClick={() => setAngle(a => a + 25)}
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
                {manualCount && mode === 'story' && (
                  <button
                    aria-label="Restore story fleet sizes"
                    onClick={() => setManualCount(false)}
                  >
                    <RotateCcw size={14} />
                  </button>
                )}
              </div>
            </div>
          </div>
          {mode === 'lab' && (
            <section className={styles.agentIndex}>
              <h2>Every agent is reachable.</h2>
              <p>
                Select a name to inspect it. Use the plus markers to grow the
                fleet.
              </p>
              <div className={styles.agentList}>
                {Array.from({ length: shownCount }, (_, i) => {
                  const a = agentAt(i, approved);
                  return (
                    <button
                      key={i}
                      aria-pressed={picked === i}
                      onClick={() => setSelected(i)}
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
