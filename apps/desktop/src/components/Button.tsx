import * as React from 'react';
import { Button as UiButton } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'light';

const MAP: Record<ButtonVariant, { variant: 'default' | 'secondary' | 'ghost'; className: string }> = {
  primary: { variant: 'default', className: 'font-semibold hover:bg-accent-hover' },
  secondary: { variant: 'secondary', className: 'border border-hairline hover:bg-hairline' },
  ghost: { variant: 'ghost', className: 'text-text-2 hover:text-foreground' },
  light: { variant: 'default', className: 'bg-foreground text-ink hover:bg-foreground/90' },
};

export interface ButtonProps extends Omit<React.ComponentProps<typeof UiButton>, 'variant'> {
  variant?: ButtonVariant;
}

export function Button({ variant = 'primary', className, ...props }: ButtonProps) {
  const m = MAP[variant];
  return <UiButton variant={m.variant} className={cn('h-9 rounded-md px-4 text-[14px]', m.className, className)} {...props} />;
}
