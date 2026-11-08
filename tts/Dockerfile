FROM python:3.12-slim

# lame converts the generated WAV to MP3 without pulling the full ffmpeg dependency tree.
# espeak-ng is Kokoro's fallback grapheme-to-phoneme engine; libsndfile reads/writes the audio.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates espeak-ng libsndfile1 lame \
    && rm -rf /var/lib/apt/lists/*

# CPU-only PyTorch: the CUDA wheels are several GB and this server has no GPU.
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch
RUN pip install --no-cache-dir \
    pocket-tts==4.0.1 \
    kokoro==0.9.4 \
    soundfile \
    numpy \
    fastapi \
    "uvicorn[standard]"

# Kokoro's English G2P (misaki) loads spaCy's small English model and otherwise tries to
# download it at runtime, which fails when the sidecar runs as an unprivileged user.
RUN pip install --no-cache-dir \
    https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl

COPY tts/tts_server.py /app/tts_server.py
WORKDIR /app
ENV PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["python", "/app/tts_server.py"]

LABEL org.opencontainers.image.title="Tayang local TTS" \
      org.opencontainers.image.description="Pocket TTS (Indonesian + voice cloning) and Kokoro TTS for self-hosted Tayang Studio"
