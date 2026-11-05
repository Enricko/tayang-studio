import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderOpen } from 'lucide-react';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { assetUrl, readProjectFile, type ProjectFileContent } from '@/lib/ipc';
import { highlight } from '@/lib/highlight';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * One project file, read-only: code with line numbers and colours, an image, a video or a sound, or a
 * note when it can't be shown. `reloadKey` reads it again (the agent may have changed it).
 */
export function FileView({ projectId, path, reloadKey }: { projectId: string; path: string; reloadKey: number }) {
  const { t } = useTranslation();
  const [file, setFile] = useState<ProjectFileContent | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = path.split('/').pop() ?? path;

  useEffect(() => {
    let alive = true;
    setError(null);
    readProjectFile(projectId, path)
      .then(async (f) => {
        if (!alive) return;
        setFile(f);
        setHtml(null);
        if (f.kind === 'text' && f.text !== null) {
          const h = await highlight(f.text, name);
          if (alive) setHtml(h);
        }
      })
      .catch((e) => {
        if (!alive) return;
        setFile(null);
        setError(t('workspace.readFailed', { message: message(e) }));
      });
    return () => {
      alive = false;
    };
  }, [projectId, path, name, reloadKey, t]);

  const reveal = () => file && void revealItemInDir(file.absPath).catch(() => {});

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#101010]">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-3" title={path}>
          {path}
        </span>
        {file && <span className="shrink-0 font-mono text-[11px] text-text-3">{formatSize(file.size)}</span>}
        {file && (
          <button
            type="button"
            aria-label={t('workspace.showInFolder')}
            title={t('workspace.showInFolder')}
            onClick={reveal}
            className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-sm text-text-3 hover:bg-raised hover:text-foreground"
          >
            <FolderOpen size={14} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {error ? (
          <p role="alert" className="m-0 p-4 text-xs text-orange-light">
            {error}
          </p>
        ) : !file ? (
          <p className="m-0 p-4 text-xs text-text-3">{t('workspace.loading')}</p>
        ) : file.kind === 'text' ? (
          html ? (
            <>
              {/* Shiki escapes the file's text; the markup is its own spans. Thousands of coloured spans make
                  the accessibility tree crawl, so assistive tech reads the plain copy below instead. */}
              <div data-testid="code" aria-hidden="true" className="code-view" dangerouslySetInnerHTML={{ __html: html }} />
              <pre className="sr-only" aria-label={name}>
                {file.text}
              </pre>
            </>
          ) : (
            <pre data-testid="code" className="code-view">
              <code>
                {(file.text ?? '').split('\n').map((line, i) => (
                  <span key={i} className="line">
                    {line}
                    {'\n'}
                  </span>
                ))}
              </code>
            </pre>
          )
        ) : file.kind === 'image' ? (
          <div className="flex min-h-full items-center justify-center p-4">
            <img src={assetUrl(file.absPath)} alt={name} className="max-h-full max-w-full rounded-md border border-border" />
          </div>
        ) : file.kind === 'video' ? (
          <div className="flex min-h-full items-center justify-center p-4">
            <video src={assetUrl(file.absPath)} controls playsInline className="max-h-full max-w-full rounded-md bg-black" />
          </div>
        ) : file.kind === 'audio' ? (
          <div className="flex min-h-full items-center justify-center p-4">
            <audio src={assetUrl(file.absPath)} controls aria-label={name} />
          </div>
        ) : (
          <div className="flex flex-col items-start gap-3 p-4">
            <p className="m-0 text-[13px] text-text-2">
              {file.kind === 'tooLarge' ? t('workspace.tooLarge', { size: formatSize(file.size) }) : t('workspace.binary')}
            </p>
            <button
              type="button"
              onClick={reveal}
              className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border border-hairline px-3 text-[13px] hover:bg-hairline"
            >
              <FolderOpen size={14} aria-hidden="true" />
              {t('workspace.showInFolder')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
