import { Fragment } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Braces } from 'lucide-react';
import { useRoomStore } from '@/store/roomStore';
import { FileIcon } from './FileIcon';

/** Path of the open file ("src / App.jsx / App") and who else is in it. */
export default function Breadcrumbs() {
  const nodes = useRoomStore((s) => s.nodes);
  const activeFileId = useRoomStore((s) => s.activeFileId);
  const symbol = useRoomStore((s) => s.symbol);
  const here = useRoomStore(
    useShallow((s) =>
      Object.values(s.users).filter((u) => u.fileId && u.fileId === s.activeFileId),
    ),
  );
  if (!activeFileId || !nodes[activeFileId]) return <div className="h-8 shrink-0 bg-ws-editor" />;

  const chain = [];
  let node = nodes[activeFileId];
  while (node) {
    chain.unshift(node);
    node = node.parentId ? nodes[node.parentId] : null;
  }
  const file = chain[chain.length - 1];

  return (
    <div className="flex h-8 shrink-0 items-center gap-3 bg-ws-editor pl-4 pr-3">
      <nav
        aria-label="Breadcrumbs"
        className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-[12px] text-ws-muted"
      >
        <FileIcon name={file.name} size={14} />
        {chain.map((n, i) => (
          <Fragment key={n.id}>
            {i > 0 && (
              <span aria-hidden className="text-ws-border">
                /
              </span>
            )}
            <span className={i === chain.length - 1 ? 'shrink-0 text-ws-text' : 'shrink-0'}>
              {n.name}
            </span>
          </Fragment>
        ))}
        {symbol && (
          <>
            <span aria-hidden className="text-ws-border">
              /
            </span>
            <span className="flex min-w-0 items-center gap-1 rounded-md bg-ws-accent-soft px-1.5 py-px text-[#B6A4FF]">
              <Braces size={11} className="shrink-0" aria-hidden />
              <span className="truncate">{symbol}</span>
            </span>
          </>
        )}
      </nav>
      {here.length > 0 && (
        <div
          className="flex shrink-0 items-center gap-1.5 text-[11px] text-ws-muted"
          aria-label="Also in this file"
        >
          {here.slice(0, 3).map((u) => (
            <span
              key={u.userId}
              className="flex items-center gap-1 rounded-full py-px pl-1 pr-2"
              style={{ background: `${u.color}1A`, color: u.color }}
            >
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: u.color }}
              />
              {u.username}
            </span>
          ))}
          {here.length > 3 && <span>+{here.length - 3}</span>}
          <span>{here.length === 1 ? 'is here' : 'are here'}</span>
        </div>
      )}
    </div>
  );
}
