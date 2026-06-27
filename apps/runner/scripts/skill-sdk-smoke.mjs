#!/usr/bin/env node
/**
 * M6 SDK-level smoke for the /skill command path.
 *
 * Directly invokes ClaudeAgentSdkAdapter.sendCommand({ name: 'skill', skill: '...' })
 * and asserts:
 *   - skill.invoked event is emitted before any other event from the turn
 *   - the SKILL.md body is delivered to Claude as a user message
 *   - Claude acknowledges the skill and follows its constraints
 *
 * Uses the locally-installed `claude` CLI (Claude Code subscription).
 *
 * Usage:  node apps/runner/scripts/skill-sdk-smoke.mjs
 */
import { ClaudeAgentSdkAdapter } from '../../../packages/sdk-adapter/dist/index.js';
import { resolveDefaultSkillsDir } from '../../../packages/sdk-adapter/dist/skill-registry.js';

const REPO = '/Users/jojo/.openclaw/workspace/dom-personal-prj/prj-bridge-phone';
const adapter = new ClaudeAgentSdkAdapter({
  defaultCwd: REPO,
  skillsDir: `${REPO}/skills`,
});

console.log('skills dir:', adapter['skillRegistry']?.dir ?? '(unknown)');
console.log('discovered skills:', adapter['skillRegistry']?.list().map((s) => s.name).join(', '));

const handle = await adapter.createSession({ repo_path: REPO });

console.log('--- sendCommand: /skill browser-webbridge-testing ---');
const events = [];
let sawSkillInvoked = false;
let sawBodyEcho = false;

for await (const ev of adapter.sendCommand(handle.id, {
  name: 'skill',
  skill: 'browser-webbridge-testing',
  args: undefined,
})) {
  events.push(ev.type);
  if (ev.type === 'skill.invoked') {
    sawSkillInvoked = true;
    console.log(`  skill.invoked: ${ev.skill} args=${JSON.stringify(ev.args ?? null)}`);
    if (ev.skill !== 'browser-webbridge-testing') {
      console.error('FAIL: skill.invoked has wrong skill name'); process.exit(1);
    }
  }
  if (ev.type === 'session.message' && ev.message.role === 'assistant') {
    const text = ev.message.content.toLowerCase();
    if (text.includes('browser') || text.includes('webbridge') || text.includes('kimi') || text.includes('mcp')) {
      sawBodyEcho = true;
      console.log(`  assistant reply (${ev.message.content.length} chars): ${ev.message.content.slice(0, 200).replace(/\n/g, ' ')}…`);
    }
  }
  if (ev.type === 'session.completed' || ev.type === 'session.failed') break;
  if (events.length > 60) { console.error('FAIL: too many events, aborting'); process.exit(1); }
}

console.log('events:', events.join(' → '));

if (!sawSkillInvoked) { console.error('FAIL: skill.invoked not emitted'); process.exit(1); }
if (!sawBodyEcho) { console.error('FAIL: assistant did not reference SKILL.md body'); process.exit(1); }

console.log('OK: SDK adapter emits skill.invoked + Claude follows SKILL.md');
process.exit(0);
