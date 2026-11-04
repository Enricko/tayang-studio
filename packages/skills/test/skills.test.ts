import { describe, expect, it } from 'vitest';
import type { Project, Settings, SystemInfo } from '@tayang/shared';
import {
  BUILTIN_STYLES,
  FRAME_CHECK_PROMPT,
  buildInstallPrompt,
  buildProjectBrief,
  buildStudyStylePrompt,
  buildTopicIdeasPrompt,
  installCommands,
  NODE_DOWNLOAD_URL,
  needsSudo,
  parseStyleResult,
  parseTopicIdeas,
} from '../src/index';

const mac: SystemInfo = { os: 'macos', osVersion: '26', packageManager: 'brew' };
const win: SystemInfo = { os: 'windows', osVersion: '11', packageManager: 'winget' };
const apt: SystemInfo = { os: 'linux', osVersion: '24.04', packageManager: 'apt' };

describe('install', () => {
  it('ffmpeg on mac', () => {
    const p = buildInstallPrompt('ffmpeg', mac, 'claude');
    expect(p).toContain('brew install ffmpeg');
    expect(p).toContain('ffmpeg -version');
    expect(p).toContain('reply with only the version you see');
  });
  it('ffmpeg on windows and linux', () => {
    expect(buildInstallPrompt('ffmpeg', win, 'claude')).toContain('winget install --id Gyan.FFmpeg -e');
    // Linux: a static build in ~/.local/bin, no sudo.
    const cmds = installCommands('ffmpeg', apt, 'claude');
    expect(cmds.join('\n')).toContain('~/.local/bin');
    expect(cmds.some((c) => c.includes('sudo'))).toBe(false);
    const p = buildInstallPrompt('ffmpeg', apt, 'claude');
    expect(p).toContain('without sudo');
    expect(p).toContain('ffprobe');
  });
  it('a Mac without Homebrew installs standalone binaries into ~/.local/bin', () => {
    const bare: SystemInfo = { os: 'macos', osVersion: '15', packageManager: null };
    for (const tool of ['ffmpeg', 'ytdlp'] as const) {
      const cmds = installCommands(tool, bare, 'claude');
      expect(cmds.join('\n')).toContain('~/.local/bin');
      expect(cmds.some((c) => c.includes('brew') || c.includes('sudo'))).toBe(false);
      expect(buildInstallPrompt(tool, bare, 'claude')).toContain('This Mac has no Homebrew');
    }
    expect(installCommands('ytdlp', bare, 'claude')).toContain(
      'curl -L -o ~/.local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos',
    );
    expect(installCommands('elevenlabs-mcp', bare, 'claude')[0]).toBe('curl -LsSf https://astral.sh/uv/install.sh | sh');
  });
  it('linux sudo installs are handed to the user', () => {
    expect(needsSudo('chrome', apt)).toBe(true);
    expect(needsSudo('ffmpeg', apt)).toBe(false);
    expect(installCommands('ytdlp', apt, 'claude')).toEqual(['pipx install yt-dlp']);
    const p = buildInstallPrompt('chrome', apt, 'claude');
    expect(p).toContain('Do not run sudo yourself');
    expect(p).toContain('Ask the user to run this command in their own terminal');
    expect(p).toContain('sudo apt install -y chromium');
  });
  it('other tools', () => {
    expect(installCommands('ytdlp', mac, 'claude')).toEqual(['brew install yt-dlp']);
    expect(installCommands('node', mac, 'claude')).toEqual(['brew install node@22']);
    expect(installCommands('chrome', win, 'claude')).toEqual(['winget install --id Google.Chrome -e']);
    expect(installCommands('chrome', apt, 'claude')).toEqual(['sudo apt install -y chromium']);
    expect(NODE_DOWNLOAD_URL).toBe('https://nodejs.org/en/download');
  });
  it('elevenlabs', () => {
    expect(installCommands('elevenlabs-mcp', mac, 'claude')).toEqual([
      'brew install uv',
      'claude mcp add -s user elevenlabs -e ELEVENLABS_API_KEY=sk_•••• -- uvx elevenlabs-mcp',
    ]);
    const p = buildInstallPrompt('elevenlabs-mcp', mac, 'claude', { elevenLabsKey: 'sk_real' });
    expect(p).toContain('ELEVENLABS_API_KEY=sk_real');
    // User scope, so the server works in every project folder, not just the setup folder.
    expect(p).toContain('claude mcp add -s user elevenlabs');
    const o = buildInstallPrompt('elevenlabs-mcp', mac, 'codex', { elevenLabsKey: 'sk_real' });
    expect(o).toContain('uvx elevenlabs-mcp');
    expect(o).toContain('sk_real');
    expect(o).toContain('user-level');
  });
});

describe('topics', () => {
  it('parses a json block', () => {
    const t = 'Here:\n```json\n[{"title":"A","kind":"promo","lengthSec":30},{"title":"B","kind":"quote","lengthSec":15},{"title":"C","kind":"news","lengthSec":45}]\n```';
    expect(parseTopicIdeas(t)).toHaveLength(3);
    expect(parseTopicIdeas('nothing')).toEqual([]);
    expect(parseTopicIdeas('```json\n{bad\n```')).toEqual([]);
  });
  it('prompt asks for 3', () => {
    const p = buildTopicIdeasPrompt(['promo'], 'id');
    expect(p).toContain('```json');
    expect(p).toContain('exactly 3');
  });
});

describe('style', () => {
  it('parseStyleResult', () => {
    const ok = JSON.stringify({ name: 'X', notes: { camera: 'c' }, prompt: 'p' });
    expect(parseStyleResult(ok, 'https://x')).toMatchObject({ source: 'copied', sourceUrl: 'https://x', name: 'X' });
    expect(parseStyleResult(JSON.stringify({ name: 'X', notes: {} }), 'u')).toBeNull();
    expect(parseStyleResult('nope', 'u')).toBeNull();
  });
  it('study prompt', () => {
    const p = buildStudyStylePrompt('https://v', '/out');
    expect(p).toContain('yt-dlp');
    expect(p).toContain('/out/style.json');
  });
  it('builtins', () => {
    expect(BUILTIN_STYLES.length).toBe(3);
    expect(BUILTIN_STYLES[0]!.id).toBe('builtin-bold-explainer');
  });
});

describe('brief', () => {
  it('contains style prompt and Frames checked', () => {
    const project = { title: 'Promo', kind: 'promo', format: '9:16', language: 'id' } as Project;
    const settings = { fps: 30, frameCheck: true } as Settings;
    const b = buildProjectBrief(project, BUILTIN_STYLES[0]!, settings);
    expect(b).toContain(BUILTIN_STYLES[0]!.prompt);
    expect(b).toContain('Frames checked');
    expect(b).toContain(FRAME_CHECK_PROMPT);
    expect(b).toContain('npx hyperframes');
    expect(b).toContain(
      'When a version is ready, render it with `npx -y hyperframes@0.9.10 render --output renders/promo-<n>.mp4` so Tayang can show it.',
    );
    expect(FRAME_CHECK_PROMPT).toContain('Frames checked');
  });
  it('leaves out the frame check when it is off', () => {
    const project = { title: 'Promo', kind: 'promo', format: '9:16', language: 'id' } as Project;
    const b = buildProjectBrief(project, null, { fps: 30, frameCheck: false });
    expect(b).not.toContain(FRAME_CHECK_PROMPT);
    expect(b).not.toContain('Quality loop');
    expect(b).toContain('npx hyperframes');
  });
});
