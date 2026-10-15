// @vitest-environment jsdom
import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { describe, expect, it } from 'vitest';
import { HARNESS_MARK_PATHS } from '@/components/workspace/harness-icons';
import { STORY_MARK_PATHS } from './concept-marks';
import { fleetModel, sourceAdapterId } from './fleet-model';
import { markIdFor, markToneHex } from './mark-tones';
import { makeMarkParts, MARK_COUNT, markIndexFor } from './visuals/crust-marks';

describe('harness marks', () => {
  it('give every harness in the study fleet its own mark', () => {
    const model = fleetModel();
    const bySource = new Map<string, number>();
    for (const agent of model.agents)
      bySource.set(agent.source, markIndexFor(sourceAdapterId(agent.source)));
    expect(bySource.size).toBeGreaterThan(1);
    expect(new Set(bySource.values()).size).toBe(bySource.size);
    for (const index of bySource.values()) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(MARK_COUNT);
    }
  });

  it('keep the concept marks out of the product registry', () => {
    // the product draws a mark only for a harness it runs; the story draws
    // the concepts from its own registry, after the product's
    const product = Object.keys(HARNESS_MARK_PATHS);
    for (const id of ['grok-bot', 'muse', 'instinct', 'dots']) {
      expect(product).not.toContain(id);
      expect(markIdFor(id)).toBe(id);
      expect(markIndexFor(id)).toBeGreaterThanOrEqual(product.length);
    }
  });

  it('have no mark for a harness the product may not draw', () => {
    expect(markIndexFor('antigravity')).toBe(-1);
    expect(markIndexFor('Something new')).toBe(-1);
    expect(markIdFor('antigravity')).toBeNull();
    expect(markIdFor('qwen')).toBeNull();
  });
});

describe('the marks as geometry', () => {
  const parts = makeMarkParts();
  const box = (g: THREE.BufferGeometry) => {
    g.computeBoundingBox();
    return g.boundingBox as THREE.Box3;
  };

  it('extrudes every part of every mark', () => {
    const marks = new Set(parts.map(part => part.mark));
    expect(marks.size).toBe(MARK_COUNT);
    for (const part of parts)
      expect(part.geometry.getAttribute('position').count).toBeGreaterThan(8);
  });

  it('fits every part in the unit box, standing from the face up', () => {
    for (const part of parts) {
      const b = box(part.geometry);
      expect(b.min.x).toBeGreaterThanOrEqual(-0.5 - 1e-6);
      expect(b.max.x).toBeLessThanOrEqual(0.5 + 1e-6);
      expect(b.min.z).toBeGreaterThanOrEqual(-0.5 - 1e-6);
      expect(b.max.z).toBeLessThanOrEqual(0.5 + 1e-6);
      expect(b.min.y).toBeCloseTo(0, 6);
      expect(b.max.y).toBeCloseTo(1, 6);
    }
  });

  it('never puts two overlapping parts of a mark on one layer', () => {
    // two surfaces at one height that overlap z-fight, which is what the
    // operator saw as flashing pixels on the pixel lobster's sides
    const bad: string[] = [];
    for (let m = 0; m < MARK_COUNT; m += 1) {
      const mine = parts.filter(part => part.mark === m);
      for (let i = 0; i < mine.length; i += 1)
        for (let j = i + 1; j < mine.length; j += 1) {
          const a = box(mine[i].geometry);
          const b = box(mine[j].geometry);
          const overlap =
            a.min.x < b.max.x &&
            a.max.x > b.min.x &&
            a.min.z < b.max.z &&
            a.max.z > b.min.z;
          if (overlap && mine[i].layer === mine[j].layer)
            bad.push(
              `mark ${m}: parts ${i} and ${j} share layer ${mine[i].layer}`
            );
        }
    }
    expect(bad).toEqual([]);
  });

  it('draws the mascot as a lobster: body under eyes under glints', () => {
    const lobster = HARNESS_MARK_PATHS.openclaw.parts;
    const layer = (tone: string) =>
      lobster.find(part => part.tone === tone)?.layer ?? -1;
    expect(lobster.length).toBe(5);
    expect(layer('claws')).toBeLessThan(layer('brand'));
    expect(layer('eye')).toBeGreaterThan(layer('brand'));
    expect(layer('glint')).toBeGreaterThan(layer('eye'));
    // the antennae are the vendor's strokes, extruded as outlines with width
    expect(lobster.some(part => part.stroke === 3)).toBe(true);
  });

  it("cuts Grok Bot's eyes out of its head, where its page paints them in the ground", () => {
    // xAI's own mark (W15p): the page fills the head with its ink and the
    // eyes with its ground; drawn in one ink here, the eyes are holes
    const mark = STORY_MARK_PATHS['grok-bot'];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${mark.viewBox} ${mark.viewBox}"><path d="${mark.parts[0].d}" fill-rule="${mark.fillRule}"/></svg>`;
    const shapes = new SVGLoader()
      .parse(svg)
      .paths.flatMap(path => SVGLoader.createShapes(path));
    expect(mark.parts).toHaveLength(1);
    expect(shapes).toHaveLength(1);
    expect(shapes[0].holes).toHaveLength(2);
  });

  it('gives a stroked antenna a real width, not a hairline', () => {
    const index = markIndexFor('openclaw');
    const mine = parts.filter(part => part.mark === index);
    const stroke = HARNESS_MARK_PATHS.openclaw.parts.findIndex(
      part => part.stroke !== undefined
    );
    const b = box(mine[stroke].geometry);
    const width = Math.min(b.max.x - b.min.x, b.max.z - b.min.z);
    // the two antennae together span the head; one is a few units wide
    expect(width).toBeGreaterThan(0.02);
    expect(b.max.z - b.min.z).toBeLessThan(0.2);
  });
});

describe('the paint of a mark', () => {
  it('names a colour only where the vendor supplies one', () => {
    expect(markToneHex('claude', 'brand')).toBe('#D97757');
    expect(markToneHex('openclaw', 'eye')).toBe('#050810');
    // black and white only: the surrounding ink
    expect(markToneHex('codex', 'ink')).toBeNull();
    expect(markToneHex('grok', 'ink')).toBeNull();
    expect(markToneHex('opencode', 'ink')).toBeNull();
  });

  it('resolves every tone the registries name', () => {
    for (const [id, mark] of Object.entries(STORY_MARK_PATHS))
      for (const part of mark.parts) {
        const hex = markToneHex(id as keyof typeof STORY_MARK_PATHS, part.tone);
        if (part.tone === 'ink') expect(hex).toBeNull();
        else expect(hex).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
  });
});
