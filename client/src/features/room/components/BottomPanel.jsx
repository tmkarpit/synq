import { ChevronDown, ListTree, ScrollText, SquareTerminal, Trash2 } from 'lucide-react';
import { useUiStore } from '@/store/uiStore';
import { useRoomStore } from '@/store/roomStore';
import Spinner from '@/components/ui/Spinner';
import IconButton from '@/components/ui/IconButton';
import TerminalPanel from '@/features/terminal/TerminalPanel';
import { cn } from '@/lib/cn';

const TABS = [
  { id: 'terminal', label: 'Console', icon: SquareTerminal },
  { id: 'output', label: 'Run history', icon: ScrollText },
  { id: 'problems', label: 'Problems', icon: ListTree },
];

function RunChips() {
  const active = useRoomStore((s) => s.run.active);
  const last = useRoomStore((s) => s.run.last);
  const color = useRoomStore((s) =>
    active ? s.getUser(active.userId)?.color || active.color : null,
  );
  return (
    <div className="flex items-center gap-1.5 text-[11px]" aria-live="polite">
      {active ? (
        <span
          className="flex items-center gap-1.5 rounded-full border px-2 py-[1px]"
          style={{ borderColor: color || '#0078D4', color: color || '#CCCCCC' }}
          title={`${active.username} is running ${active.path || ''}`}
        >
          <Spinner size={10} /> Running · {active.username}
        </span>
      ) : (
        <span className="flex items-center gap-1.5 rounded-full border border-ws-border px-2 py-[1px] text-ws-muted">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[#6E7681]" /> Idle
        </span>
      )}
      {last?.username && <span className="text-ws-muted">last run by {last.username}</span>}
    </div>
  );
}

function OutputView() {
  const runs = useRoomStore((s) => s.runs);
  if (!runs.length)
    return (
      <p className="px-5 py-2 text-[12px] text-ws-muted">
        No runs yet. Output from every collaborator&apos;s runs appears here.
      </p>
    );
  return (
    <div className="ws-scroll h-full overflow-y-auto px-5 py-2 font-code text-[12px] leading-[18px]">
      {runs.map((r) => (
        <section key={r.runId} className="mb-3">
          <p className="text-ws-muted">
            [{r.startedAt ? new Date(r.startedAt).toLocaleTimeString() : 'run'}] {r.username} ran{' '}
            {r.path}
            {r.exitCode !== undefined &&
              ` · exit ${r.exitCode ?? 'n/a'}${r.durationMs != null ? ` · ${r.durationMs}ms` : ''}`}
          </p>
          <pre className="whitespace-pre-wrap break-words">
            {r.output.map((o, i) => (
              <span key={i} className={o.stream === 'stderr' ? 'text-[#F14C4C]' : 'text-ws-text'}>
                {o.text}
              </span>
            ))}
          </pre>
        </section>
      ))}
    </div>
  );
}

export default function BottomPanel() {
  const tab = useUiStore((s) => s.bottomTab);
  const setBottomTab = useUiStore((s) => s.setBottomTab);
  const setBottomPanelOpen = useUiStore((s) => s.setBottomPanelOpen);
  const open = useUiStore((s) => s.bottomPanelOpen);

  return (
    <section aria-label="Panel" className="flex h-full flex-col bg-ws-panel">
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-ws-border px-2.5">
        <div role="tablist" className="flex items-center gap-0.5 rounded-lg bg-ws-canvas p-0.5">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              role="tab"
              type="button"
              aria-selected={tab === id}
              onClick={() => setBottomTab(id)}
              className={cn(
                'flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition-colors duration-micro',
                tab === id
                  ? 'bg-ws-hover text-ws-text shadow-[0_0_0_1px_var(--ws-border)]'
                  : 'text-ws-muted hover:text-ws-text',
              )}
            >
              <Icon size={13} aria-hidden />
              {label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <RunChips />
        {tab === 'output' && (
          <IconButton
            label="Clear output"
            size="sm"
            onClick={() => useRoomStore.setState({ runs: [] })}
          >
            <Trash2 size={14} aria-hidden />
          </IconButton>
        )}
        <IconButton label="Hide panel" size="sm" onClick={() => setBottomPanelOpen(false)}>
          <ChevronDown size={15} aria-hidden />
        </IconButton>
      </div>
      <div className="relative min-h-0 flex-1">
        {tab === 'problems' && (
          <p className="px-5 py-2 text-[12px] text-ws-muted">
            No problems have been detected in the workspace.
          </p>
        )}
        {tab === 'output' && <OutputView />}
        {/* The terminal stays mounted (just hidden) so its scrollback and prompt survive tab switches. */}
        <div className={cn('absolute inset-0', tab !== 'terminal' && 'invisible')}>
          <TerminalPanel visible={open && tab === 'terminal'} />
        </div>
      </div>
    </section>
  );
}
