import defaultUrl from '@/assets/brand/oyen-expr-default.svg';
import winkUrl from '@/assets/brand/oyen-expr-wink.svg';
import happyUrl from '@/assets/brand/oyen-expr-happy.svg';
import sleepyUrl from '@/assets/brand/oyen-expr-sleepy.svg';
import surprisedUrl from '@/assets/brand/oyen-expr-surprised.svg';

export type OyenMood = 'default' | 'wink' | 'happy' | 'sleepy' | 'surprised';

const SRC: Record<OyenMood, string> = {
  default: defaultUrl,
  wink: winkUrl,
  happy: happyUrl,
  sleepy: sleepyUrl,
  surprised: surprisedUrl,
};

export function Oyen({ mood, size = 28 }: { mood: OyenMood; size?: number }) {
  return <img src={SRC[mood]} alt="Oyen" width={size} height={size} style={{ width: size, height: size }} />;
}
