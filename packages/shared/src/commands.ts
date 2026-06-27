import { Command } from './schemas.js';

/**
 * Slash command names recognized by server/runner.
 * Anything outside this list is treated as plain text.
 */
export const KNOWN_COMMANDS = [
  'help',
  'new',
  'sessions',
  'status',
  'stop',
  'kill',
  'skills',
  'skill',
  'browser',
  'screenshot',
  'trace',
  'review',
  'test',
  'clear',
] as const;

export type KnownCommandName = (typeof KNOWN_COMMANDS)[number];

/**
 * Parse a free-form slash string from the client into a structured Command.
 * Returns null when the input doesn't start with '/' or the command is unknown.
 *
 *   "/new ~/repo/foo"          → { name: 'new', repo_path: '~/repo/foo' }
 *   "/skill browser-webbridge-testing" → { name: 'skill', skill: 'browser-webbridge-testing' }
 *   "/help"                    → { name: 'help' }
 *   "hello"                    → null
 */
export function parseSlashCommand(input: string): Command | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;
  const body = trimmed.slice(1);
  if (!body) return null;
  const parts = body.split(/\s+/);
  const name = parts[0];
  if (!name) return null;

  switch (name) {
    case 'help':
      return { name: 'help' };

    case 'new': {
      const repo = parts[1];
      if (!repo) return null;
      return { name: 'new', repo_path: repo };
    }

    case 'sessions':
      return { name: 'sessions' };

    case 'status':
      return { name: 'status' };

    case 'stop':
      return { name: 'stop' };

    case 'kill':
      return { name: 'kill' };

    case 'skills':
      return { name: 'skills' };

    case 'skill': {
      const skill = parts[1];
      if (!skill) return null;
      return { name: 'skill', skill };
    }

    case 'browser': {
      const action = parts[1];
      if (!action) return null;
      // BrowserAction enum validation happens at Command.parse() time.
      return {
        name: 'browser',
        action: action as Command extends { name: 'browser'; action: infer A }
          ? A
          : never,
        target: parts[2],
      };
    }

    case 'screenshot':
      return { name: 'screenshot' };

    case 'trace':
      return { name: 'trace' };

    case 'review': {
      const target = parts.slice(1).join(' ');
      if (!target) return null;
      return { name: 'review', target };
    }

    case 'test': {
      const goal = parts.slice(1).join(' ');
      if (!goal) return null;
      return { name: 'test', goal };
    }

    case 'clear':
      return { name: 'clear' };

    default:
      return null;
  }
}

/** Test helper: does the string look like any known slash command? */
export function looksLikeSlashCommand(input: string): boolean {
  const m = input.trim().match(/^\/(\w+)/);
  if (!m) return false;
  const name = m[1];
  return (KNOWN_COMMANDS as readonly string[]).includes(name ?? '');
}
