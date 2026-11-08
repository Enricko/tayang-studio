import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Loader2, Play, Volume2 } from 'lucide-react';
import { Button } from '@/components/Button';
import { assetUrl, ttsPrepare, ttsPreview, ttsStatus } from '@/lib/ipc';
import type { TtsStatus } from '@/lib/tts';

const ENGINES = [
  { id: 'pocket', name: 'Pocket TTS', descKey: 'settings.voicePocketDesc' },
  { id: 'kokoro', name: 'Kokoro', descKey: 'settings.voiceKokoroDesc' },
] as const;

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Settings › Tools: the two local voice engines, one click to load their models and a sample. */
export function VoiceTools() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<TtsStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await ttsStatus());
      setError(null);
    } catch (e) {
      setError(t('settings.voiceToolsFailed', { message: message(e) }));
    }
  }, [t]);

  useEffect(() => {
    void load();
    return () => audioRef.current?.pause();
  }, [load]);

  const install = async (engine: string) => {
    setBusy(engine);
    setError(null);
    try {
      await ttsPrepare(engine);
      await load();
    } catch (e) {
      setError(t('settings.voiceInstallFailed', { message: message(e) }));
    } finally {
      setBusy(null);
    }
  };

  const test = async (engine: string) => {
    if (playing === engine) {
      audioRef.current?.pause();
      setPlaying(null);
      return;
    }
    audioRef.current?.pause();
    setTesting(engine);
    setError(null);
    try {
      const sample = await ttsPreview(engine, null, engine === 'pocket' ? 'id' : 'en');
      const audio = new Audio(assetUrl(sample.path, String(Date.now())));
      audioRef.current = audio;
      audio.onended = () => setPlaying((current) => (current === engine ? null : current));
      audio.onerror = () => setPlaying(null);
      setPlaying(engine);
      await audio.play();
    } catch (e) {
      setError(t('settings.voicePreviewFailedWith', { message: message(e) }));
    } finally {
      setTesting(null);
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 className="m-0 text-sm font-medium">{t('settings.localVoiceTools')}</h3>
        <span className="text-[13px] leading-normal text-text-2">{t('settings.localVoiceToolsHint')}</span>
      </div>
      <ul className="m-0 flex list-none flex-col overflow-hidden rounded-xl border border-border bg-card p-0">
        {ENGINES.map((engine) => {
          const prepared = !!status?.engines[engine.id]?.prepared;
          const installing = busy === engine.id;
          const sampling = testing === engine.id;
          return (
            <li key={engine.id} className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-raised text-text-2">
                <Volume2 size={20} strokeWidth={1.5} aria-hidden="true" />
              </div>
              <div className="mr-auto flex min-w-[220px] flex-1 flex-col gap-1">
                <span className="text-[15px] font-medium">{engine.name}</span>
                <span className="text-[13px] text-text-3">{t(engine.descKey)}</span>
                {engine.id === 'kokoro' && <span className="text-xs text-orange-light">{t('settings.kokoroLanguageNote')}</span>}
              </div>
              {prepared && (
                <span className="inline-flex items-center gap-2 text-sm text-[#D9D9D9]">
                  <Check size={16} strokeWidth={1.5} aria-hidden="true" />
                  {t('settings.voiceInstalled')}
                </span>
              )}
              <Button variant="secondary" className="h-9 gap-2 px-3 text-[13px]" disabled={sampling} onClick={() => void test(engine.id)}>
                {sampling ? <Loader2 size={14} strokeWidth={1.5} className="animate-spin" aria-hidden="true" /> : <Play size={14} strokeWidth={1.5} aria-hidden="true" />}
                {sampling ? t('settings.voiceTesting') : playing === engine.id ? t('settings.voiceStop') : t('settings.voiceTest')}
              </Button>
              {!prepared && (
                <Button variant="secondary" className="h-9 gap-2 px-3 text-[13px]" disabled={installing} onClick={() => void install(engine.id)}>
                  {installing && <Loader2 size={14} strokeWidth={1.5} className="animate-spin" aria-hidden="true" />}
                  {installing ? t('settings.voiceInstalling') : t('settings.voiceInstall')}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p role="alert" className="m-0 text-[13px] text-orange-light">{error}</p>}
    </section>
  );
}
