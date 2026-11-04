import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button';
import { ResizeHandle } from '@/components/ResizeHandle';
import { Sidebar, type SidebarKey } from '@/components/Sidebar';
import { setUiLanguage } from '@/i18n';
import { systemLanguage } from '@/lib/language';
import { getSettings, syncStyles, updateSettings } from '@/lib/ipc';
import { runBillingReminder } from '@/lib/billingReminder';
import { onTick, startScheduler } from '@/lib/scheduler';
import { recheckDoneBuildJobs, settleLateRenders } from '@/lib/buildJobs';
import { backfillProjectStatus } from '@/lib/projectStatus';
import { startAutopilot } from '@/state/autopilot';
import { useWindowDrag } from '@/lib/windowDrag';
import { Agents } from '@/screens/Agents';
import { Autopilot } from '@/screens/Autopilot';
import { AutopilotWizard } from '@/screens/AutopilotWizard';
import { Calendar } from '@/screens/Calendar';
import { ChatNew } from '@/screens/ChatNew';
import { ChatProject } from '@/screens/ChatProject';
import { Settings } from '@/screens/Settings';
import { Style } from '@/screens/Style';
import { Videos } from '@/screens/Videos';
import { Connect } from '@/screens/onboarding/Connect';
import { Requirements } from '@/screens/onboarding/Requirements';
import { Welcome } from '@/screens/onboarding/Welcome';
import { useApp, type Route } from '@/state/app';
import { SIDEBAR, useFittedLayout, useLayout, useSidebarShortcut, useWindowWidthSync } from '@/state/layout';
import { refreshJobs } from '@/state/jobs';

const ONBOARDING = new Set<Route['name']>(['welcome', 'connect', 'requirements']);

const SIDEBAR_KEY: Partial<Record<Route['name'], SidebarKey>> = {
  'chat-new': 'chat',
  chat: 'chat',
  videos: 'videos',
  style: 'style',
  autopilot: 'autopilot',
  'autopilot-wizard': 'autopilot',
  agents: 'agents',
  calendar: 'calendar',
  settings: 'settings',
};

function Onboarding({ name }: { name: Route['name'] }) {
  if (name === 'connect') return <Connect />;
  if (name === 'requirements') return <Requirements />;
  return <Welcome />;
}

export default function App() {
  const route = useApp((s) => s.route);
  const settings = useApp((s) => s.settings);
  const { t } = useTranslation();
  useWindowDrag();

  const [loadError, setLoadError] = useState(false);

  // First launch decides where to start: onboarded users go straight to a new chat.
  const load = useCallback(() => {
    setLoadError(false);
    getSettings()
      .then(async (st) => {
        // First run has no saved language: follow the system's. The language is set before the settings
        // so the first paint is already in it, and the store has it even if saving it fails.
        const lang = st.uiLanguage ?? (await systemLanguage());
        setUiLanguage(lang);
        useApp.getState().setSettings(st.uiLanguage ? st : { ...st, uiLanguage: lang });
        if (!st.uiLanguage) {
          void Promise.resolve()
            .then(() => updateSettings({ uiLanguage: lang }))
            // The user may have picked a language on Welcome meanwhile: that choice stands.
            .then((next) => next && useApp.getState().settings?.uiLanguage === lang && useApp.getState().setSettings(next))
            .catch(() => {});
        }
        // Built-in styles in the background, like the install ping: never blocks, failures are ignored.
        void Promise.resolve()
          .then(syncStyles)
          .catch(() => {});
        if (st.onboarded) {
          useApp.getState().navigate({ name: 'chat-new' });
          void refreshJobs().catch(() => {});
          // Once per install: old build jobs marked done without a video go back to needs-you.
          void recheckDoneBuildJobs(st.buildJobsChecked);
          // Once per install: projects made before their status moved on its own catch up.
          void backfillProjectStatus(st.projectStatusChecked);
        }
      })
      .catch(() => setLoadError(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Once set up, the scheduler listens for the Rust tick (reminders and the autopilot engine). The engine
  // registers first, so the scheduler's first pass already runs it.
  const onboarded = settings?.onboarded ?? false;
  useEffect(() => {
    if (!onboarded) return;
    let off: (() => void) | undefined;
    let gone = false;
    const stopEngine = startAutopilot();
    // Startup and every tick: build jobs whose video arrived late become done.
    const stopLate = onTick(() => settleLateRenders());
    // "Your plan ends in 3 days", once per period.
    const stopPlanReminder = onTick((now) => runBillingReminder(now));
    startScheduler()
      .then((un) => (gone ? un() : (off = un)))
      .catch(() => {});
    return () => {
      gone = true;
      off?.();
      stopEngine();
      stopLate();
      stopPlanReminder();
    };
  }, [onboarded]);

  if (!settings) {
    return (
      <div data-tauri-drag-region className="flex h-full flex-col items-center justify-center gap-4 bg-background">
        {loadError && (
          <>
            <p className="m-0 text-sm text-text-2">{t('app.settingsFailed')}</p>
            <Button variant="secondary" onClick={load}>
              {t('common.tryAgain')}
            </Button>
          </>
        )}
      </div>
    );
  }

  if (ONBOARDING.has(route.name)) {
    return (
      <div className="h-full overflow-y-auto bg-background">
        <Onboarding name={route.name} />
      </div>
    );
  }
  return <Shell route={route} />;
}

/** Below the snap point a drag collapses the sidebar to its rail; above it, it opens at that width. */
function resizeSidebar(width: number, max: number, live?: boolean) {
  const layout = useLayout.getState();
  if (width < SIDEBAR.snap) return layout.setCollapsed(true, live);
  layout.setCollapsed(false, true);
  layout.setSidebar(Math.min(width, max), live);
}

/** The app around a screen: the resizable sidebar and the main column. */
function Shell({ route }: { route: Route }) {
  const { t } = useTranslation();
  // Only the project chat has the preview panel; the sidebar's room depends on it.
  const fitted = useFittedLayout(route.name === 'chat');
  useWindowWidthSync();
  useSidebarShortcut();

  return (
    <div className="flex h-full bg-background">
      <div id="app-sidebar" className="relative h-full shrink-0" style={{ width: fitted.sidebar }}>
        <Sidebar active={SIDEBAR_KEY[route.name] ?? 'chat'} collapsed={fitted.collapsed} />
        <ResizeHandle
          label={t('layout.resizeSidebar')}
          side="right"
          aria-controls="app-sidebar"
          value={fitted.sidebar}
          min={SIDEBAR.min}
          ariaMin={SIDEBAR.rail}
          max={fitted.sidebarMax}
          onResize={(w, live) => resizeSidebar(w, fitted.sidebarMax, live)}
          onReset={() => useLayout.getState().resetSidebar()}
          onToggle={() => useLayout.getState().toggleCollapsed()}
        />
      </div>
      <main className="relative min-w-0 flex-1">
        {route.name === 'chat-new' ? (
          <ChatNew key="chat-new" />
        ) : route.name === 'chat' ? (
          <ChatProject key={route.chatId} chatId={route.chatId} draft={route.draft} />
        ) : route.name === 'videos' ? (
          <Videos />
        ) : route.name === 'style' ? (
          <Style />
        ) : route.name === 'autopilot' ? (
          <Autopilot key={route.id ?? 'list'} id={route.id} />
        ) : route.name === 'autopilot-wizard' ? (
          <AutopilotWizard key={route.id ?? 'new'} id={route.id} />
        ) : route.name === 'agents' ? (
          <Agents />
        ) : route.name === 'calendar' ? (
          <Calendar />
        ) : (
          <Settings />
        )}
      </main>
    </div>
  );
}
