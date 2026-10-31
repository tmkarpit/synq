import { useShallow } from 'zustand/react/shallow';
import { useRoomStore } from '@/store/roomStore';

const MAX_DOTS = 3;

/** One colored dot per collaborator currently inside `fileId` (names in the title). */
export default function PresenceDots({ fileId, className = '' }) {
  const users = useRoomStore(
    useShallow((s) => Object.values(s.users).filter((u) => u.fileId === fileId)),
  );
  if (!users.length) return null;
  const names = users.map((u) => u.username).join(', ');
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-[3px] ${className}`}
      title={`Here: ${names}`}
    >
      <span className="sr-only">{`Also in this file: ${names}`}</span>
      {users.slice(0, MAX_DOTS).map((u) => (
        <span
          key={u.userId}
          aria-hidden
          className="h-[7px] w-[7px] rounded-full"
          style={{ background: u.color }}
        />
      ))}
      {users.length > MAX_DOTS && (
        <span aria-hidden className="text-[10px] leading-none text-ws-muted">
          +{users.length - MAX_DOTS}
        </span>
      )}
    </span>
  );
}
