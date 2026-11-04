import type { AgentId, SystemInfo, ToolId } from '@tayang/shared';

const KEY_MASK = 'sk_••••';

function pmInstall(sys: SystemInfo, pkg: string): string {
  switch (sys.packageManager) {
    case 'brew':
      return `brew install ${pkg}`;
    case 'winget':
      return `winget install ${pkg}`;
    case 'dnf':
      return `sudo dnf install -y ${pkg}`;
    case 'pacman':
      return `sudo pacman -S --noconfirm ${pkg}`;
    default:
      return `sudo apt install -y ${pkg}`;
  }
}

function elevenLabsCommands(sys: SystemInfo, agent: AgentId, key: string): string[] {
  const uv = sys.os === 'macos' ? 'brew install uv' : sys.os === 'windows' ? 'winget install --id astral-sh.uv -e' : 'pipx install uv';
  const cmds = [uv];
  if (agent === 'claude') {
    cmds.push(`claude mcp add -s user elevenlabs -e ELEVENLABS_API_KEY=${key} -- uvx elevenlabs-mcp`);
  }
  return cmds;
}

export function installCommands(tool: ToolId, sys: SystemInfo, agent: AgentId): string[] {
  return commandsFor(tool, sys, agent, KEY_MASK);
}

function commandsFor(tool: ToolId, sys: SystemInfo, agent: AgentId, key: string): string[] {
  const pm = sys.packageManager;
  switch (tool) {
    case 'ffmpeg':
      if (pm === 'brew') return ['brew install ffmpeg'];
      if (pm === 'winget') return ['winget install --id Gyan.FFmpeg -e'];
      return [pmInstall(sys, 'ffmpeg')];
    case 'ytdlp':
      if (pm === 'brew') return ['brew install yt-dlp'];
      if (pm === 'winget') return ['winget install --id yt-dlp.yt-dlp -e'];
      return ['pipx install yt-dlp'];
    case 'node':
      if (pm === 'brew') return ['brew install node@22'];
      if (pm === 'winget') return ['winget install --id OpenJS.NodeJS.LTS -e'];
      return [pmInstall(sys, 'nodejs')];
    case 'chrome':
      if (pm === 'brew') return ['brew install --cask google-chrome'];
      if (pm === 'winget') return ['winget install --id Google.Chrome -e'];
      return [pmInstall(sys, 'chromium')];
    case 'elevenlabs-mcp':
      return elevenLabsCommands(sys, agent, key);
    default:
      return [];
  }
}

const VERIFY: Record<ToolId, string> = {
  ffmpeg: '`ffmpeg -version`',
  ytdlp: '`yt-dlp --version`',
  node: '`node --version`',
  chrome: 'the path where Chrome or Chromium is installed',
  'elevenlabs-mcp': 'your MCP server list',
};

const NAMES: Record<ToolId, string> = {
  ffmpeg: 'ffmpeg',
  ytdlp: 'yt-dlp',
  node: 'Node.js 22 or newer',
  chrome: 'Google Chrome (or Chromium on Linux)',
  'elevenlabs-mcp': 'the ElevenLabs MCP server',
};

export function buildInstallPrompt(
  tool: ToolId,
  sys: SystemInfo,
  agent: AgentId,
  opts?: { elevenLabsKey?: string },
): string {
  const lines: string[] = [];
  lines.push(`Please install ${NAMES[tool]} on this computer (${sys.os} ${sys.osVersion}).`);
  if (tool === 'elevenlabs-mcp') {
    const key = opts?.elevenLabsKey ?? '<ELEVENLABS_API_KEY>';
    if (agent === 'claude') {
      lines.push('Install `uv` first if it is missing, then register the MCP server. Run:');
      lines.push(...commandsFor(tool, sys, agent, key).map((c) => `  ${c}`));
    } else {
      lines.push('Install `uv` first if it is missing:');
      lines.push(`  ${commandsFor(tool, sys, agent, key)[0]}`);
      lines.push(
        `Then add an MCP server named \`elevenlabs\` that runs \`uvx elevenlabs-mcp\` with the environment variable \`ELEVENLABS_API_KEY=${key}\`, in your user-level (global) MCP configuration so it works in every folder.`,
      );
    }
  } else if (tool === 'chrome' && sys.os === 'linux') {
    lines.push(`Install \`chromium\` with the package manager. Run:`);
    lines.push(...commandsFor(tool, sys, agent, '').map((c) => `  ${c}`));
  } else {
    lines.push('Run:');
    lines.push(...commandsFor(tool, sys, agent, '').map((c) => `  ${c}`));
  }
  lines.push(`Then verify with ${VERIFY[tool]} and reply with only the version you see.`);
  return lines.join('\n');
}
