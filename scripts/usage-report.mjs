#!/usr/bin/env node
// Where the agents' tokens go: totals of Tayang's per-turn usage log (agent-usage.jsonl), by
// chat kind, agent and model, plus the most expensive chats.
//
//   node scripts/usage-report.mjs            # the dev build's log
//   node scripts/usage-report.mjs --release  # the installed app's log
//   node scripts/usage-report.mjs path/to/agent-usage.jsonl
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function dataDir(identifier) {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', identifier);
  if (process.platform === 'win32') return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), identifier);
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), identifier);
}

const arg = process.argv[2];
const file =
  arg && !arg.startsWith('--')
    ? arg
    : join(dataDir(arg === '--release' ? 'app.tayang.studio' : 'app.tayang.studio.dev'), 'agent-usage.jsonl');
if (!existsSync(file)) {
  console.error(`No usage log at ${file} yet. Run a few agent turns first.`);
  process.exit(1);
}

const lines = readFileSync(file, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));

const empty = () => ({ turns: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });
function add(t, l) {
  const u = l.usage ?? {};
  t.turns += 1;
  t.input += u.inputTokens ?? 0;
  t.output += u.outputTokens ?? 0;
  t.cacheRead += u.cachedReadTokens ?? 0;
  t.cacheWrite += u.cachedWriteTokens ?? 0;
  t.cost += l.cost?.amount ?? 0;
}
function group(key) {
  const out = new Map();
  for (const l of lines) {
    const k = key(l);
    if (!out.has(k)) out.set(k, empty());
    add(out.get(k), l);
  }
  return [...out.entries()].sort((a, b) => total(b[1]) - total(a[1]));
}
const total = (t) => t.input + t.output + t.cacheRead + t.cacheWrite;
const k = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));

function table(title, rows) {
  console.log(`\n${title}`);
  console.log(['', 'turns', 'input', 'output', 'cache read', 'cache write', 'per turn', 'cost'].map((h, i) => (i ? h.padStart(13) : h.padEnd(34))).join(''));
  for (const [name, t] of rows) {
    const cells = [t.turns, k(t.input), k(t.output), k(t.cacheRead), k(t.cacheWrite), k(Math.round(total(t) / t.turns)), t.cost ? `$${t.cost.toFixed(2)}` : '-'];
    console.log(String(name).slice(0, 33).padEnd(34) + cells.map((c) => String(c).padStart(13)).join(''));
  }
}

console.log(`${lines.length} turns in ${file}`);
table('By chat kind', group((l) => l.kind));
table('By agent and model', group((l) => `${l.agent} ${l.model ?? '(default)'}`));
table('Top chats', group((l) => `${l.kind} ${l.chat}`).slice(0, 10));
