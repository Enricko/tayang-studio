// Platform boundary for everything outside the backend contract: URLs, files, notifications,
// window controls and updates. Tauri modules are imported lazily only on desktop, so the browser
// build never initializes or even loads them.

export const isWeb = import.meta.env.MODE === 'web';

export interface Capabilities {
  web: boolean;
  folderPicker: boolean;
  revealInFolder: boolean;
  desktopWindow: boolean;
  autostart: boolean;
  autoUpdate: boolean;
  /** Server-side scheduling/autopilot owns the engine, not this tab. */
  serverOrchestration: boolean;
  /** The optional private Tayang cloud API is not bundled by the self-hosted server. */
  tayangCloud: boolean;
}

export const capabilities: Capabilities = {
  web: isWeb,
  folderPicker: !isWeb,
  revealInFolder: !isWeb,
  desktopWindow: !isWeb,
  autostart: !isWeb,
  autoUpdate: !isWeb,
  serverOrchestration: isWeb,
  tayangCloud: !isWeb,
};

async function tauriOpener() {
  return import('@tauri-apps/plugin-opener');
}

export async function openUrl(url: string): Promise<void> {
  if (isWeb) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  await (await tauriOpener()).openUrl(url);
}

export async function revealInFolder(path: string): Promise<void> {
  if (isWeb) return;
  await (await tauriOpener()).revealItemInDir(path);
}

export type PickedFile = string | File;

/** Desktop: native file paths. Web: File objects from a hidden `<input type=file>`. */
export async function pickUploadFiles(): Promise<PickedFile[]> {
  if (!isWeb) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const picked = await open({ multiple: true, directory: false });
    if (!picked) return [];
    return Array.isArray(picked) ? picked : [picked];
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.addEventListener('change', () => {
      resolve(Array.from(input.files ?? []));
      input.remove();
    });
    input.addEventListener('cancel', () => {
      resolve([]);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  });
}

export interface DropPosition {
  x: number;
  y: number;
  dpr: number;
}

/** External file drops, from the native webview on desktop and from the DOM in a browser. */
export function onFileDrop(cb: (files: PickedFile[], position: DropPosition) => void, onOver?: (over: boolean) => void): () => void {
  if (isWeb) {
    const dragover = (e: DragEvent) => {
      e.preventDefault();
      onOver?.(true);
    };
    const dragleave = () => onOver?.(false);
    const drop = (e: DragEvent) => {
      e.preventDefault();
      onOver?.(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      cb(files, { x: e.clientX, y: e.clientY, dpr: 1 });
    };
    document.addEventListener('dragover', dragover);
    document.addEventListener('dragleave', dragleave);
    document.addEventListener('drop', drop);
    return () => {
      document.removeEventListener('dragover', dragover);
      document.removeEventListener('dragleave', dragleave);
      document.removeEventListener('drop', drop);
    };
  }
  let off: (() => void) | undefined;
  let gone = false;
  void import('@tauri-apps/api/webview')
    .then(({ getCurrentWebview }) =>
      getCurrentWebview().onDragDropEvent((e) => {
        const p = e.payload;
        if (p.type === 'leave') onOver?.(false);
        else if (p.type === 'drop') {
          onOver?.(false);
          cb(p.paths, { x: p.position.x, y: p.position.y, dpr: window.devicePixelRatio });
        } else onOver?.(true);
      }),
    )
    .then((fn) => (gone ? fn() : (off = fn)))
    .catch(() => {});
  return () => {
    gone = true;
    off?.();
  };
}

export async function appVersion(): Promise<string> {
  if (!isWeb) {
    const { getVersion } = await import('@tauri-apps/api/app');
    return getVersion();
  }
  try {
    const res = await fetch('/api/version', { credentials: 'same-origin' });
    if (res.ok) return ((await res.json()) as { version?: string }).version ?? 'web';
  } catch {
    /* ignore */
  }
  return 'web';
}

export async function notify(title: string, body: string): Promise<void> {
  if (isWeb) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
      throw new Error('Notifications are not allowed');
    }
    new Notification(title, { body });
    return;
  }
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('plugin:notification|notify', { options: { title, body } });
}

export async function canNotify(): Promise<boolean> {
  if (isWeb) return typeof Notification !== 'undefined' && Notification.permission === 'granted';
  const { isPermissionGranted } = await import('@tauri-apps/plugin-notification');
  return isPermissionGranted();
}

export async function requestNotify(): Promise<boolean> {
  if (isWeb) {
    if (typeof Notification === 'undefined') return false;
    return (await Notification.requestPermission()) === 'granted';
  }
  const { requestPermission } = await import('@tauri-apps/plugin-notification');
  return (await requestPermission()) === 'granted';
}

export async function setAutostart(on: boolean): Promise<void> {
  if (isWeb) throw new Error('Open at login is a desktop feature');
  const mod = await import('@tauri-apps/plugin-autostart');
  await (on ? mod.enable() : mod.disable());
}

export async function windowLabel(): Promise<string> {
  if (isWeb) return 'web';
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  try {
    return getCurrentWindow().label || 'main';
  } catch {
    return 'main';
  }
}

export async function startWindowDrag(): Promise<void> {
  if (isWeb) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().startDragging();
}

export async function toggleMaximize(): Promise<void> {
  if (isWeb) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().toggleMaximize();
}

export interface AvailableUpdate {
  version: string;
  download: (onProgress: (percent: number | null) => void) => Promise<void>;
  install: () => Promise<void>;
}

export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  if (isWeb) return null;
  const { check } = await import('@tauri-apps/plugin-updater');
  const update = await check();
  if (!update) return null;
  return {
    version: update.version,
    download: async (onProgress) => {
      let total = 0;
      let got = 0;
      await update.download((ev) => {
        if (ev.event === 'Started') total = ev.data.contentLength ?? 0;
        else if (ev.event === 'Progress') {
          got += ev.data.chunkLength;
          if (total > 0) onProgress(Math.min(100, Math.round((got / total) * 100)));
        }
      });
      onProgress(100);
    },
    install: async () => {
      await update.install();
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    },
  };
}

/** The browser edition is updated by deploying a new server image; reload is the honest action. */
export async function restartApp(): Promise<void> {
  if (isWeb) {
    window.location.reload();
    return;
  }
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
}
