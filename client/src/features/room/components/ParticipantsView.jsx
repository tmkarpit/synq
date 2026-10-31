import { useShallow } from 'zustand/react/shallow';
import { toast } from 'sonner';
import { Check, Crown, Eye, EyeOff, UserMinus, X } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import { useRoomStore } from '@/store/roomStore';
import { useRoom } from '@/features/room/RoomContext';
import { CLIENT_EVENTS, isOwner } from '@/services/collab';
import { pathOf } from '@/services/collab/workspaceDoc';

const selectCls =
  'h-6 rounded-md border border-ws-border bg-ws-panel px-1.5 text-[11.5px] text-ws-text outline-none hover:border-ws-accent-line focus:border-ws-accent';
const iconBtn =
  'flex h-6 w-6 items-center justify-center rounded-md text-ws-muted hover:bg-ws-selected hover:text-ws-text';

const PERMISSIONS = [
  { key: 'approval', label: 'Ask me before anyone joins' },
  { key: 'ownerOnlyFiles', label: 'Only the owner can create and delete files' },
  { key: 'ownerOnlyRun', label: 'Only the owner can run code' },
];

export default function ParticipantsView() {
  const { service } = useRoom();
  const self = useRoomStore((s) => s.self);
  const users = useRoomStore(useShallow((s) => Object.values(s.users)));
  const nodes = useRoomStore((s) => s.nodes);
  const settings = useRoomStore((s) => s.settings);
  const access = useRoomStore((s) => s.access);
  const followUserId = useRoomStore((s) => s.followUserId);
  const toggleFollow = useRoomStore((s) => s.toggleFollow);
  const everyone = [self, ...users].filter(Boolean);
  // Roles and permissions are kept by the server, so the offline demo has no controls.
  const live = service.mode === 'live';
  const leader = live && isOwner(self);

  // The server saves before it confirms (about a second with a remote database), so the
  // owner's own view changes right away and is put back if the server refuses.
  const request = async (event, payload, undo = () => {}) => {
    const res = await service.request(event, payload);
    if (res.error) {
      toast.error(res.error);
      undo();
    }
  };

  const patchMember = (member, patch) => {
    const { access: current, setAccess } = useRoomStore.getState();
    setAccess({
      ...current,
      members: current.members.map((m) => (m.member === member ? { ...m, ...patch } : m)),
    });
    return () => setAccess(current);
  };

  const setRole = (m, role) => {
    if (role === 'owner') {
      if (!window.confirm(`Make ${m.name} the owner of this room? You will become an editor.`))
        return;
      request(CLIENT_EVENTS.setRole, { member: m.member, role });
      return;
    }
    request(CLIENT_EVENTS.setRole, { member: m.member, role }, patchMember(m.member, { role }));
  };

  const remove = (m) => {
    if (!window.confirm(`Remove ${m.name} from this room? They will have to ask to join again.`))
      return;
    request(CLIENT_EVENTS.removeMember, { member: m.member });
  };

  const respond = (r, accept) => request(CLIENT_EVENTS.respond, { member: r.member, accept });

  const updateSettings = (patch) => {
    const { setSettings } = useRoomStore.getState();
    setSettings({ ...settings, ...patch });
    request(CLIENT_EVENTS.updateSettings, patch, () => setSettings(settings));
  };

  return (
    <div className="flex h-full flex-col">
      <div className="ws-scroll min-h-0 flex-1 overflow-y-auto">
        {leader && access.requests.length > 0 && (
          <section aria-labelledby="join-requests" className="mb-2">
            <h2 id="join-requests" className="ws-section-title">
              Join requests{' '}
              <span className="rounded-full bg-ws-accent px-2 text-[11px] font-medium text-white">
                {access.requests.length}
              </span>
            </h2>
            <ul>
              {access.requests.map((r) => (
                <li
                  key={r.member}
                  className="mx-1.5 flex items-center gap-2.5 rounded-lg bg-ws-accent-soft/40 px-2.5 py-1.5"
                >
                  <Avatar name={r.name} color="#8B8B96" size={24} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px]">{r.name}</p>
                    <p className="truncate text-[11px] text-ws-muted">
                      {r.email || `wants to join as ${r.role}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => respond(r, true)}
                    className={`${iconBtn} text-[#6EE7A0]`}
                    title={`Accept ${r.name}`}
                    aria-label={`Accept ${r.name}`}
                  >
                    <Check size={15} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => respond(r, false)}
                    className={`${iconBtn} text-[#F47174]`}
                    title={`Decline ${r.name}`}
                    aria-label={`Decline ${r.name}`}
                  >
                    <X size={15} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <h2 className="ws-section-title">
          In the room{' '}
          <span className="rounded-full bg-ws-hover px-2 text-[11px] font-medium text-ws-muted">
            {everyone.length}
          </span>
        </h2>
        <ul>
          {everyone.map((u) => {
            const isSelf = u.userId === self?.userId;
            const following = followUserId === u.userId;
            return (
              <li
                key={u.userId}
                className="group mx-1.5 flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 hover:bg-ws-hover"
              >
                <Avatar name={u.username} color={u.color} size={24} online />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1 truncate text-[13px]">
                    {u.username}
                    {isSelf && <span className="text-ws-muted"> (you)</span>}
                    {u.isBot && <span className="text-ws-muted"> · bot</span>}
                    {isOwner(u) && (
                      <Crown size={12} className="shrink-0 text-[#FACC15]" aria-label="Owner" />
                    )}
                  </p>
                  <p className="truncate text-[11px] text-ws-muted">
                    {u.role}
                    {u.fileId && nodes[u.fileId] ? ` · ${pathOf(nodes, u.fileId)}` : ''}
                  </p>
                </div>
                {!isSelf && (
                  <button
                    type="button"
                    onClick={() => toggleFollow(u.userId)}
                    aria-pressed={following}
                    className="rounded-chrome p-1 text-ws-muted hover:bg-ws-selected hover:text-ws-text"
                    title={following ? `Stop following ${u.username}` : `Follow ${u.username}`}
                    aria-label={following ? `Stop following ${u.username}` : `Follow ${u.username}`}
                  >
                    {following ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
                  </button>
                )}
              </li>
            );
          })}
        </ul>

        {leader && (
          <section aria-labelledby="room-members" className="mt-2">
            <h2 id="room-members" className="ws-section-title">
              Members{' '}
              <span className="rounded-full bg-ws-hover px-2 text-[11px] font-medium text-ws-muted">
                {access.members.length}
              </span>
            </h2>
            <ul>
              {access.members.map((m) => (
                <li
                  key={m.member}
                  className="mx-1.5 flex items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-ws-hover"
                >
                  <span
                    aria-label={m.online ? 'Online' : 'Offline'}
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${m.online ? 'bg-[#4ADE80]' : 'bg-ws-border'}`}
                  />
                  <span className="min-w-0 flex-1 truncate text-[13px]">{m.name || 'Unnamed'}</span>
                  {m.role === 'owner' ? (
                    <span className="flex items-center gap-1 text-[11.5px] text-ws-muted">
                      <Crown size={12} className="text-[#FACC15]" aria-hidden /> owner
                    </span>
                  ) : (
                    <>
                      <select
                        value={m.role}
                        onChange={(e) => setRole(m, e.target.value)}
                        aria-label={`Role of ${m.name}`}
                        className={selectCls}
                      >
                        <option value="editor">Editor</option>
                        <option value="viewer">Viewer</option>
                        <option value="owner">Make owner</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => remove(m)}
                        className={iconBtn}
                        title={`Remove ${m.name}`}
                        aria-label={`Remove ${m.name}`}
                      >
                        <UserMinus size={14} aria-hidden />
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {live && (
        <section
          aria-labelledby="room-permissions"
          className="shrink-0 border-t border-ws-border px-4 py-3 text-[12px]"
        >
          <h3 id="room-permissions" className="mb-2 font-medium text-ws-text">
            Room permissions
          </h3>
          {leader ? (
            <div className="space-y-2">
              {PERMISSIONS.map(({ key, label }) => (
                <label key={key} className="flex cursor-pointer items-start gap-2 text-ws-text">
                  <input
                    type="checkbox"
                    checked={settings[key]}
                    onChange={(e) => updateSettings({ [key]: e.target.checked })}
                    className="mt-0.5 accent-[#7C5CFF]"
                  />
                  {label}
                </label>
              ))}
              <label className="flex items-center justify-between gap-2 text-ws-text">
                New people join as
                <select
                  value={settings.newMembers}
                  onChange={(e) => updateSettings({ newMembers: e.target.value })}
                  className={selectCls}
                >
                  <option value="editor">Editors</option>
                  <option value="viewer">Viewers</option>
                </select>
              </label>
              <label className="flex items-center justify-between gap-2 text-ws-text">
                Terminal commands
                <select
                  value={settings.shell}
                  onChange={(e) => updateSettings({ shell: e.target.value })}
                  className={selectCls}
                  title="Commands like npm install run on the server machine with its permissions"
                >
                  <option value="owner">Only me</option>
                  <option value="editors">Editors too</option>
                  <option value="off">Nobody</option>
                </select>
              </label>
            </div>
          ) : (
            <ul className="space-y-1 text-ws-muted">
              {PERMISSIONS.filter(({ key }) => key !== 'approval' && settings[key]).map(
                ({ key, label }) => (
                  <li key={key}>{label}.</li>
                ),
              )}
              {!settings.ownerOnlyFiles && !settings.ownerOnlyRun && (
                <li>Everyone with edit access can manage files and run code.</li>
              )}
              <li>
                {settings.approval
                  ? 'The owner accepts everyone who asks to join.'
                  : 'Anyone with the link can join.'}
              </li>
              <li>
                {settings.shell === 'editors'
                  ? 'Editors can run terminal commands.'
                  : settings.shell === 'off'
                    ? 'Terminal commands are off.'
                    : 'Only the owner can run terminal commands.'}
              </li>
              <li>Only the owner can change these.</li>
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
