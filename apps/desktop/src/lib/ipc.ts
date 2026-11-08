// Browser implementation of the backend contract. Mirrors `ipc.desktop.ts` (Tauri commands) with
// authenticated HTTP calls to the headless server, so screens and state logic are unchanged.

import type {
  AgentId,
  AgentInfo,
  AgentQuestion,
  AgentUsage,
  Autopilot,
  AutopilotInput,
  AutopilotSlot,
  Chat,
  ChatMessage,
  FileInfo,
  Job,
  MediaInfo,
  MessagePart,
  ModelChoice,
  NewProject,
  PermissionRequest,
  Project,
  ProjectStatus,
  QuestionResponse,
  RecentChat,
  Settings,
  SlotPatch,
  Style,
  SystemInfo,
  ToolStatus,
} from '@tayang/shared';
import { assetUrl, rpc, uploadFile } from './webRpc';
import type { TtsPreview, TtsStatus, TtsVoice, TtsVoiceList } from './tts';

export { assetUrl };

// ---- system and settings ----
export const getSystemInfo = () => rpc<SystemInfo>('get_system_info');
export const detectAgents = () => rpc<AgentInfo[]>('detect_agents');
export const checkTools = (agent: AgentId) => rpc<ToolStatus[]>('check_tools', { agent });
export const getSettings = () => rpc<Settings>('get_settings');
/** TAYANG_API_URL overrides are a desktop convenience; the server reads its own environment. */
export const apiUrlOverride = async (): Promise<string | null> => null;
export const updateSettings = (patch: Partial<Settings>) => rpc<Settings>('update_settings', { patch });
export const systemLocale = () => rpc<string | null>('system_locale');
export const pickFolder = () => rpc<string | null>('pick_folder');

// ---- usage ----
export const getAgentUsage = (force: boolean) => rpc<AgentUsage[]>('get_agent_usage', { force });

// ---- local voice ----
export const listVoices = () => rpc<TtsVoiceList>('tts_voices');
export const setDefaultVoice = (engine: string, voice: string) =>
  rpc<{ engine: string; voice: string }>('tts_set_default', { engine, voice });
export const deleteVoice = (voice: string) => rpc<{ ok: boolean }>('tts_delete_voice', { voice });
export const uploadVoice = async (file: File): Promise<TtsVoice> => {
  const form = new FormData();
  form.append('file', file, file.name);
  return uploadFile<TtsVoice>('/api/voices/upload', form);
};
export const ttsStatus = () => rpc<TtsStatus>('tts_status');
export const ttsPrepare = (engine: string) => rpc<{ ok: boolean; engine: string; seconds: number }>('tts_prepare', { engine });
export const ttsPreview = (engine: string, voice?: string | null, language?: string) =>
  rpc<TtsPreview>('tts_preview', { engine, voice: voice ?? null, language: language ?? null });

// ---- projects ----
export const listProjects = () => rpc<Project[]>('list_projects');
export const createProject = (input: NewProject, brief: string) => rpc<Project>('create_project', { input, brief });
export const updateProject = (id: string, patch: Partial<Project>) => rpc<Project>('update_project', { id, patch });
export const setProjectStatus = (projectId: string, status: ProjectStatus, reset = false) =>
  rpc<Project>('set_project_status', { projectId, status, reset });
export const setSchedule = (projectId: string, at: string | null) => rpc<Project>('set_schedule', { projectId, at });
export type BatchItem = { projectId: string; at: string } | { at: string; draft: { input: NewProject; brief: string } };
export const scheduleVideos = (items: BatchItem[]) => rpc<Project[]>('schedule_videos', { items });
export const setPosted = (projectId: string, posted: boolean) => rpc<Project>('set_posted', { projectId, posted });
export const approveProject = (projectId: string) => rpc<Project>('approve_project', { projectId });

// ---- autopilots ----
export const listAutopilots = () => rpc<Autopilot[]>('list_autopilots');
export const saveAutopilot = (input: AutopilotInput) => rpc<Autopilot>('save_autopilot', { input });
export const deleteAutopilot = (id: string) => rpc<void>('delete_autopilot', { id });
export const setAutopilotStatus = (id: string, status: Autopilot['status']) =>
  rpc<Autopilot>('set_autopilot_status', { id, status });
export const listSlots = (from: string, to: string) => rpc<AutopilotSlot[]>('list_slots', { from, to });
export const upsertSlot = (autopilotId: string, dueAt: string) => rpc<AutopilotSlot>('upsert_slot', { autopilotId, dueAt });
export const updateSlot = (id: string, patch: SlotPatch) => rpc<AutopilotSlot>('update_slot', { id, patch });
/** Stops a slot the server is making now. */
export const stopAutopilotSlot = (slotId: string) => rpc<void>('stop_autopilot_slot', { slotId });

// ---- chats ----
export const listChats = (projectId?: string) => rpc<Chat[]>('list_chats', { projectId: projectId ?? null });
export const listRecentChats = (limit?: number) => rpc<RecentChat[]>('list_recent_chats', { limit: limit ?? null });
export const listArchivedChats = () => rpc<RecentChat[]>('list_archived_chats');
export const setThreadArchived = (chatId: string, archived: boolean) => rpc<void>('set_thread_archived', { chatId, archived });
export const purgeArchive = () => rpc<{ chats: number; cards: number }>('purge_archive');
export const getChat = (chatId: string) => rpc<Chat | null>('get_chat', { chatId });
export const createChat = (projectId: string | null, agentId: AgentId, title: string) =>
  rpc<Chat>('create_chat', { projectId, agentId, title });
export const updateChatAgent = (chatId: string, agentId: AgentId) => rpc<Chat>('update_chat_agent', { chatId, agentId });
export const listMessages = (chatId: string) => rpc<ChatMessage[]>('list_messages', { chatId });
export const addMessage = (chatId: string, role: ChatMessage['role'], parts: MessagePart[]) =>
  rpc<ChatMessage>('add_message', { chatId, role, parts });

/** The in-flight turn and pending cards, used after a reconnect or when a second tab opens. */
export interface ChatLive {
  streaming: boolean;
  /** Whether an agent process is alive (idle or working) for this chat. */
  sessionRunning: boolean;
  turnStartedAt: string;
  message: ChatMessage | null;
  permissions: PermissionRequest[];
  questions: AgentQuestion[];
}
export const chatLive = (chatId: string) => rpc<ChatLive>('chat_live', { chatId });

// ---- styles ----
export const listStyles = () => rpc<Style[]>('list_styles');
export interface StylesSync {
  styles: Style[];
  offline: boolean;
}
export const syncStyles = () => rpc<StylesSync>('sync_styles');
export const installStyleTemplate = (projectId: string) => rpc<{ installed: boolean }>('install_style_template', { projectId });
export const saveStyle = (style: Style) => rpc<void>('save_style', { style });
export const deleteStyle = (id: string) => rpc<void>('delete_style', { id });
export const readStyleResult = (studyId: string) => rpc<string | null>('read_style_result', { studyId });
export const studyDir = (studyId: string) => rpc<string>('study_dir', { studyId });
export const removeStudyDir = (studyId: string) => rpc<void>('remove_study_dir', { studyId });
export const makeStylePreview = (studyId: string, styleId: string) =>
  rpc<{ previewPath: string | null; posterPath: string } | null>('make_style_preview', { studyId, styleId });
export const makeStyleSheets = (studyId: string, styleId: string) => rpc<string[]>('make_style_sheets', { studyId, styleId });
export const keepStyleRefs = (studyId: string, styleId: string) => rpc<string[]>('keep_style_refs', { studyId, styleId });
export const copyStyleRefs = (styleId: string, projectId: string) => rpc<number>('copy_style_refs', { styleId, projectId });

// ---- jobs ----
export const listJobs = () => rpc<Job[]>('list_jobs');
export const upsertJob = (job: Job) => rpc<void>('upsert_job', { job });
export const deleteJob = (id: string) => rpc<void>('delete_job', { id });
export const setJobsArchived = (ids: string[], archived: boolean) => rpc<void>('set_jobs_archived', { ids, archived });

// ---- agent ----
export const agentStart = (chatId: string, agentId: AgentId, auto?: boolean) =>
  rpc<boolean>('agent_start', auto === undefined ? { chatId, agentId } : { chatId, agentId, auto });
export const agentSetAuto = (chatId: string, on: boolean) => rpc<void>('agent_set_auto', { chatId, on });
export const agentPrompt = (chatId: string, parts: MessagePart[]) => rpc<void>('agent_prompt', { chatId, parts });
export const agentCancel = (chatId: string) => rpc<void>('agent_cancel', { chatId });
export const agentStop = (chatId: string) => rpc<void>('agent_stop', { chatId });
export const agentRespondPermission = (requestId: string, optionId: string | null) =>
  rpc<void>('agent_respond_permission', { requestId, optionId });
export const agentRespondQuestion = (requestId: string, response: QuestionResponse) =>
  rpc<void>('agent_respond_question', { requestId, response });

// ---- media ----
export const mediaLatestRender = (projectId: string) => rpc<string | null>('media_latest_render', { projectId });
export const recentImages = (chatId: string, since: string, limit: number) =>
  rpc<FileInfo[]>('recent_images', { chatId, since, limit });
export const latestRenderInfo = (projectId: string) => rpc<FileInfo | null>('latest_render_info', { projectId });
export const newestVideoInfo = (projectId: string) => rpc<FileInfo | null>('newest_video_info', { projectId });
export interface VideoThumb {
  path: string;
  modifiedAt: string;
  durationSec: number | null;
}
export const videoThumbnail = (projectId: string) => rpc<VideoThumb | null>('video_thumbnail', { projectId });
export const mediaProbe = (projectId: string) => rpc<MediaInfo | null>('media_probe', { projectId });
export const mediaExtractFrame = (projectId: string, timeSec: number) => rpc<string>('media_extract_frame', { projectId, timeSec });
export const mediaThumbnails = (projectId: string, count: number) => rpc<string[]>('media_thumbnails', { projectId, count });
export interface RenderCommand {
  install: string[] | null;
  render: string[];
}
export const renderCommand = (projectId: string) => rpc<RenderCommand | null>('render_command', { projectId });
export const writeBrief = (projectId: string, brief: string) => rpc<void>('write_brief', { projectId, brief });
export const mediaRender = (projectId: string) => rpc<string>('media_render', { projectId });

// ---- attachments ----
/** A browser file is uploaded; a server path is only accepted inside the workspace. */
export const attachFile = async (
  chatId: string,
  source: string | File,
): Promise<Extract<MessagePart, { type: 'file' }>> => {
  if (typeof source === 'string') {
    return rpc<Extract<MessagePart, { type: 'file' }>>('attach_file', { chatId, sourcePath: source });
  }
  const form = new FormData();
  form.append('chatId', chatId);
  form.append('file', source, source.name);
  const parts = await uploadFile<Extract<MessagePart, { type: 'file' }>[]>('/api/upload', form);
  if (!parts[0]) throw new Error('The upload returned no file');
  return parts[0];
};

// ---- project files (the workspace) ----
export interface ProjectFile {
  name: string;
  path: string;
  dir: boolean;
  size: number;
  dim: boolean;
}
export type ProjectFileKind = 'text' | 'image' | 'video' | 'audio' | 'binary' | 'tooLarge';
export interface ProjectFileContent {
  kind: ProjectFileKind;
  absPath: string;
  size: number;
  text: string | null;
}
export const projectFiles = (projectId: string, dir = '') => rpc<ProjectFile[]>('project_files', { projectId, dir });
export const findProjectFiles = (projectId: string, query: string) => rpc<ProjectFile[]>('find_project_files', { projectId, query });
export const readProjectFile = (projectId: string, path: string) => rpc<ProjectFileContent>('read_project_file', { projectId, path });

// ---- agent models ----
export interface AgentModels {
  current: string | null;
  options: ModelChoice[];
}
export const agentModels = (agentId: AgentId) => rpc<AgentModels | null>('agent_models', { agentId });
export const setAgentModel = (agentId: AgentId, model: string | null, chatId: string | null) =>
  rpc<Settings>('set_agent_model', { agentId, model, chatId });
