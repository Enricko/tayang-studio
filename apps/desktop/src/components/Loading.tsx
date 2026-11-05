import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A request to the Tayang API is under way: a small turning circle, beside the words that say what
 * is happening (or in a button). Still for people who ask for less motion.
 */
export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <Loader2
      size={size}
      strokeWidth={2}
      aria-hidden="true"
      data-testid="spinner"
      className={cn('shrink-0 animate-spin text-text-3 motion-reduce:animate-none', className)}
    />
  );
}

/** Where content will appear once the API answers: a soft pulsing block of its size. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" data-testid="skeleton" className={cn('block animate-pulse rounded-md bg-raised motion-reduce:animate-none', className)} />;
}
