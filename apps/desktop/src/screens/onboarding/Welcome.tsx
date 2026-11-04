import { ArrowRight, Cpu, Eye, Lightbulb } from 'lucide-react';
import banner from '@/assets/brand/dither-banner.png';
import wink from '@/assets/brand/oyen-expr-wink.svg';
import { Button } from '@/components/Button';
import { OnboardingHeader } from '@/components/OnboardingHeader';
import { useApp } from '@/state/app';

const POINTS = [
  { icon: Lightbulb, title: 'No prompts to learn', text: 'Choose from suggestions and Tayang writes the expert prompts' },
  { icon: Cpu, title: 'Bring your own agent', text: 'Claude Code, opencode, Gemini CLI or any agent that speaks ACP' },
  { icon: Eye, title: 'Checked before you watch', text: 'Every frame is rendered and reviewed for overlaps, cut-off text and timing' },
];

function Post({ tag, className, children }: { tag: string; className: string; children: React.ReactNode }) {
  return (
    <div className={`absolute flex h-[340px] w-48 flex-col gap-3 rounded-xl border border-hairline bg-[#1F1F1F] p-4 ${className}`}>
      <span className="self-start rounded-md bg-primary px-2 py-0.5 font-mono text-[11px] font-medium tracking-[0.08em] text-primary-foreground">
        {tag}
      </span>
      {children}
    </div>
  );
}

const chip = 'mt-auto self-start rounded-sm bg-foreground px-1.5 py-0.5 text-xs font-semibold text-ink';

export function Welcome() {
  const navigate = useApp((s) => s.navigate);
  return (
    <div className="relative flex min-h-full flex-wrap overflow-hidden bg-background text-foreground">
      <img
        src={banner}
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute top-0 right-0 h-[360px] w-[960px]"
        style={{ imageRendering: 'pixelated' }}
      />
      <div className="relative flex min-w-0 flex-[1_1_540px] flex-col gap-10 px-16 pt-10 pb-12">
        <OnboardingHeader step={1} />
        <div data-tauri-drag-region className="mt-10 flex flex-col gap-5">
          <span className="font-mono text-[13px] font-medium tracking-[0.12em] text-primary">
            TAYANG STUDIO · FREE AND OPEN SOURCE
          </span>
          <h1 className="text-[56px] leading-[1.04] font-extrabold tracking-[-0.035em]">
            Motion videos,
            <br />
            without the prompting.
          </h1>
          <p className="max-w-[480px] text-[18px] leading-[1.6] text-text-2">
            Pick a topic. Oyen writes the script, directs your AI agent, and checks every frame before you see it.
          </p>
        </div>
        <ul className="flex max-w-[500px] flex-col gap-4">
          {POINTS.map(({ icon: Icon, title, text }) => (
            <li key={title} className="flex items-start gap-3">
              <Icon size={18} strokeWidth={1.5} aria-hidden="true" className="mt-0.5 shrink-0 text-text-2" />
              <div className="flex flex-col gap-1">
                <span className="text-[15px] font-medium">{title}</span>
                <span className="text-sm leading-normal text-text-2">{text}</span>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-auto flex flex-wrap items-center gap-6">
          <Button className="h-12 gap-2 px-5 text-base" onClick={() => navigate({ name: 'connect' })}>
            Get started
            <ArrowRight size={18} strokeWidth={2} aria-hidden="true" />
          </Button>
          <Button variant="ghost" className="px-0" onClick={() => navigate({ name: 'videos' })}>
            Open an existing project
          </Button>
        </div>
      </div>
      <div
        data-tauri-drag-region
        className="relative flex min-w-0 flex-[1_1_460px] items-center justify-center px-6 py-12"
      >
        <div className="relative h-[520px] w-[472px] max-w-full" aria-hidden="true">
          <Post tag="EXPLAINER" className="top-[72px] left-0 -rotate-10">
            <span className="mt-2 text-[26px] leading-[1.04] font-extrabold tracking-[-0.03em]">Kenapa rupiah melemah?</span>
            <span className={chip}>dolar menguat</span>
          </Post>
          <Post tag="QUOTE" className="top-3 left-[140px]">
            <span className="mt-3 text-[40px] leading-[0.98] font-extrabold tracking-[-0.035em]">
              Mulai
              <br />
              <span className="text-primary">aja</span>
              <br />
              dulu.
            </span>
          </Post>
          <Post tag="PROMO" className="top-[72px] right-0 rotate-10">
            <span className="mt-2 text-[26px] leading-[1.04] font-extrabold tracking-[-0.03em]">Buy 1 get 1. Cuma Jumat.</span>
            <span className={chip}>Kopi Senja</span>
          </Post>
          <img src={wink} alt="Oyen, winking" className="absolute top-[300px] left-40 h-[152px] w-[152px]" />
        </div>
      </div>
    </div>
  );
}
