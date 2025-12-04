'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

const slides = [
  {
    id: 'title',
    title: 'Exawatt',
    subtitle: 'Agent Control Plane for the AI-Native Enterprise',
    content: (
      <p className="text-xl sm:text-2xl text-muted-foreground max-w-2xl">
        The control, observability, and governance layer for every AI agent in your company.
      </p>
    ),
  },
  {
    id: 'future',
    title: 'The Future of Work',
    subtitle: 'Very soon, every leader will manage a fleet of AI agents',
    content: (
      <ul className="space-y-6 text-lg sm:text-xl text-muted-foreground max-w-2xl text-left">
        <li className="flex items-start gap-3">
          <span className="text-foreground mt-1">→</span>
          <span>Teams won&apos;t just be people—they&apos;ll be people and agents working together</span>
        </li>
        <li className="flex items-start gap-3">
          <span className="text-foreground mt-1">→</span>
          <span>Your org chart will include autonomous workers running 24/7</span>
        </li>
        <li className="flex items-start gap-3">
          <span className="text-foreground mt-1">→</span>
          <span>The question isn&apos;t whether agents will work for you—it&apos;s how you&apos;ll manage them</span>
        </li>
      </ul>
    ),
  },
  {
    id: 'problem',
    title: 'The Problem',
    subtitle: 'AI agents are everywhere, but nobody has control',
    content: (
      <ul className="space-y-4 text-lg sm:text-xl text-muted-foreground max-w-2xl text-left">
        <li className="flex items-start gap-3">
          <span className="text-destructive mt-1">✕</span>
          <span>No central view of what agents are doing right now</span>
        </li>
        <li className="flex items-start gap-3">
          <span className="text-destructive mt-1">✕</span>
          <span>Tasks silently block on missing info or credentials</span>
        </li>
        <li className="flex items-start gap-3">
          <span className="text-destructive mt-1">✕</span>
          <span>Agents can take expensive or irreversible actions with no oversight</span>
        </li>
        <li className="flex items-start gap-3">
          <span className="text-destructive mt-1">✕</span>
          <span>88% of orgs are piloting AI agents, but oversight is a top barrier</span>
        </li>
      </ul>
    ),
  },
  {
    id: 'solution',
    title: 'The Solution',
    subtitle: 'Exawatt: Your agent control center',
    content: (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-3xl w-full">
        {[
          {
            title: 'Agent Kanban',
            desc: 'Every task is a ticket: Backlog → Running → Blocked → Done',
          },
          {
            title: 'Observer Agent',
            desc: 'Detects when agents are stuck and verifies work meets criteria',
          },
          {
            title: 'Human-in-the-Loop',
            desc: 'Morning briefs and one-tap approvals from mobile',
          },
          {
            title: 'Permissions & Audit',
            desc: 'Sandboxing, cost guards, and full replay of everything',
          },
        ].map((feature) => (
          <div
            key={feature.title}
            className="p-6 rounded-xl border bg-card text-left"
          >
            <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
            <p className="text-muted-foreground">{feature.desc}</p>
          </div>
        ))}
      </div>
    ),
  },
  {
    id: 'market',
    title: 'Market Opportunity',
    subtitle: 'A multi-billion dollar category is emerging',
    content: (
      <div className="space-y-8 max-w-2xl">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 text-left">
          <div className="p-6 rounded-xl border bg-card">
            <div className="text-3xl font-bold mb-2">$4-9B</div>
            <p className="text-muted-foreground">TAM by 2030 for agent control plane</p>
          </div>
          <div className="p-6 rounded-xl border bg-card">
            <div className="text-3xl font-bold mb-2">$5B+</div>
            <p className="text-muted-foreground">Bottom-up: 50k prospects × $100k ACV</p>
          </div>
        </div>
        <div className="text-left space-y-2 text-muted-foreground">
          <p><span className="text-foreground font-medium">Business model:</span> SaaS platform + per-seat pricing + usage tiers + enterprise add-ons</p>
          <p><span className="text-foreground font-medium">Agentic AI market:</span> $7B (2025) → $93B (2032)</p>
        </div>
      </div>
    ),
  },
  {
    id: 'gtm',
    title: 'Go-to-Market',
    subtitle: 'Land with developers, expand across the enterprise',
    content: (
      <div className="space-y-8 max-w-2xl">
        <div className="space-y-6 text-left">
          <div className="flex items-start gap-4">
            <div className="w-24 shrink-0 font-semibold">Land</div>
            <p className="text-muted-foreground">AI-heavy dev teams running agentic workflows</p>
          </div>
          <div className="flex items-start gap-4">
            <div className="w-24 shrink-0 font-semibold">Expand</div>
            <p className="text-muted-foreground">Support, sales ops, finance ops as agents proliferate</p>
          </div>
          <div className="flex items-start gap-4">
            <div className="w-24 shrink-0 font-semibold">Distribute</div>
            <p className="text-muted-foreground">SDKs for popular agent frameworks, marketplace integrations</p>
          </div>
        </div>
        <div className="text-left pt-4 border-t text-muted-foreground">
          <p><span className="text-foreground font-medium">Roadmap:</span> Kanban + observability → Policy engine + approvals → Deep integrations with OS-level and SaaS agents</p>
        </div>
      </div>
    ),
  },
  {
    id: 'ask',
    title: 'The Ask',
    subtitle: 'Join us in building the control layer for the agentic future',
    content: (
      <div className="space-y-8 max-w-2xl text-left">
        <div className="space-y-4">
          <div className="flex items-start gap-4">
            <div className="w-32 shrink-0 font-semibold">Stage</div>
            <p className="text-muted-foreground">Pre-seed / Seed</p>
          </div>
          <div className="flex items-start gap-4">
            <div className="w-32 shrink-0 font-semibold">Use of funds</div>
            <div className="text-muted-foreground">
              <p>Expand engineering for SDKs and policy engine</p>
              <p>Build sales/devrel to go after AI-heavy dev teams</p>
            </div>
          </div>
        </div>
        <div className="pt-6">
          <p className="text-xl text-foreground font-medium">Let&apos;s talk.</p>
        </div>
      </div>
    ),
  },
];

export default function DeckPage() {
  const [activeSlide, setActiveSlide] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const index = slideRefs.current.indexOf(entry.target as HTMLElement);
            if (index !== -1) {
              setActiveSlide(index);
            }
          }
        });
      },
      {
        root: container,
        threshold: 0.5,
      }
    );

    slideRefs.current.forEach((slide) => {
      if (slide) observer.observe(slide);
    });

    return () => observer.disconnect();
  }, []);

  const scrollToSlide = (index: number) => {
    slideRefs.current[index]?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div
      ref={containerRef}
      className="h-screen overflow-y-auto snap-y snap-mandatory bg-background"
    >
      {/* Navigation dots */}
      <nav className="fixed right-6 top-1/2 -translate-y-1/2 z-50 flex flex-col gap-3">
        {slides.map((slide, index) => (
          <button
            key={slide.id}
            onClick={() => scrollToSlide(index)}
            className={cn(
              'w-3 h-3 rounded-full transition-all duration-200',
              activeSlide === index
                ? 'bg-foreground scale-125'
                : 'bg-muted-foreground/30 hover:bg-muted-foreground/50'
            )}
            aria-label={`Go to slide ${index + 1}: ${slide.title}`}
          />
        ))}
      </nav>

      {/* Slides */}
      {slides.map((slide, index) => (
        <section
          key={slide.id}
          ref={(el) => { slideRefs.current[index] = el; }}
          className="min-h-screen snap-start flex flex-col items-center justify-center px-8 py-16"
        >
          <div className="flex flex-col items-center text-center max-w-4xl">
            <h1 className="text-4xl sm:text-6xl font-bold tracking-tight mb-4">
              {slide.title}
            </h1>
            {slide.subtitle && (
              <p className="text-xl sm:text-2xl text-muted-foreground mb-12">
                {slide.subtitle}
              </p>
            )}
            {slide.content}
          </div>
        </section>
      ))}
    </div>
  );
}
