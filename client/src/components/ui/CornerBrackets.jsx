import { cn } from '@/lib/cn';

/** Four HUD corner brackets drawn around the parent (parent must be `relative`). */
export default function CornerBrackets({ size = 10, className, color = 'rgba(255,255,255,0.35)' }) {
  const base = 'pointer-events-none absolute';
  const style = { width: size, height: size, borderColor: color };
  return (
    <span aria-hidden className={cn('pointer-events-none absolute inset-0', className)}>
      <span className={cn(base, 'left-0 top-0 border-l border-t')} style={style} />
      <span className={cn(base, 'right-0 top-0 border-r border-t')} style={style} />
      <span className={cn(base, 'bottom-0 left-0 border-b border-l')} style={style} />
      <span className={cn(base, 'bottom-0 right-0 border-b border-r')} style={style} />
    </span>
  );
}
