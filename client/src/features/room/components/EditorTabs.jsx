import { X } from 'lucide-react';
import { useRoomStore } from '@/store/roomStore';
import { cn } from '@/lib/cn';
import { FileIcon } from './FileIcon';
import PresenceDots from './PresenceDots';
import RunButton from './RunButton';
import { GoLiveButton, SaveButton, TerminalButton } from './EditorActions';

function Tab({ fileId }) {
  const name = useRoomStore((s) => s.nodes[fileId]?.name);
  const active = useRoomStore((s) => s.activeFileId === fileId);
  const dirty = useRoomStore((s) => Boolean(s.dirty[fileId]));
  const openFile = useRoomStore((s) => s.openFile);
  const closeTab = useRoomStore((s) => s.closeTab);
  if (!name) return null;

  return (
    <div
      role="tab"
      aria-selected={active}
      tabIndex={0}
      onClick={() => openFile(fileId)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && openFile(fileId)}
      onAuxClick={(e) => e.button === 1 && closeTab(fileId)}
      className={cn(
        'group relative flex h-8 min-w-0 max-w-[220px] shrink-0 cursor-pointer items-center gap-1.5 rounded-lg pl-2.5 pr-1 text-[12.5px] outline-none transition-colors duration-micro',
        'focus-visible:ring-1 focus-visible:ring-ws-accent',
        active
          ? 'bg-ws-editor text-ws-text shadow-[0_0_0_1px_var(--ws-border),0_6px_14px_-10px_rgba(0,0,0,0.9)]'
          : 'text-ws-muted hover:bg-ws-hover hover:text-ws-text',
      )}
    >
      <FileIcon name={name} size={15} />
      <span className={cn('truncate', active && 'font-medium')}>{name}</span>
      {active && (
        <span
          aria-hidden
          className="absolute inset-x-3 -bottom-[5px] h-[2px] rounded-full bg-ws-accent"
        />
      )}
      <PresenceDots fileId={fileId} className="ml-0.5" />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          closeTab(fileId);
        }}
        aria-label={dirty ? `Close ${name} (unsaved changes)` : `Close ${name}`}
        title={dirty ? 'Unsaved changes (Ctrl+S to save)' : 'Close'}
        className={cn(
          'group/close ml-0.5 flex h-5 w-5 items-center justify-center rounded-md hover:bg-white/10',
          active || dirty
            ? 'opacity-100'
            : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
        )}
      >
        {/* Like VS Code: a dot while unsaved, the X when hovered. */}
        {dirty && (
          <span aria-hidden className="h-2 w-2 rounded-full bg-current group-hover/close:hidden" />
        )}
        <X size={13} aria-hidden className={cn(dirty && 'hidden group-hover/close:block')} />
      </button>
    </div>
  );
}

export default function EditorTabs() {
  const openTabs = useRoomStore((s) => s.openTabs);
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-ws-border px-2">
      <div
        role="tablist"
        aria-label="Open files"
        className="ws-scroll flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden py-2"
      >
        {openTabs.map((id) => (
          <Tab key={id} fileId={id} />
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-1.5 pr-1">
        <GoLiveButton />
        <TerminalButton />
        <SaveButton />
        <RunButton />
      </div>
    </div>
  );
}
