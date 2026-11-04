export type AgentId = 'claude' | 'opencode' | 'gemini' | 'codex' | 'custom';

export interface AgentInfo {
  id: AgentId;
  name: string;
  installed: boolean;
  version: string | null;
  acpCommand: string[];
  recommended: boolean;
}

export type OsKind = 'macos' | 'windows' | 'linux';
export type PackageManager = 'brew' | 'winget' | 'apt' | 'dnf' | 'pacman';

export interface SystemInfo {
  os: OsKind;
  osVersion: string;
  packageManager: PackageManager | null;
}

export type ToolId = 'node' | 'ffmpeg' | 'chrome' | 'ytdlp' | 'elevenlabs-mcp';

export interface ToolStatus {
  id: ToolId;
  name: string;
  required: boolean;
  found: boolean;
  version: string | null;
  ok: boolean;
  detail: string;
}

export type VideoKind = 'explainer' | 'promo' | 'quote' | 'news' | 'tutorial' | 'data' | 'event';
export type VideoFormat = '9:16' | '1:1' | '16:9';
export type VideoLanguage = 'id' | 'en';
export type ProjectStatus = 'draft' | 'building' | 'rendered' | 'scheduled';

export interface Project {
  id: string;
  title: string;
  slug: string;
  folder: string;
  kind: VideoKind;
  format: VideoFormat;
  language: VideoLanguage;
  status: ProjectStatus;
  styleId: string | null;
  scheduledAt: string | null;
  durationSec: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewProject {
  title: string;
  kind: VideoKind;
  format: VideoFormat;
  language: VideoLanguage;
  styleId?: string | null;
}

export interface Chat {
  id: string;
  projectId: string | null;
  agentId: AgentId;
  title: string;
  createdAt: string;
}

/** Relative position, 0-1. */
export interface Mark {
  x: number;
  y: number;
}

export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'mention'; projectId: string; title: string }
  | {
      type: 'frame';
      projectId: string;
      frame: number;
      timeSec: number;
      imagePath: string;
      marks: Mark[];
    }
  | {
      type: 'tool';
      toolCallId: string;
      title: string;
      status: 'pending' | 'running' | 'done' | 'failed';
    };

export interface ChatMessage {
  id: string;
  chatId: string;
  role: 'user' | 'agent' | 'system';
  parts: MessagePart[];
  createdAt: string;
}

export type StyleAspect = 'camera' | 'pacing' | 'type' | 'color' | 'captions' | 'transitions';

export interface Style {
  id: string;
  name: string;
  source: 'builtin' | 'copied' | 'mine';
  sourceUrl: string | null;
  notes: Partial<Record<StyleAspect, string>>;
  prompt: string;
  createdAt: string;
}

export type JobKind = 'build' | 'render' | 'install' | 'study-style' | 'script';
export type JobStatus = 'queued' | 'working' | 'needs-you' | 'done' | 'failed';

export interface Job {
  id: string;
  kind: JobKind;
  title: string;
  projectId: string | null;
  chatId: string | null;
  agentId: AgentId;
  status: JobStatus;
  progress: number | null;
  note: string | null;
  updatedAt: string;
}

export interface Settings {
  workingFolder: string;
  defaultAgent: AgentId;
  frameCheck: boolean;
  language: VideoLanguage;
  format: VideoFormat;
  fps: number;
  onboarded: boolean;
}

/** Defaults; workingFolder is `<home>/Tayang`, resolved at runtime. */
export const DEFAULT_SETTINGS: Omit<Settings, 'workingFolder'> = {
  defaultAgent: 'claude',
  frameCheck: true,
  language: 'id',
  format: '9:16',
  fps: 30,
  onboarded: false,
};

export type AgentUpdate =
  | { kind: 'text'; text: string }
  | { kind: 'thought'; text: string }
  | {
      kind: 'tool';
      toolCallId: string;
      title: string;
      status: 'pending' | 'running' | 'done' | 'failed';
    }
  | { kind: 'done'; stopReason: string }
  | { kind: 'error'; message: string };

export interface PermissionRequest {
  chatId: string;
  requestId: string;
  title: string;
  commands: string[];
  options: {
    id: string;
    label: string;
    kind: 'allow-once' | 'allow-always' | 'reject-once' | 'reject-always';
  }[];
}

export interface MediaInfo {
  durationSec: number;
  fps: number;
  frames: number;
  width: number;
  height: number;
}
