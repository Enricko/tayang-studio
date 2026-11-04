// A small confetti burst on a full-window canvas, for when a plan turns on. No dependency: a few
// hundred rectangles with gravity and drag, drawn for ~2.5 s, then the canvas is removed.

export const CONFETTI_COLORS = ['#F2470C', '#FF8A5B', '#FFD6C2', '#EDEDED'];
const DURATION_MS = 2500;
const SECOND_BURST_MS = 600;

/** Whether the system asks for less motion (then there's no confetti at all). */
export function prefersReducedMotion(): boolean {
  try {
    return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  angle: number;
  spin: number;
  color: string;
}

/** Fires two bursts (the second smaller, 600 ms later). Returns a function that stops and cleans up. */
export function fireConfetti(): () => void {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext?.('2d');
  if (!ctx) return () => {};
  canvas.setAttribute('aria-hidden', 'true');
  canvas.dataset.confetti = '';
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '60' });
  const dpr = globalThis.devicePixelRatio || 1;
  const size = () => {
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  size();
  document.body.appendChild(canvas);

  const pieces: Piece[] = [];
  const burst = (count: number) => {
    for (let i = 0; i < count; i++) {
      const fromLeft = i % 2 === 0;
      const angle = (fromLeft ? -60 : -120) * (Math.PI / 180) + (Math.random() - 0.5) * 0.9;
      const speed = 9 + Math.random() * 9;
      pieces.push({
        x: fromLeft ? innerWidth * 0.2 : innerWidth * 0.8,
        y: innerHeight * 0.75,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        w: 6 + Math.random() * 6,
        h: 4 + Math.random() * 4,
        angle: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.3,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length]!,
      });
    }
  };

  const start = performance.now();
  let raf = 0;
  let second = false;
  const frame = (t: number) => {
    const elapsed = t - start;
    if (!second && elapsed >= SECOND_BURST_MS) {
      second = true;
      burst(60);
    }
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.globalAlpha = Math.max(0, 1 - Math.max(0, elapsed - DURATION_MS + 600) / 600);
    for (const p of pieces) {
      p.vy += 0.35;
      p.vx *= 0.985;
      p.vy *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      p.angle += p.spin;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (elapsed < DURATION_MS) raf = requestAnimationFrame(frame);
    else stop();
  };
  const stop = () => {
    cancelAnimationFrame(raf);
    removeEventListener('resize', size);
    canvas.remove();
  };
  addEventListener('resize', size);
  burst(140);
  raf = requestAnimationFrame(frame);
  return stop;
}
