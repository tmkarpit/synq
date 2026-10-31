import { Files, GitBranch, MessageSquare, Settings, Users } from 'lucide-react';
import { useUiStore } from '@/store/uiStore';
import { useRoomStore } from '@/store/roomStore';
import { cn } from '@/lib/cn';

function Item({ view, label, icon: Icon, badge }) {
  const active = useUiStore((s) => s.sidebarOpen && s.sidebarView === view);
  const setSidebarView = useUiStore((s) => s.setSidebarView);
  return (
    <button
      type="button"
      onClick={() => setSidebarView(view)}
      aria-label={badge ? `${label} (${badge})` : label}
      aria-pressed={active}
      title={label}
      className={cn(
        'relative flex h-10 w-10 items-center justify-center rounded-xl transition-colors duration-micro',
        active
          ? 'bg-ws-accent-soft text-[#B6A4FF]'
          : 'text-ws-muted hover:bg-ws-hover hover:text-ws-text',
      )}
    >
      <Icon size={19} strokeWidth={1.8} aria-hidden />
      {!!badge && (
        <span
          aria-hidden
          className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-ws-accent px-1 text-[9px] font-semibold leading-none text-white ring-2 ring-ws-panel"
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  );
}

/** Floating rail of views. */
export default function ActivityBar() {
  const peers = useRoomStore((s) => Object.keys(s.users).length);
  const requests = useRoomStore((s) => s.access.requests.length); // owner only
  const unread = useRoomStore((s) => s.unreadChat);
  const github = useRoomStore((s) => s.github !== undefined);
  const changes = useRoomStore((s) => s.scmChanges.length);
  return (
    <nav
      aria-label="Views"
      className="ws-card flex w-[52px] shrink-0 flex-col items-center gap-1.5 py-2"
    >
      <Item view="explorer" label="Files" icon={Files} />
      <Item
        view="participants"
        label={requests ? 'People: join requests' : 'People'}
        icon={Users}
        badge={requests || peers}
      />
      {github && (
        <Item view="scm" label="Source Control" icon={GitBranch} badge={changes} />
      )}
      <Item view="chat" label="Chat" icon={MessageSquare} badge={unread} />
      <div className="flex-1" />
      <Item view="settings" label="Settings" icon={Settings} />
    </nav>
  );
}
