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
  | { type: 'file'; path: string; name: string; mime: string; size: number }
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
    }
  | { type: 'a2ui'; surfaceId: string; messages: unknown[] }
  | { type: 'a2ui-action'; summary: string; action: object };

export interface ChatMessage {
  id: string;
  chatId: string;
  role: 'user' | 'agent' | 'system';
  parts: MessagePart[];
  createdAt: string;
}

export type StyleAspect = 'camera' | 'pacing' | 'type' | 'color' | 'captions' | 'transitions';

export type StyleEngine = 'hyperframes' | 'remotion';

/** A built-in style's starter project, served by the API as a zip. */
export interface StyleTemplate {
  sha256: string;
  size: number;
  version: number;
}

export interface Style {
  id: string;
  name: string;
  source: 'builtin' | 'copied' | 'mine';
  sourceUrl: string | null;
  notes: Partial<Record<StyleAspect, string>>;
  prompt: string;
  createdAt: string;
  engine?: StyleEngine;
  previewUrl?: string | null;
  template?: StyleTemplate | null;
  version?: number;
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
  /** Base URL of the optional Tayang API; empty turns every online feature off. */
  apiUrl: string;
  /** Random uuid v4 made on first run (empty until then); never derived from the machine. */
  installId: string;
  /** Sends the anonymous daily install ping. */
  shareInstallStats: boolean;
  /** RFC 3339 time of the last successful ping. */
  lastPingAt: string | null;
}

/** Defaults; workingFolder is `<home>/Tayang`, resolved at runtime. */
export const DEFAULT_SETTINGS: Omit<Settings, 'workingFolder'> = {
  defaultAgent: 'claude',
  frameCheck: true,
  language: 'id',
  format: '9:16',
  fps: 30,
  onboarded: false,
  apiUrl: 'https://api.tayang.app',
  installId: '',
  shareInstallStats: true,
  lastPingAt: null,
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

export interface UsageWindow {
  usedPercent: number;
  resetsAt: string | null;
}

export type UsageStatus = 'ok' | 'signed-out' | 'unavailable' | 'error';

export interface AgentUsage {
  agentId: AgentId;
  status: UsageStatus;
  /** The 5 hour window. */
  session: UsageWindow | null;
  weekly: UsageWindow | null;
  /** A model-scoped weekly limit, such as Fable. */
  modelWeekly: { label: string; window: UsageWindow } | null;
  updatedAt: string;
  message: string | null;
}
