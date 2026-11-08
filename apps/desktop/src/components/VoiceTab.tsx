import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Loader2, Pause, Play, RefreshCw, Search, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/Button';
import { Input } from '@/components/ui/input';
import { VoiceRecorder } from '@/components/VoiceRecorder';
import { assetUrl, deleteVoice, listVoices, setDefaultVoice, ttsPreview, uploadVoice } from '@/lib/ipc';
import { pickUploadFiles } from '@/lib/platform';
import type { TtsVoiceList } from '@/lib/tts';
import { cn } from '@/lib/utils';

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Settings › Voice: choose the local engine/voice and add a reference recording for Pocket TTS's
 * zero-shot voice cloning. The selected default is written to the shared `/data/voices/config.json`
 * and handed to every new agent session.
 */
export function VoiceTab() {
  const { t } = useTranslation();
  const [data, setData] = useState<TtsVoiceList | null>(null);
  const [engine, setEngine] = useState('pocket');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const voices = await listVoices();
      setData(voices);
      setEngine((current) =>
        voices.engines.some((e) => e.id === current) ? current : voices.default.engine,
      );
      setError(null);
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => audioRef.current?.pause();
  }, [load]);

  const preview = async (engineId: string, voiceId: string) => {
    if (previewing === voiceId) {
      audioRef.current?.pause();
      setPreviewing(null);
      return;
    }
    audioRef.current?.pause();
    setPreviewLoading(voiceId);
    setNotice(null);
    try {
      const sample = await ttsPreview(engineId, voiceId, engineId === 'pocket' ? 'id' : 'en');
      const audio = new Audio(assetUrl(sample.path, String(Date.now())));
      audioRef.current = audio;
      audio.onended = () => setPreviewing((current) => (current === voiceId ? null : current));
      audio.onerror = () => {
        setPreviewing(null);
        setError(t('settings.voicePreviewFailed'));
      };
      setPreviewing(voiceId);
      await audio.play();
    } catch (e) {
      setError(t('settings.voicePreviewFailedWith', { message: message(e) }));
    } finally {
      setPreviewLoading(null);
    }
  };

  const choose = async (engineId: string, voiceId: string) => {
    setSaving(true);
    setNotice(null);
    try {
      const saved = await setDefaultVoice(engineId, voiceId);
      setData((current) => (current ? { ...current, default: saved } : current));
      setEngine(saved.engine);
      setNotice(t('settings.voiceSaved'));
      setError(null);
    } catch (e) {
      setError(t('settings.voiceSaveFailed', { message: message(e) }));
    } finally {
      setSaving(false);
    }
  };

  const saveVoice = async (file: File) => {
    setNotice(null);
    try {
      setUploading(true);
      const voice = await uploadVoice(file);
      const saved = await setDefaultVoice('pocket', voice.id);
      setData((current) => (current ? { ...current, default: saved } : current));
      setEngine('pocket');
      setNotice(t('settings.voiceUploaded'));
      setError(null);
      await load();
    } catch (e) {
      setError(t('settings.voiceUploadFailed', { message: message(e) }));
    } finally {
      setUploading(false);
    }
  };

  const addVoice = async () => {
    setNotice(null);
    try {
      const [picked] = await pickUploadFiles();
      if (!picked) return;
      if (!(picked instanceof File)) {
        setError(t('settings.voiceUploadWebOnly'));
        return;
      }
      await saveVoice(picked);
    } catch (e) {
      setError(t('settings.voiceUploadFailed', { message: message(e) }));
    }
  };

  const removeVoice = async (voiceId: string, name: string) => {
    if (!window.confirm(t('settings.voiceDeleteConfirm', { name }))) return;
    setNotice(null);
    try {
      await deleteVoice(voiceId);
      await load();
      setNotice(t('settings.voiceDeleted'));
      setError(null);
    } catch (e) {
      setError(t('settings.voiceDeleteFailed', { message: message(e) }));
    }
  };

  const current = data?.engines.find((e) => e.id === engine) ?? data?.engines[0];
  const custom = data?.engines.find((e) => e.id === 'pocket')?.voices.filter((v) => v.custom) ?? [];
  const visibleVoices = current?.voices.filter((v) => {
    const needle = query.trim().toLowerCase();
    return !needle || v.name.toLowerCase().includes(needle) || v.id.toLowerCase().includes(needle);
  }) ?? [];

  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-[13px] leading-normal text-text-2">{t('settings.voiceIntro')}</p>

      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-[13px] text-orange-light">
          <span className="min-w-0 flex-1">{error}</span>
          <Button variant="secondary" className="h-7 gap-1.5 rounded-sm px-2 text-xs" onClick={() => void load()}>
            <RefreshCw size={13} strokeWidth={1.5} aria-hidden="true" />
            {t('settings.voiceRetry')}
          </Button>
        </div>
      )}

      {loading && !data && <p className="m-0 text-[13px] text-text-2">{t('settings.voiceLoading')}</p>}

      {data && current && (
        <>
          <div className="rounded-xl border border-border bg-card">
            <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
              <div className="mr-auto flex flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {t('settings.voiceEngine')}
                  {current.id === 'kokoro' && (
                    <span className="rounded-full bg-raised px-2 py-0.5 text-[11px] font-normal text-text-3">
                      {t('settings.kokoroBadge')}
                    </span>
                  )}
                </span>
                <span className="text-xs text-text-3">
                  {current.id === 'pocket'
                    ? t('settings.voicePocketDesc')
                    : current.id === 'kokoro'
                      ? t('settings.voiceKokoroDesc')
                      : current.description}
                </span>
                {current.id === 'kokoro' && (
                  <span className="text-xs leading-normal text-orange-light">{t('settings.kokoroLanguageNote')}</span>
                )}
              </div>
              <div className="flex flex-wrap gap-1 rounded-md bg-background p-1" role="tablist" aria-label={t('settings.voiceEngine')}>
                {data.engines.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    role="tab"
                    aria-selected={e.id === current.id}
                    disabled={saving}
                    onClick={() => {
                      setEngine(e.id);
                      setQuery('');
                    }}
                    className={cn(
                      'h-7 cursor-pointer rounded px-2.5 text-xs font-medium transition-colors',
                      e.id === current.id ? 'bg-raised text-foreground' : 'text-text-2 hover:text-foreground',
                    )}
                  >
                    {e.name}
                  </button>
                ))}
              </div>
            </div>

            {current.voices.length > 8 && (
              <div className="relative border-b border-border px-4 py-2">
                <Search size={14} strokeWidth={1.5} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-7 -translate-y-1/2 text-text-3" />
                <Input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('settings.voiceSearch')}
                  aria-label={t('settings.voiceSearch')}
                  className="h-8 bg-background pl-8 text-[13px]"
                />
              </div>
            )}
            <ul className="m-0 flex list-none flex-col p-0">
              {visibleVoices.map((voice) => {
                const selected = data.default.engine === current.id && data.default.voice === voice.id;
                return (
                  <li key={voice.id} className="border-b border-border last:border-b-0">
                    <div className="flex items-center gap-3 px-4 py-2.5">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void choose(current.id, voice.id)}
                        aria-pressed={selected}
                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 border-0 bg-transparent p-0 text-left disabled:cursor-default"
                      >
                        <span
                          className={cn(
                            'flex size-5 shrink-0 items-center justify-center rounded-full border',
                            selected ? 'border-orange-light bg-orange-light text-background' : 'border-border text-transparent',
                          )}
                          aria-hidden="true"
                        >
                          <Check size={12} strokeWidth={2.5} />
                        </span>
                        <span className="truncate text-sm text-[#D9D9D9]">{voice.name}</span>
                        {voice.custom && (
                          <span className="shrink-0 rounded-full bg-raised px-2 py-0.5 text-[11px] text-text-2">
                            {t('settings.voiceCustom')}
                          </span>
                        )}
                        {selected && (
                          <span className="ml-auto shrink-0 text-xs text-text-3">{t('settings.voiceDefault')}</span>
                        )}
                      </button>
                      <button
                        type="button"
                        disabled={!!previewLoading}
                        aria-label={t('settings.voicePreview', { name: voice.name })}
                        title={t('settings.voicePreview', { name: voice.name })}
                        className="flex size-7 cursor-pointer items-center justify-center rounded text-text-3 hover:bg-raised hover:text-foreground disabled:cursor-default disabled:opacity-50"
                        onClick={() => void preview(current.id, voice.id)}
                      >
                        {previewLoading === voice.id ? (
                          <Loader2 size={14} strokeWidth={1.5} className="animate-spin" aria-hidden="true" />
                        ) : previewing === voice.id ? (
                          <Pause size={14} strokeWidth={1.5} aria-hidden="true" />
                        ) : (
                          <Play size={14} strokeWidth={1.5} aria-hidden="true" />
                        )}
                      </button>
                      {voice.custom && (
                        <button
                          type="button"
                          aria-label={t('settings.voiceDelete', { name: voice.name })}
                          title={t('settings.voiceDelete', { name: voice.name })}
                          className="flex size-7 cursor-pointer items-center justify-center rounded text-text-3 hover:bg-raised hover:text-orange-light"
                          onClick={() => void removeVoice(voice.id, voice.name)}
                        >
                          <Trash2 size={14} strokeWidth={1.5} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
              {visibleVoices.length === 0 && (
                <li className="px-4 py-4 text-[13px] text-text-3">{t('settings.voiceNoMatch')}</li>
              )}
            </ul>
          </div>

          <div className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="mr-auto flex min-w-[240px] flex-1 flex-col gap-1">
                <span className="text-sm font-medium">{t('settings.voiceUpload')}</span>
                <span className="text-xs leading-normal text-text-3">{t('settings.voiceUploadHint')}</span>
                {custom.length === 0 && (
                  <span className="text-xs text-text-3">{t('settings.voiceUploadFirst')}</span>
                )}
              </div>
              <Button variant="secondary" className="gap-2" disabled={uploading} onClick={() => void addVoice()}>
                <Upload size={14} strokeWidth={1.5} aria-hidden="true" />
                {uploading ? t('settings.voiceUploading') : t('settings.voiceUploadAction')}
              </Button>
            </div>
            <div className="flex flex-col gap-2 rounded-md border border-border bg-background p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="mr-auto text-[13px] font-medium text-[#D9D9D9]">{t('settings.voiceCloneScriptTitle')}</span>
                <Button
                  variant="ghost"
                  className="h-7 gap-1.5 px-2 text-xs"
                  onClick={() => {
                    void navigator.clipboard?.writeText(t('settings.voiceCloneScript')).then(() => setNotice(t('settings.voiceCloneCopied'))).catch(() => {});
                  }}
                >
                  <Copy size={13} strokeWidth={1.5} aria-hidden="true" />
                  {t('settings.voiceCloneCopy')}
                </Button>
              </div>
              <p className="m-0 text-[13px] leading-normal text-[#D9D9D9]">{t('settings.voiceCloneScript')}</p>
              <span className="text-xs leading-normal text-text-3">{t('settings.voiceCloneScriptHint')}</span>
            </div>
            <VoiceRecorder disabled={uploading} onRecorded={saveVoice} />
          </div>

          <p className="m-0 text-xs leading-normal text-text-3">{t('settings.voiceApplyHint')}</p>
          {notice && (
            <p role="status" className="m-0 text-[13px] text-text-2">
              {notice}
            </p>
          )}
        </>
      )}
    </div>
  );
}
