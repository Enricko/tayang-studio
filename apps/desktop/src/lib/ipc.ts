import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import type {
  AgentId,
  AgentInfo,
  AgentUsage,
  Chat,
  ChatMessage,
  Job,
  MediaInfo,
  MessagePart,
  NewProject,
  Project,
  Settings,
  Style,
  SystemInfo,
  ToolStatus,
} from '@tayang/shared';

// ---- system and settings ----
export const getSystemInfo = () => invoke<SystemInfo>('get_system_info');
export const detectAgents = () => invoke<AgentInfo[]>('detect_agents');
export const checkTools = (agent: AgentId) => invoke<ToolStatus[]>('check_tools', { agent });
export const getSettings = () => invoke<Settings>('get_settings');
export const updateSettings = (patch: Partial<Settings>) =>
  invoke<Settings>('update_settings', { patch });
/** The operating system's preferred language (`id-ID`), or null when it can't be read. */
export const systemLocale = () => invoke<string | null>('system_locale');
export const pickFolder = () => invoke<string | null>('pick_folder');

// ---- usage ----
export const getAgentUsage = (force: boolean) => invoke<AgentUsage[]>('get_agent_usage', { force });

// ---- projects ----
export const listProjects = () => invoke<Project[]>('list_projects');
export const createProject = (input: NewProject, brief: string) =>
  invoke<Project>('create_project', { input, brief });
export const updateProject = (id: string, patch: Partial<Project>) =>
  invoke<Project>('update_project', { id, patch });

// ---- chats ----
export const listChats = (projectId?: string) =>
  invoke<Chat[]>('list_chats', { projectId: projectId ?? null });
export const getChat = (chatId: string) => invoke<Chat | null>('get_chat', { chatId });
export const createChat = (projectId: string | null, agentId: AgentId, title: string) =>
  invoke<Chat>('create_chat', { projectId, agentId, title });
export const updateChatAgent = (chatId: string, agentId: AgentId) =>
  invoke<Chat>('update_chat_agent', { chatId, agentId });
export const listMessages = (chatId: string) => invoke<ChatMessage[]>('list_messages', { chatId });
export const addMessage = (chatId: string, role: ChatMessage['role'], parts: MessagePart[]) =>
  invoke<ChatMessage>('add_message', { chatId, role, parts });

// ---- styles ----
export const listStyles = () => invoke<Style[]>('list_styles');
/** What `sync_styles` returns: the built-in styles now in the library, and whether the API was out of reach. */
export interface StylesSync {
  styles: Style[];
  offline: boolean;
}
export const syncStyles = () => invoke<StylesSync>('sync_styles');
export const installStyleTemplate = (projectId: string) =>
  invoke<{ installed: boolean }>('install_style_template', { projectId });
export const saveStyle = (style: Style) => invoke<void>('save_style', { style });
export const deleteStyle = (id: string) => invoke<void>('delete_style', { id });
export const readStyleResult = (studyId: string) =>
  invoke<string | null>('read_style_result', { studyId });
export const studyDir = (studyId: string) => invoke<string>('study_dir', { studyId });
/** Deletes a study's folder (the download, frames and result) once the study is over. */
export const removeStudyDir = (studyId: string) => invoke<void>('remove_study_dir', { studyId });
/** Cuts a short silent clip and a poster from the study's downloaded video, then deletes that video. */
export const makeStylePreview = (studyId: string, styleId: string) =>
  invoke<{ previewPath: string | null; posterPath: string } | null>('make_style_preview', { studyId, styleId });

// ---- jobs ----
export const listJobs = () => invoke<Job[]>('list_jobs');
export const upsertJob = (job: Job) => invoke<void>('upsert_job', { job });
export const deleteJob = (id: string) => invoke<void>('delete_job', { id });

// ---- agent ----
/** Resolves true when Claude started without the Tayang plugin: send it the skills as text too. */
export const agentStart = (chatId: string, agentId: AgentId, auto?: boolean) =>
  invoke<boolean>('agent_start', auto === undefined ? { chatId, agentId } : { chatId, agentId, auto });
/** Auto mode for the running session: the agent runs commands without asking. */
export const agentSetAuto = (chatId: string, on: boolean) => invoke<void>('agent_set_auto', { chatId, on });
export const agentPrompt = (chatId: string, parts: MessagePart[]) =>
  invoke<void>('agent_prompt', { chatId, parts });
export const agentCancel = (chatId: string) => invoke<void>('agent_cancel', { chatId });
export const agentStop = (chatId: string) => invoke<void>('agent_stop', { chatId });
export const agentRespondPermission = (requestId: string, optionId: string | null) =>
  invoke<void>('agent_respond_permission', { requestId, optionId });

// ---- media ----
export const mediaLatestRender = (projectId: string) =>
  invoke<string | null>('media_latest_render', { projectId });
export const mediaProbe = (projectId: string) =>
  invoke<MediaInfo | null>('media_probe', { projectId });
export const mediaExtractFrame = (projectId: string, timeSec: number) =>
  invoke<string>('media_extract_frame', { projectId, timeSec });
export const mediaThumbnails = (projectId: string, count: number) =>
  invoke<string[]>('media_thumbnails', { projectId, count });
export interface RenderCommand {
  install: string[] | null;
  render: string[];
}
export const renderCommand = (projectId: string) => invoke<RenderCommand | null>('render_command', { projectId });
export const writeBrief = (projectId: string, brief: string) => invoke<void>('write_brief', { projectId, brief });
export const mediaRender = (projectId: string) => invoke<string>('media_render', { projectId });

/** URL the webview can load for a file on disk. */
export const assetUrl = (path: string): string => convertFileSrc(path);

// ---- attachments ----
export const attachFile = (chatId: string, sourcePath: string) =>
  invoke<Extract<MessagePart, { type: 'file' }>>('attach_file', { chatId, sourcePath });
