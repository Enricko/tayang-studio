import { i18n } from '@/i18n';
import { getAt, setAt } from './pointer';

export interface A2uiComponent {
  id: string;
  component: string;
  [prop: string]: unknown;
}

export interface Surface {
  surfaceId: string;
  catalogId: string;
  components: Record<string, A2uiComponent>;
  data: unknown;
}

export interface SurfaceSet {
  surfaces: Record<string, Surface>;
  /** Muted notes, e.g. messages in a version this app does not speak. */
  notes: string[];
}

export const emptySurfaces = (): SurfaceSet => ({ surfaces: {}, notes: [] });

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const blank = (surfaceId: string, catalogId = ''): Surface => ({ surfaceId, catalogId, components: {}, data: {} });

/** Applies v0.9 messages in order and returns the new set (the input is not mutated). */
export function applyMessages(set: SurfaceSet, messages: unknown[]): SurfaceSet {
  const surfaces = { ...set.surfaces };
  const notes = [...set.notes];
  const VERSION_NOTE = i18n.t('a2ui.versionNote');
  for (const m of messages) {
    if (!isObj(m)) continue;
    if (m.version !== 'v0.9') {
      if (!notes.includes(VERSION_NOTE)) notes.push(VERSION_NOTE);
      continue;
    }
    if (isObj(m.createSurface)) {
      const { surfaceId, catalogId } = m.createSurface as { surfaceId?: string; catalogId?: string };
      if (typeof surfaceId === 'string') {
        // Re-creating keeps nothing: the agent starts the surface over.
        surfaces[surfaceId] = blank(surfaceId, catalogId);
      }
    } else if (isObj(m.updateComponents)) {
      const { surfaceId, components } = m.updateComponents as { surfaceId?: string; components?: unknown };
      if (typeof surfaceId !== 'string' || !Array.isArray(components)) continue;
      const s = surfaces[surfaceId] ?? blank(surfaceId);
      const merged = { ...s.components };
      for (const c of components) {
        if (isObj(c) && typeof c.id === 'string' && typeof c.component === 'string') {
          merged[c.id] = { ...(merged[c.id] ?? {}), ...c } as A2uiComponent;
        }
      }
      surfaces[surfaceId] = { ...s, components: merged };
    } else if (isObj(m.updateDataModel)) {
      const { surfaceId, path, value } = m.updateDataModel as { surfaceId?: string; path?: string; value?: unknown };
      if (typeof surfaceId !== 'string') continue;
      const s = surfaces[surfaceId] ?? blank(surfaceId);
      const data = !path || path === '/' ? (value === undefined ? {} : value) : setAt(s.data, path, value);
      surfaces[surfaceId] = { ...s, data };
    } else if (isObj(m.deleteSurface)) {
      const { surfaceId } = m.deleteSurface as { surfaceId?: string };
      if (typeof surfaceId === 'string') delete surfaces[surfaceId];
    }
  }
  return { surfaces, notes };
}

export const readData = (s: Surface, path: string): unknown => getAt(s.data, path);
export const writeData = (s: Surface, path: string, value: unknown): Surface => ({
  ...s,
  data: setAt(s.data, path, value),
});

/** The surface id a block of messages is about (its first message that names one). */
export function blockSurfaceId(messages: unknown[]): string | null {
  for (const m of messages) {
    if (!isObj(m)) continue;
    for (const k of ['createSurface', 'updateComponents', 'updateDataModel', 'deleteSurface']) {
      const body = m[k];
      if (isObj(body) && typeof body.surfaceId === 'string') return body.surfaceId;
    }
  }
  return null;
}
