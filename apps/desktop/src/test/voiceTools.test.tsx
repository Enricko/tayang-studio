import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ipc', () => ({
  ttsStatus: vi.fn(),
  ttsPrepare: vi.fn(),
  ttsPreview: vi.fn(),
  assetUrl: vi.fn((path: string, version?: string | null) => `/api/assets?path=${encodeURIComponent(path)}${version ? `&v=${version}` : ''}`),
}));

import { VoiceTools } from '@/components/VoiceTools';
import * as ipc from '@/lib/ipc';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ipc.ttsStatus).mockResolvedValue({
    engines: { pocket: { prepared: false }, kokoro: { prepared: true } },
  });
  vi.mocked(ipc.ttsPrepare).mockResolvedValue({ ok: true, engine: 'pocket', seconds: 1 });
  vi.mocked(ipc.ttsPreview).mockResolvedValue({
    path: '/data/thumbs/voice-previews/pocket-p1.mp3',
    durationSec: 3,
    engine: 'pocket',
    voice: 'pocket-id-1',
  });
});

describe('Settings › Tools › local voices', () => {
  it('installs a model in one click and marks it installed', async () => {
    const user = userEvent.setup();
    render(<VoiceTools />);
    await screen.findByText('Indonesian narration and voice cloning from your own recording');
    expect(screen.getByRole('button', { name: 'Install' })).toBeInTheDocument();
    vi.mocked(ipc.ttsStatus).mockResolvedValue({
      engines: { pocket: { prepared: true }, kokoro: { prepared: true } },
    });
    await user.click(screen.getByRole('button', { name: 'Install' }));
    expect(ipc.ttsPrepare).toHaveBeenCalledWith('pocket');
    expect(await screen.findAllByText('Installed')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument();
  });

  it('plays a default sample for an engine', async () => {
    const user = userEvent.setup();
    render(<VoiceTools />);
    await screen.findByText('Indonesian narration and voice cloning from your own recording');
    await user.click(screen.getAllByRole('button', { name: 'Listen' })[0]!);
    expect(ipc.ttsPreview).toHaveBeenCalledWith('pocket', null, 'id');
  });

  it('marks Kokoro as English only', async () => {
    render(<VoiceTools />);
    expect(await screen.findByText('English, Spanish, French, Hindi, Italian and Portuguese, without Indonesian')).toBeInTheDocument();
    expect(screen.getAllByText(/Kokoro supports English, Spanish/).length).toBeGreaterThan(0);
  });
});
