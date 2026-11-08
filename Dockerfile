# syntax=docker/dockerfile:1

# ---- 1. The React app, built for the browser transport (HTTP + SSE) ----
FROM node:22-bookworm-slim AS web
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY scripts ./scripts
COPY apps/desktop/package.json apps/desktop/tsconfig.json apps/desktop/index.html apps/desktop/vite.config.ts apps/desktop/vitest.config.ts ./apps/desktop/
COPY apps/desktop/src ./apps/desktop/src
COPY apps/desktop/public ./apps/desktop/public
# Dev-only binaries (ffmpeg-static/ffprobe-static) are not needed to build the web bundle, and
# their postinstall downloads make the image build depend on GitHub releases being up.
RUN pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm build:web

# ---- 2. The headless Rust server (no WebKit, GTK, or display server) ----
FROM rust:1.99-bookworm AS rust
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
# Workspace metadata needs the desktop manifest/targets even though this image never builds them.
COPY apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/build.rs ./apps/desktop/src-tauri/
COPY apps/desktop/src-tauri/src ./apps/desktop/src-tauri/src
RUN cargo build --release -p tayang-server

# ---- 3. Runtime: Node + ffmpeg for agents, non-root user, one persistent volume ----
FROM node:22-bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg git tini \
    && rm -rf /var/lib/apt/lists/*

# Chromium renders frames for the video engine; it also brings the system libraries that
# hyperframes' bundled headless shell needs. Debian's package is detected as Google Chrome.
RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium fonts-liberation \
    && rm -rf /var/lib/apt/lists/*
# The container runs with no-new-privileges, so Chrome's setuid sandbox cannot start. The wrapper
# also keeps the 64 MB /dev/shm used by heavy video pages from crashing the renderer.
RUN printf '%s\n' '#!/bin/sh' 'exec /usr/bin/chromium --no-sandbox --disable-dev-shm-usage "$@"' > /usr/local/bin/chromium \
    && chmod 755 /usr/local/bin/chromium \
    && ln -s /usr/local/bin/chromium /usr/local/bin/google-chrome

RUN groupadd --gid 10001 tayang \
    && useradd --uid 10001 --gid tayang --create-home --home-dir /data/home tayang

WORKDIR /app
COPY --from=rust /src/target/release/tayang-server /usr/local/bin/tayang-server
COPY --from=web /src/apps/desktop/dist /app/dist
COPY packages/skills/agent-plugin /app/agent-plugin

RUN mkdir -p /data/workspaces /data/home /data/tmp /data/thumbs /data/style-media /data/style-refs /data/templates /data/voices /data/hf-cache \
    && chown -R tayang:tayang /data /app

# Default agents for the self-hosted edition. opencode's free models work without an account;
# Claude Code and Codex are installed so they can be signed in from Settings › Agents. All are
# pinned for reproducible deployments. Extend the image to add Gemini or other tools.
ARG OPENCODE_VERSION=2.2.6
ARG CLAUDE_CODE_VERSION=2.1.319
ARG CODEX_VERSION=0.167.0
RUN mkdir -p /opt/opencode \
    && HOME=/opt/opencode VERSION=${OPENCODE_VERSION} bash -c 'curl -fsSL https://opencode.ai/v2/install | bash -s -- --no-modify-path' \
    && ln -sf /opt/opencode/.opencode/bin/opencode /usr/local/bin/opencode \
    && npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} @openai/codex@${CODEX_VERSION} \
    && npm cache clean --force

ENV NODE_ENV=production \
    TAYANG_BIND=0.0.0.0:8787 \
    TAYANG_DATA_DIR=/data \
    TAYANG_WORKSPACE_ROOT=/data/workspaces \
    TAYANG_DIST_DIR=/app/dist \
    TAYANG_AGENT_PLUGIN_DIR=/app/agent-plugin \
    HOME=/data/home \
    XDG_DATA_HOME=/data/home/.local/share \
    CHROME_BIN=/usr/local/bin/chromium \
    CHROME_PATH=/usr/local/bin/chromium \
    PATH=/data/home/.local/bin:/usr/local/bin:/usr/bin:/bin

USER tayang
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8787/api/health || exit 1
ENTRYPOINT ["/usr/bin/tini", "--", "tayang-server"]
