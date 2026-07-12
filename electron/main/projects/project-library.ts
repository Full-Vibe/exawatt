import * as fs from 'fs';
import * as path from 'path';
import { resolveProject } from '../pty/project-resolve';

export interface ProjectImportCandidate {
  projectDir: string;
  projectName: string;
  suggested: boolean;
}

const PROJECT_MARKERS = [
  '.git',
  'package.json',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'Gemfile',
  'pom.xml',
  'build.gradle',
  'Makefile',
];

async function validateDirectory(raw: string): Promise<string> {
  if (
    typeof raw !== 'string' ||
    !raw ||
    raw.includes('\0') ||
    raw.length > 4096 ||
    !path.isAbsolute(raw)
  ) {
    throw new Error('Choose a valid absolute directory');
  }
  const resolved = path.resolve(raw);
  const stat = await fs.promises.stat(resolved).catch(() => null);
  if (!stat?.isDirectory()) throw new Error(`Directory does not exist: ${raw}`);
  return resolved;
}

export async function resolveProjectDirectory(raw: string) {
  const directory = await validateDirectory(raw);
  return resolveProject(directory);
}

export async function scanProjectDirectory(
  raw: string
): Promise<ProjectImportCandidate[]> {
  const root = await validateDirectory(raw);
  const children = (await fs.promises.readdir(root, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .slice(0, 200)
    .sort((a, b) => a.name.localeCompare(b.name));
  const candidates: ProjectImportCandidate[] = [];
  for (let index = 0; index < children.length; index += 8) {
    const batch = children.slice(index, index + 8);
    const discovered = await Promise.all(
      batch.map(async entry => {
        const child = path.join(root, entry.name);
        const project = await resolveProject(child);
        const childEntries = await fs.promises.readdir(child).catch(() => []);
        const childNames = new Set(childEntries);
        return {
          projectDir: project.projectDir,
          projectName: project.projectName,
          suggested:
            project.projectDir !== child ||
            PROJECT_MARKERS.some(marker => childNames.has(marker)),
        };
      })
    );
    candidates.push(...discovered);
  }
  const deduped = new Map<string, ProjectImportCandidate>();
  for (const candidate of candidates) {
    const previous = deduped.get(candidate.projectDir);
    if (!previous || candidate.suggested) {
      deduped.set(candidate.projectDir, candidate);
    }
  }
  return [...deduped.values()];
}
