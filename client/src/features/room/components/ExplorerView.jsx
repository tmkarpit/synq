import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Download,
  FilePlus,
  FolderPlus,
  Github,
  ListCollapse,
  MoreHorizontal,
  Pencil,
  Radio,
  Trash2,
} from 'lucide-react';
import { useRoomStore } from '@/store/roomStore';
import { validateNodeName } from '@/config/languages';
import { CLIENT_EVENTS, canManageFiles } from '@/services/collab';
import { buildTree, createNode, deleteNode, renameNode } from '@/services/collab/workspaceDoc';
import { useRoom } from '@/features/room/RoomContext';
import { downloadProject } from '@/features/room/downloadProject';
import { isHtml, openLive } from '@/features/room/liveActions';
import { cn } from '@/lib/cn';
import { FileIcon, FolderIcon } from './FileIcon';
import PresenceDots from './PresenceDots';
import GitHubDialog from './GitHubDialog';

const ROW =
  'mx-1.5 flex h-[26px] w-[calc(100%-12px)] items-center gap-1.5 rounded-md pr-2 text-left text-[13px] outline-none';
const INDENT = 8;
const BASE_PAD = 8;

function NewNodeInput({ type, depth, siblings, onDone: onDoneProp, initial = '' }) {
  const [value, setValue] = useState(initial);
  const [touched, setTouched] = useState(false);
  const ref = useRef(null);
  const settled = useRef(false);
  const error = validateNodeName(value, { type, siblings });
  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    input.focus();
    // Renaming a file selects the name without the extension, like VS Code.
    const dot = type === 'file' ? initial.lastIndexOf('.') : -1;
    input.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [type, initial]);

  // Enter unmounts the input, which can fire blur too: settle exactly once.
  const onDone = (name) => {
    if (settled.current) return;
    settled.current = true;
    onDoneProp(name);
  };

  const commit = () => {
    setTouched(true);
    if (!value.trim()) return onDone(null);
    if (error) return undefined;
    return onDone(value.trim());
  };

  return (
    <div style={{ paddingLeft: BASE_PAD + depth * INDENT + 18 }} className="relative pr-2">
      <div className="flex h-[22px] items-center gap-1.5">
        {type === 'folder' ? <FolderIcon name={value} /> : <FileIcon name={value} />}
        <input
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') onDone(null);
          }}
          onBlur={() => onDone(!error && value.trim() ? value.trim() : null)}
          aria-label={initial ? `Rename ${initial}` : `New ${type} name`}
          aria-invalid={touched && !!error}
          className="h-[20px] min-w-0 flex-1 border border-ws-accent bg-ws-editor px-1 text-[13px] text-ws-text outline-none"
          spellCheck={false}
        />
      </div>
      {value && error && (
        <p className="absolute left-6 right-2 z-10 border border-[#BE1100] bg-[#5A1D1D] px-1.5 py-1 text-[12px] text-ws-text">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Folders the terminal keeps on the server only (node_modules, .git, ...), added to the
 * tree from the server's list. They are read-only and load one level at a time.
 */
function withServerDirs(tree, dirs) {
  if (!dirs?.length) return tree;
  const clone = (list) => list.map((n) => (n.children ? { ...n, children: clone(n.children) } : n));
  const root = clone(tree);
  for (const dirPath of dirs) {
    const parts = dirPath.split('/');
    const name = parts.pop();
    let level = root;
    for (const part of parts) {
      level = level.find((n) => n.type === 'folder' && !n.server && n.name === part)?.children;
      if (!level) break;
    }
    if (!level || level.some((n) => n.name === name)) continue;
    level.push({ id: `server:${dirPath}`, name, type: 'folder', server: true, path: dirPath });
    level.sort((a, b) =>
      a.type === b.type
        ? a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
        : a.type === 'folder'
          ? -1
          : 1,
    );
  }
  return root;
}

function ServerEntry({ name, path, type, depth, top = false }) {
  const { service } = useRoom();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState({ entries: null, error: null, truncated: false });
  const isFolder = type === 'folder';

  const toggle = async () => {
    if (!isFolder) return;
    const next = !open;
    setOpen(next);
    if (!next) return;
    // Asked again on every open, so a fresh npm install shows up.
    const res = await service.request(CLIENT_EVENTS.shellList, { path });
    setList(
      res.error
        ? { entries: [], error: res.error }
        : { entries: res.entries, truncated: res.truncated },
    );
  };

  return (
    <li role="treeitem" aria-expanded={isFolder ? open : undefined} aria-readonly="true">
      <button
        type="button"
        onClick={toggle}
        title={
          top
            ? `${name} is kept on the server (read-only). Commands in the terminal can use it.`
            : 'On the server (read-only)'
        }
        className={cn(ROW, 'text-ws-muted hover:bg-ws-hover', !isFolder && 'cursor-default')}
        style={{ paddingLeft: BASE_PAD + depth * INDENT }}
      >
        <span className="flex w-4 shrink-0 justify-center">
          {isFolder &&
            (open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />)}
        </span>
        {isFolder ? <FolderIcon name={name} open={open} /> : <FileIcon name={name} />}
        <span className="min-w-0 flex-1 truncate">{name}</span>
        {top && (
          <span className="shrink-0 rounded bg-ws-hover px-1.5 text-[10px] uppercase tracking-wide">
            server
          </span>
        )}
      </button>
      {isFolder && open && (
        <ul role="group" className="relative">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 w-px bg-[#585858]/40"
            style={{ left: BASE_PAD + depth * INDENT + 7 }}
          />
          {list.entries === null && (
            <li
              className="py-1 text-[12px] text-ws-muted"
              style={{ paddingLeft: BASE_PAD + (depth + 1) * INDENT + 22 }}
            >
              Loading...
            </li>
          )}
          {list.error && (
            <li
              className="py-1 text-[12px] text-ws-muted"
              style={{ paddingLeft: BASE_PAD + (depth + 1) * INDENT + 22 }}
            >
              {list.error}
            </li>
          )}
          {list.entries?.map((e) => (
            <ServerEntry
              key={e.name}
              name={e.name}
              type={e.type}
              path={`${path}/${e.name}`}
              depth={depth + 1}
            />
          ))}
          {list.truncated && (
            <li
              className="py-1 text-[12px] text-ws-muted"
              style={{ paddingLeft: BASE_PAD + (depth + 1) * INDENT + 22 }}
            >
              ...and more
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

function TreeNode({ node, depth, creating, onCreate, onMenu, onDelete }) {
  if (node.server)
    return <ServerEntry name={node.name} path={node.path} type="folder" depth={depth} top />;
  return (
    <ProjectNode
      node={node}
      depth={depth}
      creating={creating}
      onCreate={onCreate}
      onMenu={onMenu}
      onDelete={onDelete}
    />
  );
}

function ProjectNode({ node, depth, creating, onCreate, onMenu, onDelete }) {
  const { service } = useRoom();
  const renaming = useRoomStore((s) => s.renamingId === node.id);
  const editable = useRoomStore((s) => canManageFiles(s.self, s.settings));
  const expanded = useRoomStore((s) => !!s.expanded[node.id]);
  const active = useRoomStore((s) => s.activeFileId === node.id);
  const toggleFolder = useRoomStore((s) => s.toggleFolder);
  const openFile = useRoomStore((s) => s.openFile);
  const isFolder = node.type === 'folder';

  const finishRename = (name) => {
    useRoomStore.getState().setRenaming(null);
    if (name) renameNode(service.doc, node.id, name);
  };
  const siblings = () =>
    Object.values(useRoomStore.getState().nodes)
      .filter((n) => n.parentId === node.parentId && n.id !== node.id)
      .map((n) => n.name);

  return (
    <li role="treeitem" aria-expanded={isFolder ? expanded : undefined} aria-selected={active}>
      {renaming ? (
        <div style={{ marginLeft: 10 }}>
          <NewNodeInput
            type={node.type}
            depth={depth}
            siblings={siblings()}
            initial={node.name}
            onDone={finishRename}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => (isFolder ? toggleFolder(node.id) : openFile(node.id))}
          onContextMenu={(e) => {
            e.preventDefault();
            onMenu({ x: e.clientX, y: e.clientY, node });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Delete') {
              e.preventDefault();
              onDelete(node);
            } else if (e.key === 'F2' && editable) {
              e.preventDefault();
              useRoomStore.getState().setRenaming(node.id);
            }
          }}
          className={cn(
            ROW,
            'focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-ws-accent',
            active ? 'bg-ws-accent-soft text-white' : 'text-ws-text hover:bg-ws-hover',
          )}
          style={{ paddingLeft: BASE_PAD + depth * INDENT }}
        >
          <span className="flex w-4 shrink-0 justify-center text-ws-text">
            {isFolder &&
              (expanded ? (
                <ChevronDown size={14} aria-hidden />
              ) : (
                <ChevronRight size={14} aria-hidden />
              ))}
          </span>
          {isFolder ? (
            <FolderIcon name={node.name} open={expanded} />
          ) : (
            <FileIcon name={node.name} />
          )}
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          {!isFolder && <PresenceDots fileId={node.id} />}
        </button>
      )}
      {isFolder && expanded && (
        <ul role="group" className="relative">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 w-px bg-[#585858]/40"
            style={{ left: BASE_PAD + depth * INDENT + 7 }}
          />
          {creating?.parentId === node.id && (
            <NewNodeInput
              type={creating.type}
              depth={depth + 1}
              siblings={node.children.map((c) => c.name)}
              onDone={onCreate}
            />
          )}
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              creating={creating}
              onCreate={onCreate}
              onMenu={onMenu}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function ExplorerView() {
  const { service } = useRoom();
  const roomId = useRoomStore((s) => s.roomId);
  const nodes = useRoomStore((s) => s.nodes);
  const editable = useRoomStore((s) => canManageFiles(s.self, s.settings));
  const activeFileId = useRoomStore((s) => s.activeFileId);
  const collapseAll = useRoomStore((s) => s.collapseAll);
  const loaded = useRoomStore((s) => !!s.self);
  const [rootOpen, setRootOpen] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [creating, setCreating] = useState(null); // { type, parentId }
  const [contextMenu, setContextMenu] = useState(null); // { x, y, node }
  const [githubOpen, setGithubOpen] = useState(false);
  const githubAvailable = useRoomStore((s) => s.github !== undefined);
  const serverDirs = useRoomStore((s) => s.shell.serverDirs);
  const tree = useMemo(() => withServerDirs(buildTree(nodes), serverDirs), [nodes, serverDirs]);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = (e) => !menuRef.current?.contains(e.target) && setMenuOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menuOpen]);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const close = (e) => (e.type !== 'keydown' || e.key === 'Escape') && setContextMenu(null);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', close);
      window.removeEventListener('blur', close);
    };
  }, [contextMenu]);

  // New items go into the given folder, else the active file's folder, like VS Code.
  const startCreate = (type, parentId = nodes[activeFileId]?.parentId ?? null) => {
    setMenuOpen(false);
    setContextMenu(null);
    if (parentId) useRoomStore.setState((s) => ({ expanded: { ...s.expanded, [parentId]: true } }));
    setRootOpen(true);
    setCreating({ type, parentId });
  };

  const onCreate = (name) => {
    const target = creating;
    setCreating(null);
    if (!name || !target) return;
    const id = createNode(service.doc, { name, type: target.type, parentId: target.parentId });
    if (target.type === 'file') useRoomStore.getState().openFile(id);
  };

  const onDelete = (node) => {
    setContextMenu(null);
    if (!editable) return;
    const what =
      node.type === 'folder' ? `the folder '${node.name}' and everything in it` : `'${node.name}'`;
    if (
      !window.confirm(
        `Are you sure you want to delete ${what}? This deletes it for everyone in the room.`,
      )
    )
      return;
    deleteNode(service.doc, node.id);
  };

  const contextItems = contextMenu
    ? [
        ...(contextMenu.node.type === 'file' && isHtml(contextMenu.node.name)
          ? [
              {
                label: 'Open with Live Server',
                icon: Radio,
                onClick: () => {
                  setContextMenu(null);
                  openLive(service, contextMenu.node.id);
                },
              },
            ]
          : []),
        ...(editable && contextMenu.node.type === 'folder'
          ? [
              {
                label: 'New File...',
                icon: FilePlus,
                onClick: () => startCreate('file', contextMenu.node.id),
              },
              {
                label: 'New Folder...',
                icon: FolderPlus,
                onClick: () => startCreate('folder', contextMenu.node.id),
              },
            ]
          : []),
        ...(editable
          ? [
              {
                label: 'Rename...',
                icon: Pencil,
                hint: 'F2',
                onClick: () => {
                  setContextMenu(null);
                  useRoomStore.getState().setRenaming(contextMenu.node.id);
                },
              },
              {
                label: 'Delete',
                icon: Trash2,
                hint: 'Del',
                onClick: () => onDelete(contextMenu.node),
              },
            ]
          : []),
      ]
    : [];

  const menuItems = [
    {
      label: 'New File...',
      icon: FilePlus,
      onClick: () => startCreate('file'),
      disabled: !editable,
    },
    {
      label: 'New Folder...',
      icon: FolderPlus,
      onClick: () => startCreate('folder'),
      disabled: !editable,
    },
    {
      label: 'Collapse Folders',
      icon: ListCollapse,
      onClick: () => {
        setMenuOpen(false);
        collapseAll();
      },
    },
    {
      label: 'Download Project (.zip)',
      icon: Download,
      onClick: () => {
        setMenuOpen(false);
        downloadProject(service.doc, roomId);
      },
    },
    ...(githubAvailable
      ? [
          {
            label: 'Push to GitHub...',
            icon: Github,
            onClick: () => {
              setMenuOpen(false);
              setGithubOpen(true);
            },
          },
        ]
      : []),
  ];

  return (
    <div className="flex h-full flex-col">
      {githubOpen && (
        <GitHubDialog service={service} roomId={roomId} onClose={() => setGithubOpen(false)} />
      )}
      <div className="ws-section-title justify-between pr-2">
        <h2>Files</h2>
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Explorer actions"
            title="More actions..."
            className="flex h-7 w-7 items-center justify-center rounded-lg text-ws-muted hover:bg-ws-hover hover:text-ws-text"
          >
            <MoreHorizontal size={16} aria-hidden />
          </button>
          {menuOpen && (
            <ul
              role="menu"
              className="absolute right-0 top-7 z-30 w-56 rounded-chrome border border-ws-border bg-ws-widget py-1 shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
            >
              {menuItems.map(({ label, icon: Icon, onClick, disabled }) => (
                <li key={label} role="none">
                  <button
                    type="button"
                    role="menuitem"
                    disabled={disabled}
                    onClick={onClick}
                    className="flex h-[26px] w-full items-center gap-2 px-3 text-left text-[13px] text-ws-text hover:bg-ws-accent hover:text-white disabled:pointer-events-none disabled:opacity-40"
                  >
                    <Icon size={14} aria-hidden /> {label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => setRootOpen((v) => !v)}
        aria-expanded={rootOpen}
        className="mx-1.5 mb-1 flex h-7 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-left font-mono text-[11.5px] text-ws-muted hover:bg-ws-hover hover:text-ws-text"
      >
        {rootOpen ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
        <span className="truncate">{roomId}</span>
      </button>

      {rootOpen && (
        <ul
          role="tree"
          aria-label="Project files"
          className="ws-scroll min-h-0 flex-1 overflow-y-auto pb-4"
        >
          {creating && !creating.parentId && (
            <NewNodeInput
              type={creating.type}
              depth={0}
              siblings={tree.map((n) => n.name)}
              onDone={onCreate}
            />
          )}
          {tree.map((node) => (
            <TreeNode
              key={node.id}
              node={node}
              depth={0}
              creating={creating}
              onCreate={onCreate}
              onMenu={setContextMenu}
              onDelete={onDelete}
            />
          ))}
          {!tree.length && !creating && (
            <li className="px-5 py-2 text-[12px] text-ws-muted">
              {!loaded ? (
                'Loading files...'
              ) : (
                <>
                  <p>No files yet.</p>
                  {editable && (
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => startCreate('file', null)}
                        className="flex items-center gap-1.5 rounded-md border border-ws-border px-2 py-1 text-ws-text hover:bg-ws-hover"
                      >
                        <FilePlus size={13} aria-hidden /> New File
                      </button>
                      <button
                        type="button"
                        onClick={() => startCreate('folder', null)}
                        className="flex items-center gap-1.5 rounded-md border border-ws-border px-2 py-1 text-ws-text hover:bg-ws-hover"
                      >
                        <FolderPlus size={13} aria-hidden /> New Folder
                      </button>
                    </div>
                  )}
                </>
              )}
            </li>
          )}
        </ul>
      )}

      {contextMenu && contextItems.length > 0 && (
        <ul
          role="menu"
          aria-label={`${contextMenu.node.name} actions`}
          onPointerDown={(e) => e.stopPropagation()}
          className="fixed z-50 w-52 rounded-chrome border border-ws-border bg-ws-widget py-1 shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
          style={{
            left: Math.min(contextMenu.x, window.innerWidth - 216),
            top: Math.min(contextMenu.y, window.innerHeight - 100),
          }}
        >
          {contextItems.map(({ label, icon: Icon, hint, onClick }) => (
            <li key={label} role="none">
              <button
                type="button"
                role="menuitem"
                onClick={onClick}
                className="flex h-[26px] w-full items-center gap-2 px-3 text-left text-[13px] text-ws-text hover:bg-ws-accent hover:text-white"
              >
                <Icon size={14} aria-hidden /> <span className="flex-1">{label}</span>
                {hint && <span className="text-[11px] opacity-60">{hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
