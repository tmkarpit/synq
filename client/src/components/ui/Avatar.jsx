import { initialsOf } from '@/config/collaborators';
import { cn } from '@/lib/cn';

/**
 * Collaborator avatar. Color is set via style (never dynamic Tailwind classes) and
 * the name is always available as text for screen readers (never color alone).
 */
export default function Avatar({ name, color, size = 24, online, ring = false, className, title }) {
  return (
    <span
      className={cn('relative inline-flex shrink-0', className)}
      style={{ width: size, height: size }}
      title={title ?? name}
    >
      <span
        className="flex h-full w-full items-center justify-center rounded-full font-semibold text-[#0b0b0c]"
        style={{
          background: color,
          fontSize: Math.max(9, Math.round(size * 0.4)),
          boxShadow: ring ? '0 0 0 2px var(--ws-panel)' : undefined,
        }}
      >
        <span aria-hidden>{initialsOf(name)}</span>
        <span className="sr-only">{name}</span>
      </span>
      {online != null && (
        <span
          aria-hidden
          className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-ws-panel"
          style={{ background: online ? '#4ADE80' : '#5B606A' }}
        />
      )}
    </span>
  );
}
