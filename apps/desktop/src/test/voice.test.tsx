import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TtsVoiceList } from '@/lib/tts';

vi.mock('@/lib/ipc', () => ({
  listVoices: vi.fn(),
  setDefaultVoice: vi.fn(),
  deleteVoice: vi.fn(),
  uploadVoice: vi.fn(),
}));
vi.mock('@/lib/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/platform')>()),
  pickUploadFiles: vi.fn(),
}));

import { VoiceTab } from '@/components/VoiceTab';
import * as ipc from '@/lib/ipc';
import { pickUploadFiles } from '@/lib/platform';

const voices: TtsVoiceList = {
  default: { engine: 'pocket', voice: 'pocket-id-1' },
  engines: [
    {
      id: 'pocket',
      name: 'Pocket TTS',
      description: 'Indonesian, voice cloning',
      voices: [
        { id: 'pocket-id-1', name: 'Indonesia 1', custom: false },
        { id: 'my-voice.mp3', name: 'my-voice', custom: true },
      ],
    },
    {
      id: 'kokoro',
      name: 'Kokoro',
      description: 'English',
      voices: [{ id: 'af_heart', name: 'Heart', custom: false }],
    },
  ],
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.mocked(ipc.listVoices).mockResolvedValue(voices);
  vi.mocked(ipc.setDefaultVoice).mockImplementation(async (engine, voice) => ({ engine, voice }));
  vi.mocked(ipc.deleteVoice).mockResolvedValue({ ok: true });
  vi.mocked(ipc.uploadVoice).mockResolvedValue({ id: 'new-voice.wav', name: 'new-voice', custom: true });
});

describe('Settings › Voice', () => {
  it('lists the engines and saves a picked default', async () => {
    render(<VoiceTab />);
    expect(await screen.findByText('Indonesia 1')).toBeInTheDocument();
    expect(screen.getByText('my-voice')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Kokoro' }));
    await userEvent.click(screen.getByRole('button', { name: /Heart/ }));
    expect(ipc.setDefaultVoice).toHaveBeenCalledWith('kokoro', 'af_heart');
    expect(await screen.findByText(/New agent messages use this voice/)).toBeInTheDocument();
  });

  it('uploads a recording and selects it as the Pocket default', async () => {
    vi.mocked(pickUploadFiles).mockResolvedValue([new File(['voice'], 'new-voice.wav', { type: 'audio/wav' })]);
    render(<VoiceTab />);
    await screen.findByText('Indonesia 1');
    await userEvent.click(screen.getByRole('button', { name: /Upload recording/ }));
    await waitFor(() => expect(ipc.uploadVoice).toHaveBeenCalled());
    expect(ipc.uploadVoice).toHaveBeenCalledWith(expect.objectContaining({ name: 'new-voice.wav' }));
    expect(ipc.setDefaultVoice).toHaveBeenCalledWith('pocket', 'new-voice.wav');
  });

  it('deletes an uploaded voice after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<VoiceTab />);
    await screen.findByText('my-voice');
    await userEvent.click(screen.getByRole('button', { name: /Delete voice my-voice/ }));
    expect(ipc.deleteVoice).toHaveBeenCalledWith('my-voice.mp3');
  });
});
