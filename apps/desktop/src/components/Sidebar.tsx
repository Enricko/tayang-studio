import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, LayoutPanelLeft, MessageCircle, Palette, Plane, Plus, Smartphone, SlidersHorizontal } from 'lucide-react';
import type { Project } from '@tayang/shared';
import logo from '@/assets/brand/tayang-horizontal-reversed-color.svg';
import mark from '@/assets/brand/oyen-symbol-color.svg';
import ditherCard from '@/assets/brand/dither-card.png';
import { UsageBar, UsageRing } from '@/components/UsageBar';
import { Button } from '@/components/Button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { createChat, listChats, listProjects } from '@/lib/ipc';
import { useApp, type Route } from '@/state/app';
import { cn } from '@/lib/utils';

export type SidebarKey = 'chat' | 'videos' | 'style' | 'autopilot' | 'agents' | 'calendar' | 'settings';

const NAV: { key: SidebarKey; icon: typeof Calendar; route: Route }[] = [
  { key: 'chat', icon: MessageCircle, route: { name: 'chat-new' } },
  { key: 'videos', icon: Smartphone, route: { name: 'videos' } },
  { key: 'style', icon: Palette, route: { name: 'style' } },
  { key: 'autopilot', icon: Plane, route: { name: 'autopilot' } },
  { key: 'agents', icon: LayoutPanelLeft, route: { name: 'agents' } },
  { key: 'calendar', icon: Calendar, route: { name: 'calendar' } },
];

/** In the icon rail a control shows its name in a tooltip; in the full sidebar it shows it itself. */
function RailTip({ rail, label, children }: { rail: boolean; label: string; children: React.ReactElement }) {
  if (!rail) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function NavItem({
  active,
  label,
  icon: Icon,
  onClick,
  count,
  rail = false,
}: {
  active: boolean;
  label: string;
  icon: typeof Calendar;
  onClick: () => void;
  count?: number;
  rail?: boolean;
}) {
  return (
    <RailTip rail={rail} label={label}>
      <a
        href="#"
        role="link"
        aria-current={active ? 'page' : undefined}
        aria-label={rail ? label : undefined}
        onClick={(e) => {
          e.preventDefault();
          onClick();
        }}
        className={cn(
          'relative flex h-9 items-center rounded-md text-[14px] font-medium no-underline transition-colors',
          rail ? 'w-10 justify-center' : 'gap-3 px-3',
          active
            ? 'bg-raised text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
            : 'text-text-2 hover:bg-raised/50 hover:text-foreground',
        )}
      >
        <Icon size={18} strokeWidth={1.5} aria-hidden="true" className="shrink-0" />
        {!rail && <span className="truncate">{label}</span>}
        {count !== undefined &&
          (rail ? (
            <span aria-hidden="true" className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-primary" />
          ) : (
            <span className="ml-auto font-mono text-xs text-text-2">{count}</span>
          ))}
      </a>
    </RailTip>
  );
}

export function Sidebar({ active, collapsed = false }: { active: SidebarKey; collapsed?: boolean }) {
  const { t } = useTranslation();
  const navigate = useApp((s) => s.navigate);
  const needsYou = useApp((s) => s.needsYouCount);
  const version = useApp((s) => s.projectsVersion);
  const [recent, setRecent] = useState<Project[]>([]);

  useEffect(() => {
    let alive = true;
    listProjects()
      .then((p) => alive && setRecent(p.slice(0, 3)))
      .catch(() => alive && setRecent([]));
    return () => {
      alive = false;
    };
  }, [version]);

  // A project's chat: the latest one, or a fresh one when it has none yet.
  const openProject = async (p: Project) => {
    try {
      const chats = await listChats(p.id);
      const chat = chats[0] ?? (await createChat(p.id, useApp.getState().settings?.defaultAgent ?? 'claude', p.title));
      navigate({ name: 'chat', chatId: chat.id });
    } catch {
      /* stay where we are */
    }
  };

  const rail = collapsed;
  return (
    <TooltipProvider delayDuration={200}>
      <nav
        aria-label={t('sidebar.main')}
        data-collapsed={rail || undefined}
        className={cn(
          'flex h-full w-full flex-col overflow-hidden border-r border-border bg-sidebar pb-4 pt-4 text-foreground',
          rail ? 'items-center px-3' : 'px-3',
        )}
      >
        {rail ? (
          <div className="flex justify-center pb-5 pt-6" data-tauri-drag-region>
            <img src={mark} alt="Tayang" className="block size-7" />
          </div>
        ) : (
          <div className="flex items-center gap-2 px-2 pb-5 pt-6" data-tauri-drag-region>
            <img src={logo} alt="Tayang" className="block h-7 w-auto" />
            <span className="mt-1 text-[13px] text-text-3">{t('sidebar.studio')}</span>
          </div>
        )}

        <RailTip rail={rail} label={t('sidebar.newChat')}>
          <Button
            variant="secondary"
            aria-label={rail ? t('sidebar.newChat') : undefined}
            className={cn('mb-4', rail ? 'size-10 px-0' : 'w-full')}
            onClick={() => navigate({ name: 'chat-new' })}
          >
            <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
            {!rail && <span className="truncate">{t('sidebar.newChat')}</span>}
          </Button>
        </RailTip>

        <div className="flex flex-col gap-1">
          {NAV.map((n) => (
            <NavItem
              key={n.key}
              rail={rail}
              active={active === n.key}
              label={t(`sidebar.${n.key}` as 'sidebar.chat')}
              icon={n.icon}
              onClick={() => navigate(n.route)}
              count={n.key === 'agents' && needsYou > 0 ? needsYou : undefined}
            />
          ))}
        </div>

        {!rail && (
          <div className="mt-6 flex flex-col gap-1">
            <span className="px-3 pb-1 text-xs text-text-3">{t('sidebar.recent')}</span>
            {recent.map((p, i) => (
              <a
                key={p.id}
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  void openProject(p);
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
        )}

        <div className={cn('mt-auto flex flex-col gap-3', rail && 'items-center')}>
          <NavItem
            rail={rail}
            active={active === 'settings'}
            label={t('sidebar.settings')}
            icon={SlidersHorizontal}
            onClick={() => navigate({ name: 'settings' })}
          />
          {rail ? (
            <UsageRing />
          ) : (
            <div className="relative flex flex-col gap-2 overflow-hidden rounded-lg border border-border bg-background p-3">
              <img
                src={ditherCard}
                alt=""
                aria-hidden="true"
                className="pointer-events-none absolute right-0 top-0 h-12 w-[120px]"
                style={{ imageRendering: 'pixelated' }}
              />
              <UsageBar />
            </div>
          )}
        </div>
      </nav>
    </TooltipProvider>
  );
}
