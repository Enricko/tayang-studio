import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { MessagePart, Project, VideoKind } from '@tayang/shared';
import { buildTopicIdeasPrompt, parseTopicIdeas } from '@tayang/skills';
import { Button } from '@/components/Button';
import { Oyen } from '@/components/Oyen';
import { createChat, listProjects } from '@/lib/ipc';
import { cn } from '@/lib/utils';
import { useApp } from '@/state/app';
import { useChat } from '@/state/chat';

const KINDS: VideoKind[] = ['explainer', 'promo', 'quote', 'news', 'tutorial', 'data', 'event'];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const NO_MESSAGES: never[] = [];

type Idea = { title: string; kind: VideoKind; lengthSec: number };

const pad = (n: number) => String(n).padStart(2, '0');
export const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 42 days, Monday first, starting on the Monday on or before the 1st. */
export function monthCells(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, i) => new Date(year, month, 1 - offset + i));
}

function weekKey(today: Date) {
  const mon = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
  return `tayang.ideas.${dateKey(mon)}`;
}

function readCache(key: string): Idea[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Idea[]) : [];
  } catch {
    return [];
  }
}

function agentText(parts: MessagePart[]) {
  return parts.map((p) => (p.type === 'text' ? p.text : '')).join('');
}

export function Calendar({ today: todayProp }: { today?: Date } = {}) {
  const today = useMemo(() => todayProp ?? new Date(), [todayProp]);
  const settings = useApp((s) => s.settings);
  const navigate = useApp((s) => s.navigate);
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [projects, setProjects] = useState<Project[]>([]);
  const cacheKey = weekKey(today);
  const [ideas, setIdeas] = useState<Idea[]>(() => readCache(cacheKey));
  const [chatId, setChatId] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);

  const messages = useChat((s) => (chatId ? s.messages[chatId] : undefined)) ?? NO_MESSAGES;
  const streaming = useChat((s) => (chatId ? !!s.streaming[chatId] : false));

  useEffect(() => {
    let alive = true;
    listProjects()
      .then((p) => alive && setProjects(p))
      .catch(() => {});
    useChat.getState().listen();
    return () => {
      alive = false;
    };
  }, []);

  // When the agent's turn ends, turn its JSON into idea cards and cache them for the week.
  useEffect(() => {
    if (!chatId || streaming || !pending.current) return;
    const last = messages[messages.length - 1];
    if (last?.role === 'system') {
      pending.current = false;
      setAsking(false);
      setError("Couldn't get ideas. Try again");
      return;
    }
    if (last?.role !== 'agent') return;
    pending.current = false;
    setAsking(false);
    const found = parseTopicIdeas(agentText(last.parts));
    if (!found.length) {
      setError("Couldn't get ideas. Try again");
      return;
    }
    setIdeas(found);
    try {
      localStorage.setItem(cacheKey, JSON.stringify(found));
    } catch {
      /* cache is optional */
    }
  }, [chatId, streaming, messages, cacheKey]);

  const getIdeas = async () => {
    if (!settings || asking) return;
    setAsking(true);
    setError(null);
    try {
      let id = chatId;
      if (!id) {
        id = (await createChat(null, settings.defaultAgent, 'Ideas for this week')).id;
        setChatId(id);
      }
      pending.current = true;
      const err = await useChat.getState().send(id, [{ type: 'text', text: 'Suggest video topics for this week' }], {
        promptParts: [{ type: 'text', text: buildTopicIdeasPrompt(KINDS, settings.language) }],
      });
      if (err) throw new Error(err);
    } catch (e) {
      pending.current = false;
      setAsking(false);
      setError(`Couldn't get ideas: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const cells = monthCells(cursor.y, cursor.m);
  const todayKey = dateKey(today);
  const events = useMemo(() => {
    const map: Record<string, { p: Project; at: Date }[]> = {};
    for (const p of projects) {
      if (!p.scheduledAt) continue;
      const at = new Date(p.scheduledAt);
      if (Number.isNaN(at.getTime())) continue;
      (map[dateKey(at)] ??= []).push({ p, at });
    }
    for (const list of Object.values(map)) list.sort((a, b) => a.at.getTime() - b.at.getTime());
    return map;
  }, [projects]);

  const go = (delta: number) =>
    setCursor((c) => {
      const d = new Date(c.y, c.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });

  return (
    <div className="flex h-full flex-wrap content-start gap-6 overflow-y-auto p-8">
      <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-4">
        <div data-tauri-drag-region className="flex flex-wrap items-center gap-2">
          <h1 className="m-0 mr-auto text-[28px] font-semibold tracking-[-0.01em]">
            {MONTHS[cursor.m]} {cursor.y}
          </h1>
          <Button variant="secondary" aria-label="Previous month" className="size-9 px-0 text-text-2" onClick={() => go(-1)}>
            <ChevronLeft size={16} strokeWidth={1.5} aria-hidden="true" />
          </Button>
          <Button variant="secondary" className="h-9 px-3 text-[13px]" onClick={() => setCursor({ y: today.getFullYear(), m: today.getMonth() })}>
            Today
          </Button>
          <Button variant="secondary" aria-label="Next month" className="size-9 px-0 text-text-2" onClick={() => go(1)}>
            <ChevronRight size={16} strokeWidth={1.5} aria-hidden="true" />
          </Button>
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-text-2">
          <span className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
            Ready to post
          </span>
          <span className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="size-1.5 rounded-full border border-text-3" />
            Planned, not made yet
          </span>
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-[#101010]">
          <div className="grid grid-cols-7 border-b border-border">
            {DOW.map((d) => (
              <span key={d} className="p-2 text-xs text-text-3">
                {d}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((d) => {
              const key = dateKey(d);
              const inMonth = d.getMonth() === cursor.m;
              return (
                <div
                  key={key}
                  data-testid="cal-cell"
                  data-date={key}
                  className={cn(
                    'flex min-h-[92px] min-w-0 flex-col gap-1 border-r border-b border-[#1F1F1F] p-1',
                    !inMonth && 'bg-[#0B0B0B]',
                  )}
                >
                  <span
                    className={cn(
                      'inline-flex h-6 min-w-6 items-center justify-center self-start rounded-sm font-mono text-xs tabular-nums',
                      key === todayKey ? 'bg-foreground text-ink' : inMonth ? 'text-text-2' : 'text-[#4A4A4A]',
                    )}
                  >
                    {d.getDate()}
                  </span>
                  {(events[key] ?? []).map(({ p, at }) => {
                    const ready = p.status === 'rendered' || p.status === 'scheduled';
                    return (
                      <div
                        key={p.id}
                        className={cn(
                          'flex min-w-0 flex-col gap-0.5 rounded-sm px-2 py-1 text-foreground',
                          ready ? 'bg-raised' : 'border border-dashed border-[#333]',
                        )}
                      >
                        <span className="flex items-center gap-1 font-mono text-[10px] text-text-3">
                          <span
                            aria-hidden="true"
                            className={cn('size-1.5 shrink-0 rounded-full', ready ? 'bg-primary' : 'border border-text-3')}
                          />
                          {pad(at.getHours())}:{pad(at.getMinutes())}
                        </span>
                        <span className="truncate text-[11px] font-medium">{p.title}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <aside className="flex max-w-[300px] flex-[1_1_260px] flex-col gap-4">
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">Ideas for this week</span>
            <span className="text-xs text-text-3">From what you make: explainers, promos</span>
          </div>
          {ideas.map((i) => (
            <div key={i.title} className="flex items-center gap-2 rounded-md bg-[#222] p-2">
              <div className="mr-auto flex min-w-0 flex-col gap-1">
                <span className="text-[13px] leading-[1.3] font-medium">{i.title}</span>
                <span className="text-xs text-text-3">
                  {i.kind[0]!.toUpperCase() + i.kind.slice(1)} · {i.lengthSec}s
                </span>
              </div>
              <Button variant="secondary" className="h-7 shrink-0 rounded-sm px-2 text-xs" onClick={() => navigate({ name: 'chat-new' })}>
                Make it
              </Button>
            </div>
          ))}
          {error && (
            <p role="alert" className="m-0 text-xs text-orange-light">
              {error}
            </p>
          )}
          <Button variant="secondary" className="h-9 self-start px-3 text-[13px]" disabled={asking} onClick={() => void getIdeas()}>
            {asking ? 'Asking your agent' : ideas.length ? 'Get new ideas' : 'Get ideas'}
          </Button>
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <Oyen mood="wink" size={40} />
            <div className="flex flex-col gap-1">
              <span className="font-mono text-[11px] font-medium tracking-[0.12em] text-primary">TAYANG AUTOPILOT</span>
              <span className="text-[15px] font-semibold">Biar Tayang yang tayangin</span>
            </div>
          </div>
          <span className="text-[13px] leading-[1.6] text-text-2">
            For now Tayang reminds you when it's time to post. With a tayang.app plan, it posts to TikTok, Reels and
            Shorts on schedule.
          </span>
          <Button className="h-9 self-start px-4 text-[13px]" onClick={() => void openUrl('https://tayang.app')}>
            See plans
          </Button>
        </div>
      </aside>
    </div>
  );
}
