import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface SkillMeta {
  name: string;
  description: string;
  path: string;
}

interface ParsedSkill {
  meta: SkillMeta;
  body: string;
}

/**
 * SkillRegistry — reads `SKILL.md` files from a directory at construction.
 *
 * Layout:
 *   <skillsDir>/
 *     <skill-name>/
 *       SKILL.md   (YAML frontmatter with `description`, then Markdown body)
 *
 * Frontmatter format:
 *   ---
 *   name: <skill-name>
 *   description: <one-line when-to-use>
 *   ---
 *
 * The body is the skill's execution manual (steps, constraints, output format).
 */
export class SkillRegistry {
  private cache = new Map<string, ParsedSkill>();

  constructor(private skillsDir: string) {
    this.loadAll();
  }

  private loadAll(): void {
    if (!existsSync(this.skillsDir)) return;
    let entries: { name: string; isDirectory: () => boolean }[];
    try {
      entries = readdirSync(this.skillsDir, { withFileTypes: true }) as never;
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillMdPath = join(this.skillsDir, entry.name, 'SKILL.md');
      if (!existsSync(skillMdPath)) continue;
      try {
        const raw = readFileSync(skillMdPath, 'utf8');
        const parsed = parseFrontmatter(raw);
        this.cache.set(entry.name, {
          meta: { name: entry.name, description: parsed.description, path: skillMdPath },
          body: parsed.body.trim(),
        });
      } catch {
        // skip unreadable / malformed SKILL.md
      }
    }
  }

  list(): SkillMeta[] {
    return Array.from(this.cache.values()).map((c) => c.meta);
  }

  /** Returns the full skill (frontmatter + body) or undefined if not found. */
  get(name: string): { meta: SkillMeta; body: string } | undefined {
    const found = this.cache.get(name);
    if (!found) return undefined;
    return { meta: found.meta, body: found.body };
  }

  has(name: string): boolean {
    return this.cache.has(name);
  }

  /** Directory this registry is reading from. */
  get dir(): string { return this.skillsDir; }
}

/**
 * Resolve the default skills directory.
 *
 * Search order:
 *   1. RUNNER_SKILLS_DIR env (absolute or relative to cwd)
 *   2. `<cwd>/skills/`
 *   3. `<cwd>/.claude/skills/`
 *   4. `<this-file>/../../../skills/`  (the repo's skills dir when running from source)
 */
export function resolveDefaultSkillsDir(cwd: string = process.cwd()): string {
  if (process.env['RUNNER_SKILLS_DIR']) {
    return process.env['RUNNER_SKILLS_DIR'];
  }
  const candidates = [join(cwd, 'skills'), join(cwd, '.claude', 'skills')];
  for (const c of candidates) if (existsSync(c)) return c;
  // Fallback: relative to this source file
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const repoSkills = join(here, '..', '..', '..', 'skills');
    if (existsSync(repoSkills)) return repoSkills;
  } catch { /* not ESM / no meta.url */ }
  return candidates[0]!;
}

function parseFrontmatter(raw: string): { description: string; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) return { description: '', body: raw };
  const fm = m[1] ?? '';
  const body = m[2] ?? '';
  // Extract description from YAML frontmatter (first `description:` line)
  const descMatch = /^description:\s*(.+?)\s*$/m.exec(fm);
  const description = descMatch?.[1]?.trim() ?? '';
  return { description, body };
}
