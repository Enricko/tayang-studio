// Local voice engines (Pocket TTS and Kokoro) exposed by the self-hosted web server. Types only:
// the transport lives in `ipc.ts` for the browser and `ipc.desktop.ts` for Tauri.

export interface TtsVoice {
  id: string;
  name: string;
  custom: boolean;
}

export interface TtsEngine {
  id: string;
  name: string;
  description: string;
  voices: TtsVoice[];
}

export interface TtsVoiceList {
  default: { engine: string; voice: string };
  engines: TtsEngine[];
}
