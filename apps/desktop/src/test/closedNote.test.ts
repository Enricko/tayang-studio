import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLOSED_NOTE } from '@/lib/agents';

describe('closed-app note', () => {
  it('matches the note Rust writes on stale jobs', () => {
    const rust = readFileSync(resolve(__dirname, '../../src-tauri/src/lib.rs'), 'utf8');
    expect(rust).toContain(`"${CLOSED_NOTE}"`);
  });
});
