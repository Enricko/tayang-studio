import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, MapPin, Pause, Play, SquarePlus } from 'lucide-react';
import { formatTimecode, frameAt, secAt } from '@tayang/shared';
import type { MediaInfo, Mark } from '@tayang/shared';
import { Button } from '@/components/Button';
import { Oyen } from '@/components/Oyen';
import {
  assetUrl,
  mediaExtractFrame,
  mediaLatestRender,
  mediaProbe,
  mediaRender,
  mediaThumbnails,
} from '@/lib/ipc';
import { useChat } from '@/state/chat';
import { Scrubber, type Scene } from './Scrubber';

const THUMBS = 12;
const NO_MESSAGES: never[] = [];

const Key = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <span
    className={`min-w-3 rounded border border-b-2 border-[#333333] px-1 text-center font-mono text-[11px] text-[#D9D9D9] ${className}`}
  >
    {children}
  </span>
);

export function Preview({
  projectId,
  chatId,
  scenes,
  reloadKey = 0,
  onRender,
  rendering: renderingProp = false,
}: {
  projectId: string;
  chatId: string;
  scenes?: Scene[];
  /** Bump to reload the latest render, its probe and thumbnails. */
  reloadKey?: number;
  /** Renders through the screen (which also records the project's status). */
  onRender?(): void;
  rendering?: boolean;
}) {
  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [info, setInfo] = useState<MediaInfo | null>(null);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [sending, setSending] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const messages = useChat((s) => s.messages[chatId]) ?? NO_MESSAGES;
  const lastAgent = [...messages].reverse().find((m) => m.role === 'agent');
  const checked = !!lastAgent?.parts.some((p) => p.type === 'text' && p.text.includes('Frames checked'));

  const load = useCallback(async () => {
    const [path, probe] = await Promise.all([mediaLatestRender(projectId), mediaProbe(projectId)]);
    setVideoPath(path);
    setInfo(probe);
    setFrame(0);
    setPlaying(false);
    setThumbs(path && probe ? (await mediaThumbnails(projectId, THUMBS)).map(assetUrl) : []);
  }, [projectId]);

  useEffect(() => {
    let alive = true;
    load().catch((e) => alive && setError(String(e?.message ?? e)));
    return () => {
      alive = false;
    };
  }, [load, reloadKey]);

  const render = async () => {
    if (onRender) return onRender();
    setRendering(true);
    setError(null);
    try {
      await mediaRender(projectId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRendering(false);
    }
  };

  const busy = rendering || renderingProp;
  if (!videoPath || !info) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-[#101010] px-5 text-center">
        <Oyen mood={busy ? 'sleepy' : 'default'} size={56} />
        <span className="text-[13px] text-text-2">{busy ? 'Rendering…' : 'Nothing rendered yet'}</span>
        {!busy && <Button variant="secondary" onClick={() => void render()}>Render preview</Button>}
        {error && (
          <p role="alert" className="text-xs text-[#FFB08F]">
            {error}
          </p>
        )}
      </div>
    );
  }

  const { fps, durationSec } = info;
  const total = Math.max(1, Math.round(durationSec * fps));
  const clamp = (f: number) => Math.min(total - 1, Math.max(0, f));
  const seek = (f: number) => {
    const next = clamp(f);
    setFrame(next);
    if (videoRef.current) videoRef.current.currentTime = secAt(next, fps);
  };
  const toggle = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play()?.catch(() => {});
    else v.pause();
  };

  const onBoxClick = (e: React.MouseEvent) => {
    if (!marking) return;
    const r = boxRef.current!.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    setMarks((m) => [...m, { x, y }]);
    setMarking(false);
  };

  const sendFrame = async () => {
    setSending(true);
    setError(null);
    try {
      const timeSec = secAt(frame, fps);
      const imagePath = await mediaExtractFrame(projectId, timeSec);
      useChat.getState().attach(chatId, { type: 'frame', projectId, frame, timeSec, imagePath, marks });
      setMarks([]);
      setMarking(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto bg-[#101010] px-5 py-4">
      <div className="flex justify-center">
        <div
          ref={boxRef}
          data-testid="preview-frame"
          onClick={onBoxClick}
          className={`relative h-[448px] w-[252px] overflow-hidden rounded-xl border border-[#23365A] bg-black ${marking ? 'cursor-crosshair' : ''}`}
        >
          <video
            ref={videoRef}
            src={assetUrl(videoPath)}
            className="h-full w-full object-contain"
            playsInline
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(e) => setFrame(clamp(frameAt(e.currentTarget.currentTime, fps)))}
          />
          {marks.map((m, i) => (
            <div
              key={i}
              data-testid={`mark-${i + 1}`}
              className="absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md bg-primary font-mono text-xs text-primary-foreground"
              style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%` }}
            >
              {i + 1}
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="secondary" size="icon" aria-label={playing ? 'Pause' : 'Play'} onClick={toggle} className="size-8 px-0">
          {playing ? <Pause size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
        </Button>
        <Button variant="ghost" size="icon" aria-label="Previous frame" onClick={() => seek(frame - 1)} className="size-8 px-0">
          <ChevronLeft size={16} strokeWidth={1.5} />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Next frame" onClick={() => seek(frame + 1)} className="size-8 px-0">
          <ChevronRight size={16} strokeWidth={1.5} />
        </Button>
        <span className="font-mono text-xs tabular-nums text-foreground">{formatTimecode(secAt(frame, fps), fps)}</span>
        <span className="font-mono text-xs tabular-nums text-text-3">/ {formatTimecode(durationSec, fps)}</span>
        <span className="ml-auto font-mono text-xs tabular-nums text-text-3">Frame {frame}</span>
      </div>

      <Scrubber durationSec={durationSec} fps={fps} frame={frame} thumbnails={thumbs} onSeek={seek} scenes={scenes} />

      <div className="flex items-center gap-2">
        <Button variant="secondary" disabled={sending} onClick={() => void sendFrame()} className="px-3 text-[13px]">
          <SquarePlus size={16} strokeWidth={1.5} />
          Send frame to chat
        </Button>
        <Button
          variant="ghost"
          aria-pressed={marking}
          onClick={() => setMarking((m) => !m)}
          className={`px-3 text-[13px] ${marking ? 'text-foreground' : ''}`}
        >
          <MapPin size={16} strokeWidth={1.5} />
          Mark a spot
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-[#FFB08F]">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2 text-xs text-text-3">
        <Key>←</Key>
        <Key>→</Key>
        <span>one frame</span>
        <Key className="ml-2">Shift</Key>
        <span>one second</span>
        {checked && (
          <span className="ml-auto inline-flex items-center gap-1 text-text-2">
            <Oyen mood="happy" size={24} />
            Frames checked
          </span>
        )}
      </div>
    </div>
  );
}
