import { useShallow } from 'zustand/react/shallow';
import Avatar from '@/components/ui/Avatar';
import { useRoomStore } from '@/store/roomStore';
import { cn } from '@/lib/cn';

const MAX = 5;

/** Remote collaborators; click an avatar to follow (or stop following) them. */
export default function AvatarStack() {
  const users = useRoomStore(useShallow((s) => Object.values(s.users)));
  const followUserId = useRoomStore((s) => s.followUserId);
  const toggleFollow = useRoomStore((s) => s.toggleFollow);
  if (!users.length) return null;

  return (
    <div className="flex items-center" role="group" aria-label="Collaborators">
      {users.slice(0, MAX).map((u, i) => {
        const following = followUserId === u.userId;
        return (
          <button
            key={u.userId}
            type="button"
            onClick={() => toggleFollow(u.userId)}
            aria-pressed={following}
            title={following ? `Following ${u.username} (click to stop)` : `Follow ${u.username}`}
            className={cn(
              'relative rounded-full transition-transform duration-micro hover:z-10 hover:-translate-y-px',
              i > 0 && '-ml-1.5',
            )}
          >
            <Avatar name={u.username} color={u.color} size={22} ring title="" />
            {following && (
              <span
                aria-hidden
                className="absolute -inset-[3px] rounded-full border-2"
                style={{ borderColor: u.color }}
              />
            )}
          </button>
        );
      })}
      {users.length > MAX && (
        <span className="-ml-1.5 flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-ws-hover px-1 text-[10px] text-ws-text ring-2 ring-ws-panel">
          +{users.length - MAX}
        </span>
      )}
    </div>
  );
}
