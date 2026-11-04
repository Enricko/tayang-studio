import type { AgentId, ToolId } from '@tayang/shared';
import claude from '@/assets/brand/claude.svg';
import gemini from '@/assets/brand/googlegemini.svg';
import openai from '@/assets/brand/openai.svg';
import opencode from '@/assets/brand/opencode.svg';
import node from '@/assets/brand/nodedotjs.svg';
import ffmpeg from '@/assets/brand/ffmpeg.svg';
import elevenlabs from '@/assets/brand/elevenlabs.svg';
import chrome from '@/assets/brand/googlechrome.svg';

const SRC: Partial<Record<AgentId | ToolId, string>> = {
  claude,
  gemini,
  codex: openai,
  opencode,
  node,
  ffmpeg,
  'elevenlabs-mcp': elevenlabs,
  chrome,
};

export function AgentLogo({ id, size = 24 }: { id: AgentId | ToolId; size?: number }) {
  const src = SRC[id];
  if (!src) {
    return (
      <span
        aria-hidden="true"
        className="inline-flex items-center justify-center rounded-md bg-raised font-mono text-xs text-text-2"
        style={{ width: size, height: size }}
      >
        {id.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return <img src={src} alt="" aria-hidden="true" width={size} height={size} style={{ width: size, height: size }} />;
}
