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
/** Language of Tayang's own interface (not of the videos). */
export type UiLanguage = 'en' | 'id';
export type ProjectStatus = 'draft' | 'building' | 'rendered' | 'scheduled';

/** Whether a finished video still waits for the user's approval. */
export type ReviewState = 'none' | 'pending' | 'approved';

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
  reviewState: ReviewState;
  /** When the user marked the video as posted (RFC 3339). */
  postedAt: string | null;
  /** When the post-time reminder was shown (RFC 3339); cleared when the schedule changes. */
  remindedAt: string | null;
  /** When the "review before it's due" reminder was shown (RFC 3339); cleared when the schedule changes. */
  reviewRemindedAt: string | null;
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

/** What an agent says a tool call is (ACP tool kinds). */
export type ToolKind =
  | 'read'
  | 'edit'
  | 'delete'
  | 'move'
  | 'search'
  | 'execute'
  | 'think'
  | 'fetch'
  | 'switch_mode'
  | 'other';

export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'mention'; projectId: string; title: string }
  | {
      type: 'file';
      path: string;
      name: string;
      mime: string;
      size: number;
      /** When the file was last written (an image the agent made): a rewritten one reloads. */
      modifiedAt?: string;
    }
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
      toolKind?: ToolKind;
      /** The first file the tool touches. */
      path?: string;
    }
  | { type: 'thought'; text: string }
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
  /** A short silent clip of the style, played in the style popup; null when there is none. */
  previewVideoUrl?: string | null;
  template?: StyleTemplate | null;
  version?: number;
  /** Id of the built-in style this one was cloned from (its template is downloaded under that id). */
  basedOn?: string | null;
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
  /** The link a style study was reading, so a failed study can be tried again. */
  sourceUrl: string | null;
  updatedAt: string;
  /**
   * A build job: when the first turn since it was last done started (RFC 3339). A render made after it
   * is this job's video. Missing on other jobs, done ones, and jobs saved before it existed.
   */
  renderBaselineAt?: string | null;
}

/** A file on disk as the UI needs it: a render, or an image the agent made. */
export interface FileInfo {
  path: string;
  name: string;
  size: number;
  /** RFC 3339 UTC with milliseconds. */
  modifiedAt: string;
}

export interface Settings {
  workingFolder: string;
  defaultAgent: AgentId;
  frameCheck: boolean;
  language: VideoLanguage;
  format: VideoFormat;
  fps: number;
  onboarded: boolean;
  /** Base URL of the optional Tayang API. Settings saves an empty field as the default URL. */
  apiUrl: string;
  /** Random uuid v4 made on first run (empty until then); never derived from the machine. */
  installId: string;
  /** Sends the anonymous daily install ping. */
  shareInstallStats: boolean;
  /** RFC 3339 time of the last successful ping. */
  lastPingAt: string | null;
  /** Chats start in auto mode: the agent runs commands without asking. Style studies always do. */
  autoMode: boolean;
  /** Interface language; null until the first run picks one from the system language. */
  uiLanguage: UiLanguage | null;
  /** Closing the window hides it to the tray (menu bar) instead of quitting. */
  backgroundMode: boolean;
  /** Start Tayang at login; only available while backgroundMode is on. */
  openAtLogin: boolean;
}

/** Defaults; workingFolder is `<home>/Tayang`, resolved at runtime. */
export const DEFAULT_SETTINGS: Omit<Settings, 'workingFolder'> = {
  defaultAgent: 'claude',
  frameCheck: true,
  language: 'id',
  format: '9:16',
  fps: 30,
  onboarded: false,
  apiUrl: 'https://studio.tayang.app/api',
  installId: '',
  shareInstallStats: true,
  lastPingAt: null,
  autoMode: false,
  uiLanguage: null,
  backgroundMode: false,
  openAtLogin: false,
};

export type AgentUpdate =
  | { kind: 'text'; text: string }
  | { kind: 'thought'; text: string }
  | {
      kind: 'tool';
      toolCallId: string;
      title: string;
      status: 'pending' | 'running' | 'done' | 'failed';
      toolKind?: ToolKind;
      path?: string;
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

// ---- autopilot ----

/** How often an autopilot makes a video. Times are "HH:MM" in local time; days are 0 (Sunday) to 6 (Saturday). */
export type AutopilotFrequency =
  | { kind: 'daily'; times: string[] }
  | { kind: 'weekly'; days: number[]; time: string };

export interface Autopilot {
  id: string;
  name: string;
  niche: string;
  language: VideoLanguage;
  styleId: string;
  agentId: AgentId;
  frequency: AutopilotFrequency;
  lengthSec: number;
  /** Finished videos wait for Approve (reviewState 'pending') instead of going straight to Ready. */
  review: boolean;
  /** Only manual for now: a reminder at post time. */
  posting: 'manual';
  status: 'active' | 'paused';
  createdAt: string;
  updatedAt: string;
}

/** What the UI sends to create (no id) or edit (with id) an autopilot; the status is kept on edit, active when new. */
export type AutopilotInput = Omit<Autopilot, 'id' | 'status' | 'createdAt' | 'updatedAt'> & { id?: string };

export type SlotStatus = 'planned' | 'making' | 'done' | 'failed' | 'skipped';

/** One video an autopilot is due to make; unique per (autopilotId, dueAt). */
export interface AutopilotSlot {
  id: string;
  autopilotId: string;
  /** RFC 3339, stored in UTC. */
  dueAt: string;
  status: SlotStatus;
  projectId: string | null;
  error: string | null;
}

/** The fields `update_slot` may change. */
export type SlotPatch = Partial<Pick<AutopilotSlot, 'status' | 'projectId' | 'error'>>;
