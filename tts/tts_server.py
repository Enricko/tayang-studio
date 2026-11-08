"""Small local TTS service for the self-hosted Tayang Studio web server.

Two CPU engines:
- Pocket TTS (Kyutai), using the Indonesian community model and a reference WAV/MP3 for
  zero-shot voice cloning. Custom voices live in /data/voices.
- Kokoro-82M for English and its other supported languages.

The service is intentionally loopback/Compose-internal. The Tayang action proxy authenticates
agent requests and forwards only validated output paths under the workspace.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import numpy as np
import soundfile as sf
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

ROOT = Path(os.environ.get("TAYANG_WORKSPACE_ROOT", "/data/workspaces")).resolve()
VOICES = Path(os.environ.get("TAYANG_VOICES_DIR", "/data/voices")).resolve()
PREVIEWS = Path(os.environ.get("TAYANG_PREVIEW_DIR", "/data/thumbs/voice-previews")).resolve()
PREPARED_FILE = VOICES / "engines.json"
TOKEN = os.environ.get("TAYANG_TTS_TOKEN", "").strip()
POCKET_CONFIG = os.environ.get(
    "TAYANG_POCKET_CONFIG",
    "hf://anak10thn/pocket-tts-indonesian/indonesian_6l.yaml@382fe85ca848546efb04bf1b7fdba78c6396e2ce",
)
POCKET_EOS = float(os.environ.get("TAYANG_POCKET_EOS", "-6.0"))
POCKET_DEFAULT_VOICE = os.environ.get(
    "TAYANG_POCKET_VOICE",
    "hf://anak10thn/pocket-tts-indonesian/voices/common_voice_id_19961910.mp3@382fe85ca848546efb04bf1b7fdba78c6396e2ce",
)
POCKET_BUILTINS = {
    "pocket-id-1": "hf://anak10thn/pocket-tts-indonesian/voices/common_voice_id_19961910.mp3@382fe85ca848546efb04bf1b7fdba78c6396e2ce",
    "pocket-id-2": "hf://anak10thn/pocket-tts-indonesian/voices/common_voice_id_20954552.mp3@382fe85ca848546efb04bf1b7fdba78c6396e2ce",
    "pocket-id-3": "hf://anak10thn/pocket-tts-indonesian/voices/common_voice_id_20954811.mp3@382fe85ca848546efb04bf1b7fdba78c6396e2ce",
    "pocket-id-4": "hf://anak10thn/pocket-tts-indonesian/voices/common_voice_id_22918082.mp3@382fe85ca848546efb04bf1b7fdba78c6396e2ce",
}
KOKORO_VOICES = [
    # American English
    ("af_heart", "Heart (US English)"),
    ("af_alloy", "Alloy (US English)"),
    ("af_aoede", "Aoede (US English)"),
    ("af_bella", "Bella (US English)"),
    ("af_jessica", "Jessica (US English)"),
    ("af_kore", "Kore (US English)"),
    ("af_nicole", "Nicole (US English)"),
    ("af_nova", "Nova (US English)"),
    ("af_river", "River (US English)"),
    ("af_sarah", "Sarah (US English)"),
    ("af_sky", "Sky (US English)"),
    ("am_adam", "Adam (US English)"),
    ("am_echo", "Echo (US English)"),
    ("am_eric", "Eric (US English)"),
    ("am_fenrir", "Fenrir (US English)"),
    ("am_liam", "Liam (US English)"),
    ("am_michael", "Michael (US English)"),
    ("am_onyx", "Onyx (US English)"),
    ("am_puck", "Puck (US English)"),
    ("am_santa", "Santa (US English)"),
    # British English
    ("bf_alice", "Alice (British English)"),
    ("bf_emma", "Emma (British English)"),
    ("bf_isabella", "Isabella (British English)"),
    ("bf_lily", "Lily (British English)"),
    ("bm_daniel", "Daniel (British English)"),
    ("bm_fable", "Fable (British English)"),
    ("bm_george", "George (British English)"),
    ("bm_lewis", "Lewis (British English)"),
    # Spanish
    ("ef_dora", "Dora (Spanish)"),
    ("em_alex", "Alex (Spanish)"),
    ("em_santa", "Santa (Spanish)"),
    # French
    ("ff_siwis", "Siwis (French)"),
    # Hindi
    ("hf_alpha", "Alpha (Hindi)"),
    ("hf_beta", "Beta (Hindi)"),
    ("hm_omega", "Omega (Hindi)"),
    ("hm_psi", "Psi (Hindi)"),
    # Italian
    ("if_sara", "Sara (Italian)"),
    ("im_nicola", "Nicola (Italian)"),
    # Brazilian Portuguese
    ("pf_dora", "Dora (Portuguese)"),
    ("pm_alex", "Alex (Portuguese)"),
    ("pm_santa", "Santa (Portuguese)"),
]
SAFE = re.compile(r"[^a-zA-Z0-9._-]+")
VOICES.mkdir(parents=True, exist_ok=True)
PREVIEWS.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Tayang local TTS")
_pocket = None
_pocket_lock = threading.Lock()
_kokoro = {}
_kokoro_lock = threading.Lock()
_prepared_lock = threading.Lock()


class SpeakRequest(BaseModel):
    text: str = Field(min_length=1, max_length=200_000)
    engine: Optional[str] = None
    voice: Optional[str] = None
    language: str = "id"
    out: str


class EngineRequest(BaseModel):
    engine: str


class PreviewRequest(BaseModel):
    engine: Optional[str] = None
    voice: Optional[str] = None
    language: str = "id"


def authorized(authorization: Optional[str]) -> None:
    if not TOKEN:
        return
    expected = f"Bearer {TOKEN}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="unauthorized")


def safe_name(name: str) -> str:
    base = SAFE.sub("-", Path(name).name).strip("-._")
    return base or "voice"


def output_path(requested: str) -> Path:
    p = Path(requested)
    if not p.is_absolute():
        p = ROOT / p
    p = p.resolve()
    try:
        p.relative_to(ROOT)
    except ValueError:
        raise HTTPException(status_code=400, detail="out is outside the workspace")
    if p.suffix.lower() not in {".wav", ".mp3"}:
        raise HTTPException(status_code=400, detail="out must end in .wav or .mp3")
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def custom_voice(voice: str) -> Optional[Path]:
    candidate = (VOICES / safe_name(voice)).resolve()
    if candidate.is_file() and candidate.suffix.lower() in {".wav", ".mp3", ".flac", ".ogg", ".m4a"}:
        return candidate
    return None


def voice_for_pocket(voice: Optional[str]) -> str:
    if voice:
        found = custom_voice(voice)
        if found:
            return str(found)
        if voice in POCKET_BUILTINS:
            return POCKET_BUILTINS[voice]
    return POCKET_DEFAULT_VOICE


def write_audio(audio: np.ndarray, sample_rate: int, out: Path) -> float:
    audio = np.asarray(audio, dtype=np.float32)
    if audio.ndim > 1:
        audio = audio.reshape(-1, audio.shape[-1])[0]
    audio = np.nan_to_num(audio, nan=0.0, posinf=0.0, neginf=0.0)
    tmp = out.with_suffix(".part.wav")
    sf.write(tmp, audio, sample_rate)
    if out.suffix.lower() == ".mp3":
        # Write to a fresh part file so LAME never asks about overwriting a previous narration.
        part = out.with_suffix(".part.mp3")
        part.unlink(missing_ok=True)
        subprocess.run(["lame", "--silent", "-V", "4", str(tmp), str(part)], check=True)
        tmp.unlink(missing_ok=True)
        os.replace(part, out)
    else:
        shutil.move(str(tmp), out)
    try:
        info = sf.info(str(out))
        return float(info.frames) / float(info.samplerate)
    except Exception:
        return 0.0


def load_pocket():
    global _pocket
    if _pocket is not None:
        return _pocket
    from pocket_tts import TTSModel

    with _pocket_lock:
        if _pocket is None:
            _pocket = TTSModel.load_model(config=POCKET_CONFIG, eos_threshold=POCKET_EOS)
    return _pocket


def speak_pocket(text: str, voice: Optional[str], out: Path) -> float:
    model = load_pocket()
    with _pocket_lock:
        state = model.get_state_for_audio_prompt(voice_for_pocket(voice), truncate=True)
        audio = model.generate_audio(state, text)
        sample_rate = getattr(model, "sample_rate", None) or getattr(
            getattr(model, "config", None), "sample_rate", None
        ) or 24000
    mark_prepared("pocket")
    return write_audio(np.asarray(audio), int(sample_rate), out)


def kokoro_language(language: str, voice: Optional[str] = None) -> str:
    prefixes = {"af": "a", "am": "a", "bf": "b", "bm": "b", "ef": "e", "em": "e", "ff": "f", "hf": "h", "hm": "h", "if": "i", "im": "i", "pf": "p", "pm": "p"}
    if voice:
        prefix = voice.split("_", 1)[0]
        if prefix in prefixes:
            return prefixes[prefix]
    if language.startswith("en"):
        return "a"
    if language.startswith("es"):
        return "e"
    if language.startswith("fr"):
        return "f"
    if language.startswith("hi"):
        return "h"
    if language.startswith("it"):
        return "i"
    if language.startswith("pt"):
        return "p"
    return "a"


def load_kokoro(language: str, voice: Optional[str] = None):
    from kokoro import KPipeline

    key = kokoro_language(language, voice)
    with _kokoro_lock:
        if key not in _kokoro:
            _kokoro[key] = KPipeline(lang_code=key)
        return _kokoro[key]


def speak_kokoro(text: str, voice: Optional[str], out: Path, language: str) -> float:
    selected = voice if voice and voice in {v for v, _ in KOKORO_VOICES} else "af_heart"
    pipe = load_kokoro(language, voice)
    with _kokoro_lock:
        chunks = []
        for _, _, audio in pipe(text, voice=selected):
            chunks.append(np.asarray(audio))
    if not chunks:
        raise RuntimeError("Kokoro produced no audio")
    mark_prepared("kokoro")
    return write_audio(np.concatenate(chunks), 24000, out)


def read_prepared() -> dict:
    try:
        data = json.loads(PREPARED_FILE.read_text("utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def mark_prepared(engine: str) -> None:
    with _prepared_lock:
        data = read_prepared()
        data[engine] = datetime.now(timezone.utc).isoformat()
        try:
            PREPARED_FILE.write_text(json.dumps(data), "utf-8")
        except OSError:
            pass


def is_prepared(engine: str) -> bool:
    if engine == "pocket" and _pocket is not None:
        return True
    if engine == "kokoro" and _kokoro:
        return True
    return engine in read_prepared()


def read_default() -> dict:
    try:
        data = json.loads((VOICES / "config.json").read_text("utf-8"))
        return {
            "engine": data.get("engine") if data.get("engine") in {"pocket", "kokoro"} else "pocket",
            "voice": data.get("voice") if isinstance(data.get("voice"), str) else "pocket-id-1",
        }
    except Exception:
        return {"engine": "pocket", "voice": "pocket-id-1"}


def custom_voices() -> list[dict]:
    out = []
    for p in sorted(VOICES.iterdir()):
        if p.is_file() and p.suffix.lower() in {".wav", ".mp3", ".flac", ".ogg", ".m4a"} and p.name != "config.json":
            out.append({"id": p.name, "name": p.stem, "custom": True})
    return out


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "pocket": POCKET_CONFIG, "voices": len(custom_voices())}


@app.get("/voices")
def voices(authorization: Optional[str] = Header(default=None)) -> dict:
    authorized(authorization)
    custom = custom_voices()
    return {
        "default": read_default(),
        "engines": [
            {
                "id": "pocket",
                "name": "Pocket TTS",
                "description": "Indonesian, voice cloning",
                "voices": [
                    {"id": "pocket-id-1", "name": "Indonesia 1", "custom": False},
                    {"id": "pocket-id-2", "name": "Indonesia 2", "custom": False},
                    {"id": "pocket-id-3", "name": "Indonesia 3", "custom": False},
                    {"id": "pocket-id-4", "name": "Indonesia 4", "custom": False},
                    *custom,
                ],
            },
            {
                "id": "kokoro",
                "name": "Kokoro",
                "description": "English, Spanish, French, Hindi, Italian and Portuguese · no Indonesian",
                "voices": [{"id": v, "name": n, "custom": False} for v, n in KOKORO_VOICES],
            },
        ],
    }


@app.get("/status")
def status(authorization: Optional[str] = Header(default=None)) -> dict:
    authorized(authorization)
    return {"engines": {engine: {"prepared": is_prepared(engine)} for engine in ("pocket", "kokoro")}}


@app.post("/prepare")
def prepare(req: EngineRequest, authorization: Optional[str] = Header(default=None)) -> dict:
    authorized(authorization)
    engine = req.engine if req.engine in {"pocket", "kokoro"} else None
    if engine is None:
        raise HTTPException(status_code=400, detail="engine must be pocket or kokoro")
    started = time.time()
    try:
        if engine == "pocket":
            load_pocket()
        else:
            load_kokoro("en")
        mark_prepared(engine)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}")
    return {"ok": True, "engine": engine, "seconds": round(time.time() - started, 1)}


@app.post("/preview")
def preview(req: PreviewRequest, authorization: Optional[str] = Header(default=None)) -> dict:
    authorized(authorization)
    default = read_default()
    engine = req.engine if req.engine in {"pocket", "kokoro"} else default["engine"]
    voice = req.voice or (default["voice"] if engine == default["engine"] else ("af_heart" if engine == "kokoro" else "pocket-id-1"))
    text = (
        "Halo, ini contoh suara lokal dari Pocket TTS. Semoga harimu menyenangkan."
        if engine == "pocket"
        else "Hello, this is a Kokoro voice preview for your video."
    )
    out = PREVIEWS / f"{engine}-{safe_name(voice)}.mp3"
    try:
        if engine == "kokoro":
            seconds = speak_kokoro(text, voice, out, req.language)
        else:
            seconds = speak_pocket(text, voice, out)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}")
    return {"path": str(out), "durationSec": seconds, "engine": engine, "voice": voice}


@app.post("/speak")
def speak(req: SpeakRequest, authorization: Optional[str] = Header(default=None)) -> dict:
    authorized(authorization)
    out = output_path(req.out)
    default = read_default()
    engine = req.engine if req.engine in {"pocket", "kokoro"} else default["engine"]
    voice = req.voice or default["voice"]
    try:
        if engine == "kokoro":
            seconds = speak_kokoro(req.text, voice, out, req.language)
        else:
            seconds = speak_pocket(req.text, voice, out)
    except HTTPException:
        raise
    except Exception as exc:  # keep the agent-facing message short and honest
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}")
    return {"path": str(out), "durationSec": seconds, "engine": engine, "voice": voice}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")), log_level="info")
