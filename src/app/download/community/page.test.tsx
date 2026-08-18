import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { COMMUNITY_DISTRIBUTION } from '@exawatt/core/distribution';
import { DOWNLOAD_HREF } from '@/components/site/bands/download';
import { PUBLIC_DOWNLOAD_REWRITE } from '@/lib/distribution/next-policy';
import CommunityDownloadPage from './page';

afterEach(cleanup);

const REPO_ROOT = path.resolve(__dirname, '../../../..');

function read(relative: string): string {
  return readFileSync(path.join(REPO_ROOT, relative), 'utf8');
}

describe('the public download page answers the link the site already ships', () => {
  it('is what /download reaches when no composition owns the route', () => {
    expect(DOWNLOAD_HREF).toBe('/download');
    expect(PUBLIC_DOWNLOAD_REWRITE.source).toBe(DOWNLOAD_HREF);
    expect(PUBLIC_DOWNLOAD_REWRITE.destination).toBe('/download/community');
  });

  it('does not collide with the target the company overlay declares', () => {
    // The composer is add-only: `applyCompanyOverlayInPlace` FAILS the build
    // when the public tree tracks a declared target. Two addresses is what
    // keeps both pages possible, so this is the invariant, not a preference.
    //
    // A public checkout has no overlay to collide with, which is the same
    // "documented no-op" the in-place composer takes.
    if (!existsSync(path.join(REPO_ROOT, 'company/overlay-manifest.json'))) {
      expect(existsSync(path.join(REPO_ROOT, 'company'))).toBe(false);
      return;
    }
    const manifest = JSON.parse(read('company/overlay-manifest.json')) as {
      entries: { target: string }[];
    };
    const targets = manifest.entries.map(entry => entry.target);
    expect(targets).toContain('src/app/download/page.tsx');
    expect(targets).not.toContain(
      PUBLIC_DOWNLOAD_REWRITE.destination.slice(1) + '/page.tsx'
    );
    expect(targets).not.toContain('src/app/download/community/page.tsx');
  });
});

describe('the page is a trust surface, not a conversion surface', () => {
  it('offers no signed build and promotes no account', () => {
    render(<CommunityDownloadPage />);

    // Decision `0021` and marketing canon: the download surface never promotes
    // sign-in, and this tree has no signed artifact to hand anyone.
    const links = Array.from(document.querySelectorAll('a')).map(
      anchor => anchor.getAttribute('href') ?? ''
    );
    expect(links.some(href => href.includes('/sign-in'))).toBe(false);
    expect(links.some(href => href.includes('/sign-up'))).toBe(false);
    expect(links.some(href => href.includes('/download/artifact'))).toBe(false);
    expect(document.querySelectorAll('a[download]')).toHaveLength(0);
  });

  it('carries no em dash anywhere in its rendered copy', () => {
    // `docs/product/marketing.md`, Copy rules: no em dashes, ever, in
    // public-facing copy.
    const { container } = render(<CommunityDownloadPage />);
    expect(container.textContent ?? '').not.toContain('—');
  });
});

describe('every build instruction on the page exists in this repository', () => {
  const scripts = (
    JSON.parse(read('package.json')) as { scripts: Record<string, string> }
  ).scripts;

  it('names a package script that exists', () => {
    render(<CommunityDownloadPage />);
    const command = screen.getByText(/pnpm electron:build:dir/);
    expect(command).toBeVisible();
    expect(scripts).toHaveProperty('electron:build:dir');
  });

  it('names the directory electron-builder actually writes', () => {
    // `MAC_OUTPUT_DIR` in `scripts/lib/packaged-app.mjs` is the single place
    // that spelling lives; read it rather than importing an .mjs into the
    // typed app graph.
    const declared = /MAC_OUTPUT_DIR = path\.join\('([^']+)', '([^']+)'\)/.exec(
      read('scripts/lib/packaged-app.mjs')
    );
    expect(declared).not.toBeNull();
    const outputDir = `${declared?.[1]}/${declared?.[2]}`;
    expect(outputDir).toBe('release/mac-arm64');

    render(<CommunityDownloadPage />);
    expect(screen.getByText(outputDir)).toBeVisible();
  });

  it('names the community product, not the official one', () => {
    // `distributionIdentity(COMMUNITY_DISTRIBUTION).productName` is what the
    // packaged bundle is called; the page must not promise `Exawatt.app`.
    expect(COMMUNITY_DISTRIBUTION.brand).toBe(null);
    render(<CommunityDownloadPage />);
    expect(screen.getByText('Exawatt Community.app')).toBeVisible();
  });
});

describe('the distinction from an official build is stated, with the license', () => {
  it('points at LICENSING.md and TRADEMARKS.md, and both exist', () => {
    render(<CommunityDownloadPage />);

    for (const [label, file] of [
      ['LICENSING.md', 'LICENSING.md'],
      ['TRADEMARKS.md', 'TRADEMARKS.md'],
    ] as const) {
      const link = screen.getByText(label).closest('a');
      expect(link?.getAttribute('href')).toContain(file);
      expect(read(file).length).toBeGreaterThan(0);
    }
  });

  it('says official builds come from exawatt.ai without offering one here', () => {
    render(<CommunityDownloadPage />);
    expect(
      screen.getByText(/Official signed builds come from exawatt\.ai/)
    ).toBeVisible();
  });
});

describe('the plain account of machine behaviour is present', () => {
  it('renders the shared disclosures under a community contract', () => {
    render(<CommunityDownloadPage />);
    expect(screen.getByText('How it works on your machine')).toBeVisible();
    expect(
      screen.getByText('Agents launch in YOLO mode by default')
    ).toBeVisible();
    expect(screen.getByText(/declares no Exawatt services/)).toBeVisible();
  });
});
