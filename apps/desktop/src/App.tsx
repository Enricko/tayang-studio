import { Sidebar, type SidebarKey } from '@/components/Sidebar';
import { useApp, type Route } from '@/state/app';

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

const TITLES: Record<Route['name'], string> = {
  welcome: 'Welcome',
  connect: 'Connect your agent',
  requirements: 'Requirements',
  'chat-new': 'New chat',
  chat: 'Chat',
  videos: 'Videos',
  style: 'Style',
  agents: 'Agents',
  calendar: 'Calendar',
  settings: 'Settings',
};

function Placeholder({ name }: { name: Route['name'] }) {
  return (
    <div className="flex h-full items-center justify-center">
      <h1 className="text-xl font-semibold">{TITLES[name]}</h1>
    </div>
  );
}

export default function App() {
  const route = useApp((s) => s.route);
  if (ONBOARDING.has(route.name)) {
    return (
      <div className="h-full bg-background">
        <Placeholder name={route.name} />
      </div>
    );
  }
  return (
    <div className="flex h-full bg-background">
      <div className="h-full w-[232px] shrink-0">
        <Sidebar active={SIDEBAR_KEY[route.name] ?? 'chat'} />
      </div>
      <main className="min-w-0 flex-1">
        <Placeholder name={route.name} />
      </main>
    </div>
  );
}
