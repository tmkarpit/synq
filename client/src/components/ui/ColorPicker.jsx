import { Check } from 'lucide-react';
import { COLLAB_COLORS } from '@/config/collaborators';
import { cn } from '@/lib/cn';

/** Radio group of collaborator colors. Each swatch has an accessible name, not just a color. */
export default function ColorPicker({ value, onChange, label = 'Cursor color' }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-2">
      {COLLAB_COLORS.map((c) => {
        const selected = c.hex === value;
        return (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={c.name}
            title={c.name}
            onClick={() => onChange(c.hex)}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-full transition-transform duration-micro ease-synq',
              selected ? 'scale-110' : 'hover:scale-105',
            )}
            style={{
              background: c.hex,
              boxShadow: selected ? `0 0 0 2px var(--bg), 0 0 0 4px ${c.hex}` : undefined,
            }}
          >
            {selected && <Check size={14} strokeWidth={3} className="text-[#0b0b0c]" aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}
