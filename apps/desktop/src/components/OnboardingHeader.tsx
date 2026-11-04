import logo from '@/assets/brand/tayang-horizontal-reversed-color.svg';
import { cn } from '@/lib/utils';

/** Top bar shared by the onboarding screens. The bar itself drags the window. */
export function OnboardingHeader({ step, bars }: { step: 1 | 2 | 3; bars?: boolean }) {
  return (
    <div data-tauri-drag-region className="flex items-center justify-between">
      <img src={logo} alt="Tayang" className="block h-8 w-auto" />
      <div className="flex items-center gap-3">
        {bars && (
          <div aria-hidden="true" className="flex gap-1">
            {[1, 2, 3].slice(0, step === 3 ? 3 : 2).map((n) => (
              <div key={n} className={cn('h-1 w-6 rounded-full', n <= step ? 'bg-foreground' : 'bg-hairline')} />
            ))}
          </div>
        )}
        <span className="text-[13px] text-text-3">
          Step {step} of 3
        </span>
      </div>
    </div>
  );
}
