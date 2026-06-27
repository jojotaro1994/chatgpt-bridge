import { FakeAdapter, ClaudeCliAdapter, ClaudeAgentSdkAdapter } from '@e2e-bridge/sdk-adapter';
import type { ClaudeSessionAdapter } from '@e2e-bridge/sdk-adapter';
import { logger } from './logger.js';

/**
 * Pick the Claude adapter based on env. Default order: SDK → CLI → Fake.
 *
 *   RUNNER_ADAPTER=sdk       → ClaudeAgentSdkAdapter (needs ANTHROPIC_API_KEY)
 *   RUNNER_ADAPTER=cli       → ClaudeCliAdapter (needs `claude` CLI in PATH)
 *   RUNNER_ADAPTER=fake      → FakeAdapter (always works)
 *   RUNNER_ADAPTER unset     → SDK if ANTHROPIC_API_KEY present, else Fake
 */
export function buildAdapter(): ClaudeSessionAdapter {
  const explicit = process.env.RUNNER_ADAPTER?.toLowerCase();

  if (explicit === 'fake') {
    logger.info('adapter: FakeAdapter (explicit)');
    return new FakeAdapter({ tickMs: 60, chunkSize: 8 });
  }
  if (explicit === 'cli') {
    logger.info('adapter: ClaudeCliAdapter (explicit)');
    return new ClaudeCliAdapter();
  }
  if (explicit === 'sdk') {
    logger.info('adapter: ClaudeAgentSdkAdapter (explicit)');
    return new ClaudeAgentSdkAdapter({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.CLAUDE_MODEL,
      defaultCwd: process.env.RUNNER_DEFAULT_CWD,
      skillsDir: process.env.RUNNER_SKILLS_DIR,
      effort: process.env.CLAUDE_EFFORT as 'low' | 'medium' | 'high' | 'xhigh' | 'max' | undefined,
    });
  }

  // Auto: SDK if key present, else Fake
  if (process.env.ANTHROPIC_API_KEY) {
    logger.info('adapter: ClaudeAgentSdkAdapter (auto, key present)');
    return new ClaudeAgentSdkAdapter({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.CLAUDE_MODEL,
      defaultCwd: process.env.RUNNER_DEFAULT_CWD,
      skillsDir: process.env.RUNNER_SKILLS_DIR,
      effort: process.env.CLAUDE_EFFORT as 'low' | 'medium' | 'high' | 'xhigh' | 'max' | undefined,
    });
  }

  logger.warn('adapter: FakeAdapter (no ANTHROPIC_API_KEY, no RUNNER_ADAPTER override)');
  return new FakeAdapter({ tickMs: 60, chunkSize: 8 });
}
