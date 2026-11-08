import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Mic, Square } from 'lucide-react';
import { Button } from '@/components/Button';

const MAX_SECONDS = 30;
const MIN_SECONDS = 5;

/** PCM WAV from the decoded microphone recording, because the cloner accepts normal audio files. */
function wavFromBuffer(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const sampleRate = buffer.sampleRate;
  const data = new DataView(new ArrayBuffer(44 + frames * 2));
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) data.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, 'RIFF');
  data.setUint32(4, 36 + frames * 2, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, 1, true);
  data.setUint32(24, sampleRate, true);
  data.setUint32(28, sampleRate * 2, true);
  data.setUint16(32, 2, true);
  data.setUint16(34, 16, true);
  write(36, 'data');
  data.setUint32(40, frames * 2, true);
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    let sample = 0;
    for (let c = 0; c < channels; c++) sample += buffer.getChannelData(c)[i] ?? 0;
    sample = Math.max(-1, Math.min(1, sample / channels));
    data.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return new Blob([data], { type: 'audio/wav' });
}

async function toWav(blob: Blob): Promise<File> {
  const context = new AudioContext();
  try {
    const audio = await context.decodeAudioData(await blob.arrayBuffer());
    return new File([wavFromBuffer(audio)], `rekaman-${Date.now()}.wav`, { type: 'audio/wav' });
  } finally {
    await context.close();
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Record the clone script in the browser and hand the WAV to the upload flow. */
export function VoiceRecorder({ disabled, onRecorded }: { disabled: boolean; onRecorded(file: File): Promise<void> }) {
  const { t } = useTranslation();
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<number | null>(null);
  const started = useRef(0);

  const release = () => {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    recorder.current = null;
  };

  useEffect(() => release, []);

  const stop = () => {
    recorder.current?.stop();
  };

  const start = async () => {
    setError(null);
    setSeconds(0);
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError(t('settings.voiceMicDenied'));
      return;
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = media;
      const next = new MediaRecorder(media);
      recorder.current = next;
      chunks.current = [];
      next.ondataavailable = (event) => {
        if (event.data.size) chunks.current.push(event.data);
      };
      next.onerror = () => {
        release();
        setRecording(false);
        // i18n-ignore: technical error detail
        setError(t('settings.voiceRecordFailed', { message: 'MediaRecorder error' }));
      };
      next.onstop = async () => {
        const elapsed = (Date.now() - started.current) / 1000;
        const raw = new Blob(chunks.current, { type: next.mimeType || 'audio/webm' });
        release();
        setRecording(false);
        if (elapsed < MIN_SECONDS) {
          setError(t('settings.voiceRecordTooShort'));
          return;
        }
        setPreparing(true);
        try {
          await onRecorded(await toWav(raw));
        } catch (e) {
          setError(t('settings.voiceRecordFailed', { message: message(e) }));
        } finally {
          setPreparing(false);
          setSeconds(0);
        }
      };
      started.current = Date.now();
      next.start();
      setRecording(true);
      timer.current = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - started.current) / 1000);
        setSeconds(elapsed);
        if (elapsed >= MAX_SECONDS) next.stop();
      }, 250);
    } catch (e) {
      release();
      setRecording(false);
      setError(t('settings.voiceMicDenied'));
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {recording ? (
        <Button variant="secondary" className="gap-2" onClick={stop}>
          <Square size={14} strokeWidth={1.5} aria-hidden="true" />
          {t('settings.voiceStopRecording')} · {seconds}s / {MAX_SECONDS}s
        </Button>
      ) : (
        <Button variant="secondary" className="gap-2" disabled={disabled || preparing} onClick={() => void start()}>
          <Mic size={14} strokeWidth={1.5} aria-hidden="true" />
          {preparing ? t('settings.voiceUploading') : t('settings.voiceRecord')}
        </Button>
      )}
      {!recording && !preparing && <span className="text-xs text-text-3">{t('settings.voiceRecordHint')}</span>}
      {error && (
        <span role="alert" className="basis-full text-xs text-orange-light">
          {error}
        </span>
      )}
    </div>
  );
}
