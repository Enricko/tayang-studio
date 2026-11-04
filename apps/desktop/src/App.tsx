import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/Button';
import { Sidebar, type SidebarKey } from '@/components/Sidebar';
import { getSettings, syncStyles } from '@/lib/ipc';
import { useWindowDrag } from '@/lib/windowDrag';
import { Agents } from '@/screens/Agents';
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
import { refreshJobs } from '@/state/jobs';

const ONBOARDING = new Set<Route['name']>(['welcome', 'connect', 'requirements']);

const SIDEBAR_KEY: Partial<Record<Route['name'], SidebarKey>> = {
  'chat-new': 'chat',
  chat: 'chat',
  videos: 'videos',
  style: 'style',
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
  useWindowDrag();

  const [loadError, setLoadError] = useState(false);

  // First launch decides where to start: onboarded users go straight to a new chat.
  const load = useCallback(() => {
    setLoadError(false);
    getSettings()
      .then((st) => {
        useApp.getState().setSettings(st);
        // Built-in styles in the background, like the install ping: never blocks, failures are ignored.
        void Promise.resolve()
          .then(syncStyles)
          .catch(() => {});
        if (st.onboarded) {
          useApp.getState().navigate({ name: 'chat-new' });
          void refreshJobs().catch(() => {});
        }
      })
      .catch(() => setLoadError(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!settings) {
    return (
      <div data-tauri-drag-region className="flex h-full flex-col items-center justify-center gap-4 bg-background">
        {loadError && (
          <>
            <p className="m-0 text-sm text-text-2">Tayang couldn't load your settings.</p>
            <Button variant="secondary" onClick={load}>
              Try again
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
  return (
    <div className="flex h-full bg-background">
      <div className="h-full w-[232px] shrink-0">
        <Sidebar active={SIDEBAR_KEY[route.name] ?? 'chat'} />
      </div>
      <main className="relative min-w-0 flex-1">
        {route.name === 'chat-new' ? (
          <ChatNew key="chat-new" />
        ) : route.name === 'chat' ? (
          <ChatProject key={route.chatId} chatId={route.chatId} />
        ) : route.name === 'videos' ? (
          <Videos />
        ) : route.name === 'style' ? (
          <Style />
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
