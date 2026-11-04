import type { ToolStatus } from '@tayang/shared';
import { i18n } from '@/i18n';

/**
 * Tool names and details come from Rust in English. The UI says them by tool id; an id it has no text for
 * (a tool added in Rust first) shows what Rust sent.
 */
export function toolName(tool: Pick<ToolStatus, 'id' | 'name'>): string {
  const key = `tools.${tool.id}.name`;
  return i18n.exists(key) ? (i18n.t(key as 'tools.node.name') as string) : tool.name;
}

export function toolDetail(tool: Pick<ToolStatus, 'id' | 'detail'>): string {
  const key = `tools.${tool.id}.detail`;
  return i18n.exists(key) ? (i18n.t(key as 'tools.node.detail') as string) : tool.detail;
}
