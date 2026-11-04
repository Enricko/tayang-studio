import { useEffect, useState } from 'react';
import { Calendar, LayoutPanelLeft, MessageCircle, Palette, Plus, Smartphone, SlidersHorizontal } from 'lucide-react';
import type { Project } from '@tayang/shared';
import logo from '@/assets/brand/tayang-horizontal-reversed-color.svg';
import ditherCard from '@/assets/brand/dither-card.png';
import { Oyen } from '@/components/Oyen';
import { Button } from '@/components/Button';
import { listProjects } from '@/lib/ipc';
import { useApp, type Route } from '@/state/app';
import { cn } from '@/lib/utils';

export type SidebarKey = 'chat' | 'videos' | 'style' | 'agents' | 'calendar' | 'settings';

const NAV: { key: SidebarKey; label: string; icon: typeof Calendar; route: Route }[] = [
  { key: 'chat', label: 'Chat', icon: MessageCircle, route: { name: 'chat-new' } },
  { key: 'videos', label: 'Videos', icon: Smartphone, route: { name: 'videos' } },
  { key: 'style', label: 'Style', icon: Palette, route: { name: 'style' } },
  { key: 'agents', label: 'Agents', icon: LayoutPanelLeft, route: { name: 'agents' } },
  { key: 'calendar', label: 'Calendar', icon: Calendar, route: { name: 'calendar' } },
];

function NavItem({
  active,
  label,
  icon: Icon,
  onClick,
  count,
}: {
  active: boolean;
  label: string;
  icon: typeof Calendar;
  onClick: () => void;
  count?: number;
}) {
  return (
    <a
      href="#"
      role="link"
      aria-current={active ? 'page' : undefined}
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
      className={cn(
        'flex h-9 items-center gap-3 rounded-md px-3 text-[14px] font-medium no-underline transition-colors',
        active
          ? 'bg-raised text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
          : 'text-text-2 hover:bg-raised/50 hover:text-foreground',
      )}
    >
      <Icon size={18} strokeWidth={1.5} aria-hidden="true" />
      {label}
      {count !== undefined && <span className="ml-auto font-mono text-xs text-text-2">{count}</span>}
    </a>
  );
}

export function Sidebar({ active }: { active: SidebarKey }) {
  const navigate = useApp((s) => s.navigate);
  const needsYou = useApp((s) => s.needsYouCount);
  const [recent, setRecent] = useState<Project[]>([]);

  useEffect(() => {
    let alive = true;
    listProjects()
      .then((p) => alive && setRecent(p.slice(0, 3)))
      .catch(() => alive && setRecent([]));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <nav
      aria-label="Main"
      className="flex h-full w-full flex-col border-r border-border bg-sidebar px-3 pb-4 pt-4 text-foreground"
    >
      <div className="flex items-center gap-2 px-2 pb-5 pt-6" data-tauri-drag-region>
        <img src={logo} alt="Tayang" className="block h-7 w-auto" />
        <span className="mt-1 text-[13px] text-text-3">Studio</span>
      </div>

      <Button variant="secondary" className="mb-4 w-full" onClick={() => navigate({ name: 'chat-new' })}>
        <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
        New chat
      </Button>

      <div className="flex flex-col gap-1">
        {NAV.map((n) => (
          <NavItem
            key={n.key}
            active={active === n.key}
            label={n.label}
            icon={n.icon}
            onClick={() => navigate(n.route)}
            count={n.key === 'agents' && needsYou > 0 ? needsYou : undefined}
          />
        ))}
      </div>

      <div className="mt-6 flex flex-col gap-1">
        <span className="px-3 pb-1 text-xs text-text-3">Recent</span>
        {recent.map((p, i) => (
          <a
            key={p.id}
            href="#"
            onClick={(e) => {
              e.preventDefault();
              navigate({ name: 'chat', chatId: p.id });
            }}
            className="flex h-8 items-center gap-2 rounded-md px-3 text-[13px] text-[#D9D9D9] no-underline hover:bg-raised/50"
          >
            <span
              aria-hidden="true"
              className={cn('size-1.5 shrink-0 rounded-full', i === 0 ? 'bg-primary' : 'bg-[#4A4A4A]')}
            />
            <span className="truncate">{p.title}</span>
          </a>
        ))}
      </div>

      <div className="mt-auto flex flex-col gap-3">
        <NavItem
          active={active === 'settings'}
          label="Settings"
          icon={SlidersHorizontal}
          onClick={() => navigate({ name: 'settings' })}
        />
        <div className="relative flex flex-col gap-2 overflow-hidden rounded-lg border border-border bg-background p-3">
          <img
            src={ditherCard}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute right-0 top-0 h-12 w-[120px]"
            style={{ imageRendering: 'pixelated' }}
          />
          <div className="relative flex items-center gap-2">
            <Oyen mood="sleepy" size={28} />
            <div className="flex min-w-0 flex-col">
              <span className="text-[13px] font-medium">Claude Code</span>
              <span className="text-xs text-text-2">Working · via ACP</span>
            </div>
          </div>
          <span className="relative text-xs text-text-3">Free plan</span>
        </div>
      </div>
    </nav>
  );
}
