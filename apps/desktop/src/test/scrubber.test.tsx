import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

vi.mock('@/lib/ipc', () => ({
  mediaLatestRender: vi.fn(),
  mediaProbe: vi.fn(),
  mediaExtractFrame: vi.fn(),
  mediaThumbnails: vi.fn(),
  mediaRender: vi.fn(),
  assetUrl: (p: string) => `asset://${p}`,
}));

import * as ipc from '@/lib/ipc';
import { Preview } from '@/screens/preview/Preview';
import { Scrubber } from '@/screens/preview/Scrubber';
import { MessageList } from '@/components/MessageList';
import { setUiLanguage } from '@/i18n';
import { useChat } from '@/state/chat';

const thumbs = Array.from({ length: 12 }, (_, i) => `/t/${i}.png`);

function setup(frame = 330, scenes?: { name: string; startSec: number; endSec: number }[]) {
  const onSeek = vi.fn();
  render(<Scrubber durationSec={34} fps={30} frame={frame} thumbnails={thumbs} onSeek={onSeek} scenes={scenes} />);
  return { onSeek, slider: screen.getByRole('slider') };
}

describe('Scrubber', () => {
  it('exposes slider semantics', () => {
    const { slider } = setup();
    expect(slider).toHaveAttribute('aria-valuemin', '0');
    expect(slider).toHaveAttribute('aria-valuemax', '1019');
    expect(slider).toHaveAttribute('aria-valuenow', '330');
    expect(slider).toHaveAttribute('aria-valuetext', '0:11.00');
  });

  it('steps one frame with ArrowRight', async () => {
    const { slider, onSeek } = setup();
    slider.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onSeek).toHaveBeenCalledWith(331);
  });

  it('steps one second with Shift+ArrowRight', async () => {
    const { slider, onSeek } = setup();
    slider.focus();
    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');
    expect(onSeek).toHaveBeenCalledWith(360);
  });

  it('seeks by pointer drag', () => {
    const { slider, onSeek } = setup();
    slider.getBoundingClientRect = () =>
      ({ left: 0, width: 1000, top: 0, height: 56, right: 1000, bottom: 56, x: 0, y: 0, toJSON() {} }) as DOMRect;
    slider.setPointerCapture = () => {};
    fireEvent.pointerDown(slider, { clientX: 500, pointerId: 1 });
    const v = onSeek.mock.calls.at(-1)![0] as number;
    expect(Math.abs(v - 510)).toBeLessThanOrEqual(1);
  });

  it('shows the scene in the tooltip when scenes are known', () => {
    setup(330, [{ name: 'Chart', startSec: 9, endSec: 17 }]);
    expect(screen.getByText('0:11.00 · Chart')).toBeInTheDocument();
  });

  it('shows only the timecode without scenes', () => {
    setup();
    expect(screen.getByText('0:11.00')).toBeInTheDocument();
  });
});

describe('Preview', () => {
  beforeEach(() => {
    vi.mocked(ipc.mediaLatestRender).mockResolvedValue('/p/out.mp4');
    vi.mocked(ipc.mediaProbe).mockResolvedValue({ durationSec: 34, fps: 30, frames: 1020, width: 1080, height: 1920 });
    vi.mocked(ipc.mediaThumbnails).mockResolvedValue(thumbs);
    vi.mocked(ipc.mediaExtractFrame).mockResolvedValue('/p/frame.png');
    useChat.getState().reset();
  });

  it('sends the current frame to the chat', async () => {
    const { container } = render(<Preview projectId="p1" chatId="c1" />);
    await screen.findByRole('slider');
    const video = container.querySelector('video')!;
    video.currentTime = 11;
    fireEvent.timeUpdate(video);
    expect(await screen.findByText('Frame 330')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send frame to chat' }));
    await waitFor(() => expect(ipc.mediaExtractFrame).toHaveBeenCalledWith('p1', 11));
    await waitFor(() => expect(useChat.getState().attachments['c1']?.[0]).toMatchObject({ type: 'frame', frame: 330, timeSec: 11 }));
  });

  it('records a numbered mark after Mark a spot', async () => {
    const { container } = render(<Preview projectId="p1" chatId="c1" />);
    await screen.findByRole('slider');
    await userEvent.click(screen.getByRole('button', { name: 'Mark a spot' }));
    const box = screen.getByTestId('preview-frame');
    box.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 200, height: 400, right: 200, bottom: 400, x: 0, y: 0, toJSON() {} }) as DOMRect;
    fireEvent.click(box, { clientX: 100, clientY: 100 });
    expect(screen.getByTestId('mark-1')).toHaveTextContent('1');
    await userEvent.click(screen.getByRole('button', { name: 'Send frame to chat' }));
    await waitFor(() =>
      expect(useChat.getState().attachments['c1']?.[0]).toMatchObject({ marks: [{ x: 0.5, y: 0.25 }] }),
    );
    expect(container.querySelector('[data-testid="mark-1"]')).toBeNull();
  });

  it('drops marks when the frame changes or playback starts', async () => {
    const { container } = render(<Preview projectId="p1" chatId="c1" />);
    await screen.findByRole('slider');
    const box = screen.getByTestId('preview-frame');
    box.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 200, height: 400, right: 200, bottom: 400, x: 0, y: 0, toJSON() {} }) as DOMRect;
    const mark = async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Mark a spot' }));
      fireEvent.click(box, { clientX: 100, clientY: 100 });
      expect(screen.getByTestId('mark-1')).toBeInTheDocument();
    };
    await mark();
    await userEvent.click(screen.getByRole('button', { name: 'Next frame' }));
    expect(screen.queryByTestId('mark-1')).toBeNull();
    await mark();
    fireEvent.play(container.querySelector('video')!);
    expect(screen.queryByTestId('mark-1')).toBeNull();
    await mark();
    const video = container.querySelector('video')!;
    video.currentTime = 5;
    fireEvent.timeUpdate(video);
    await waitFor(() => expect(screen.queryByTestId('mark-1')).toBeNull());
  });

  it('shows the empty state and renders on demand', async () => {
    vi.mocked(ipc.mediaLatestRender).mockResolvedValueOnce(null);
    vi.mocked(ipc.mediaProbe).mockResolvedValueOnce(null);
    vi.mocked(ipc.mediaRender).mockResolvedValue('/p/out.mp4');
    render(<Preview projectId="p1" chatId="c1" />);
    expect(await screen.findByText('Nothing rendered yet')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Render preview' }));
    await waitFor(() => expect(ipc.mediaRender).toHaveBeenCalledWith('p1'));
    expect(await screen.findByRole('slider')).toBeInTheDocument();
  });

  it('shows an inline error when rendering fails', async () => {
    vi.mocked(ipc.mediaLatestRender).mockResolvedValueOnce(null);
    vi.mocked(ipc.mediaProbe).mockResolvedValueOnce(null);
    vi.mocked(ipc.mediaRender).mockRejectedValue(new Error('ffmpeg missing'));
    render(<Preview projectId="p1" chatId="c1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Render preview' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ffmpeg missing');
  });

  it('shows the badge for the language-neutral token, with the token hidden in the chat', async () => {
    useChat.setState({
      messages: { c1: [{ id: 'm1', chatId: 'c1', role: 'agent', parts: [{ type: 'text', text: '[tayang:frames-checked]\nDua teks sudah diperbaiki.' }], createdAt: '' }] },
    });
    setUiLanguage('id');
    render(<Preview projectId="p1" chatId="c1" />);
    await screen.findByRole('slider');
    expect(screen.getByText('Frame sudah dicek')).toBeInTheDocument();
    cleanup();
    render(<MessageList messages={useChat.getState().messages.c1!} streaming={false} />);
    expect(screen.getByText('Dua teks sudah diperbaiki.')).toBeInTheDocument();
    expect(screen.queryByText(/tayang:frames-checked/)).toBeNull();
  });

  it('shows Frames checked when the last agent message says so', async () => {
    useChat.setState({
      messages: { c1: [{ id: 'm1', chatId: 'c1', role: 'agent', parts: [{ type: 'text', text: 'Frames checked, all good' }], createdAt: '' }] },
    });
    render(<Preview projectId="p1" chatId="c1" />);
    await screen.findByRole('slider');
    expect(screen.getByText('Frames checked')).toBeInTheDocument();
  });
});
