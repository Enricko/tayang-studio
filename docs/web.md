# Self-hosted web edition

Tayang Studio can run as a single-user web app on a Linux server. The browser uses the same React
interface as the desktop app; a headless Rust server owns the database, ACP agent processes, project
files, renders and scheduling. Closing a tab does not stop an agent or a render.

The desktop app is unchanged: `pnpm dev:desktop` still runs the Tauri build against the same shared
core crate.

## Architecture

```
Browser (React, same screens/i18n/styles)
  │  cookie session + CSRF, JSON-RPC, SSE, multipart uploads, HTTP Range
  ▼
tayang-server (Axum, no Tauri/WebKit/display server)
  ├─ auth: argon2id password, hashed server sessions, origin/CSRF checks
  ├─ SQLite (shared schema + web_sessions/web_events/web_pending/web_turns/web_claims)
  ├─ ACP manager: claude / opencode / codex / gemini processes, permissions, questions
  ├─ filesystem: project folders confined to TAYANG_WORKSPACE_ROOT
  ├─ media: ffmpeg/ffprobe, renders, frames, thumbnails, range-served assets
  └─ scheduler: reminders, autopilot slots, late-render reconciliation
        │
        ▼
tayang-core (shared by Tauri and the server)
  db, acp, projects, files, media, styles, Claude account, usage, types
```

The React transport is selected at build time:

- `pnpm dev:desktop` / `pnpm build`: `lib/ipc.desktop.ts` and `lib/events.desktop.ts` (Tauri).
- `pnpm dev:web` / `pnpm build:web`: `lib/ipc.ts` and `lib/events.ts` (HTTP + SSE).

`lib/platform.ts` is the only platform boundary for browser/desktop operations (opening links,
native file picker vs. upload input, notifications, window dragging, auto-update, autostart). All
Tauri imports there are dynamic and only run on desktop; the web entry point loads no Tauri code.

## Feature availability

| Area | Self-hosted web |
| --- | --- |
| Projects, chats, messages, styles, custom styles | Yes |
| ACP agents, streamed replies, permission cards, questions | Yes, server-side |
| Image/file attachments, project file browser | Yes (browser upload / read-only file viewer) |
| Renders, preview, frame seeking, thumbnails, download | Yes (HTTP Range) |
| Scheduling, reminders, autopilots | Yes, server-side |
| Agent asks to start/schedule a video from chat | Yes, via the local action endpoint |
| Voice-over | Yes, local Pocket TTS (Indonesian, custom voice cloning) and Kokoro (built-in voices) |
| Multi-tab access to the same account | Yes (SSE replay, idempotent start, resolved-card events) |
| Tayang cloud billing / paid plans | Removed from the UI (`BILLING_ENABLED = false`) |
| Tayang cloud sign-in, social posting, cloud AI images | No; explicit `unavailable` capability and UI notice |
| Desktop folder picker, background tray, autostart, in-app updates | No; server workspace and deployment updates |
| Built-in style sync | Yes, through the public API; cached styles work offline |

Features that need the private Tayang cloud API are never mocked. The API returns
`cloud:unavailable` / `billing:unavailable`, and `GET /api/capabilities` explains why.

## Development

Requirements: Node 22+, pnpm 11.5.3 (the repo pins it), Rust stable, ffmpeg and ffprobe.

```bash
pnpm install

# Terminal 1: headless server on 8787
TAYANG_WEB_PASSWORD='correct horse battery staple' \
TAYANG_PUBLIC_URL='http://localhost:5173' \
TAYANG_DATA_DIR="$PWD/.data-web" \
TAYANG_WORKSPACE_ROOT="$PWD/.data-web/workspaces" \
pnpm server:dev

# Terminal 2: web dev server on 5173 (proxies /api and /api/events to 8787)
pnpm dev:web
```

Open <http://localhost:5173>. The first server start creates `<workspace>/tayang` and stores it as
the working folder. `TAYANG_PUBLIC_URL` must be the browser origin (`5173` here) so origin checks and
cookies match.

To keep the desktop workflow:

```bash
pnpm dev:desktop
pnpm test
pnpm typecheck
```

The server refuses to start without `TAYANG_WEB_PASSWORD` or `TAYANG_WEB_PASSWORD_HASH`. Generate a
hash without writing the password into the environment file:

```bash
cargo run -p tayang-server -- hash-password
# or non-interactively:
TAYANG_WEB_PASSWORD='...' cargo run -p tayang-server -- hash-password
```

## Production on a Linux server

Run the server as an unprivileged user. It needs no display server, X11, Wayland, WebKit or Tauri.

```bash
pnpm install --frozen-lockfile
pnpm build:web
cargo build --release -p tayang-server

sudo useradd --system --home /srv/tayang --shell /usr/sbin/nologin tayang
sudo install -d -o tayang -g tayang /srv/tayang/data
sudo install -d -o tayang -g tayang /srv/tayang/data/workspaces

sudo -u tayang env \
  TAYANG_BIND=127.0.0.1:8787 \
  TAYANG_PUBLIC_URL=https://studio.example.com \
  TAYANG_DATA_DIR=/srv/tayang/data \
  TAYANG_WORKSPACE_ROOT=/srv/tayang/data/workspaces \
  TAYANG_DIST_DIR="$PWD/apps/desktop/dist" \
  TAYANG_AGENT_PLUGIN_DIR="$PWD/packages/skills/agent-plugin" \
  TAYANG_WEB_PASSWORD='a long random passphrase' \
  TAYANG_COOKIE_SECURE=true \
  TAYANG_TRUST_PROXY=true \
  TAYANG_TTS_SERVICE_URL=http://127.0.0.1:8000 \
  TAYANG_TTS_TOKEN='a random internal token' \
  "$PWD/target/release/tayang-server"
```

Put it under systemd with the same environment and `WorkingDirectory`, restart on failure, and
limit resources (`MemoryMax`, `TasksMax`, `PrivateTmp`). `TAYANG_COOKIE_SECURE=true` is required
behind HTTPS. `TAYANG_TRUST_PROXY=true` is only for a trusted reverse proxy that sets
`X-Forwarded-For` / `X-Forwarded-Proto`; never expose the Axum port directly to the internet.

Health endpoints:

```bash
curl -fsS http://127.0.0.1:8787/api/health
# {"status":"ok","version":"0.0.4","database":true,"agents":["opencode"],"uptimeSec":...}
```

`/api/health` is unauthenticated but exposes no user data.

## Docker and Compose

```bash
cp .env.example .env            # host port mapping (default 8787)
cp .env.web.example .env.web    # password, TAYANG_PUBLIC_URL, optionally hash
# Generate the internal token shared by the app and the TTS sidecar:
#   openssl rand -hex 32
# then put it in TAYANG_TTS_TOKEN and keep TAYANG_TTS_SERVICE_URL=http://tts:8000.
docker compose up -d --build
docker compose logs -f tayang tts
```

Compose starts two services on the shared `tayang-data` volume:

- `tayang`: the web server and UI.
- `tts`: a CPU-only FastAPI sidecar with Pocket TTS (Indonesian community model, zero-shot voice
  cloning from a 10–30 second reference clip) and Kokoro (built-in voices). It is not published on
  a host port; only the app container reaches it at `http://tts:8000`. The first narration may take
  a while while the models download into `/data/hf-cache`. The Indonesian Pocket TTS model is
  [anak10thn/pocket-tts-indonesian](https://huggingface.co/anak10thn/pocket-tts-indonesian)
  (CC BY 4.0), built on Kyutai's Pocket TTS.

Choose the default engine/voice, or upload your own reference recording, in **Settings › Voice**.
Every voice has a **Listen** button that renders a short sample, so you can compare the defaults
before using one. Kokoro is marked **English only** here: it speaks English and several other
languages, but not Indonesian; use Pocket TTS for Indonesian videos. The choice is stored in
`/data/voices/config.json`, is handed to new agent sessions as `TAYANG_TTS_ENGINE`/`TAYANG_TTS_VOICE`,
and is read by the sidecar. Uploads are limited to 20 MB and WAV/MP3/FLAC/OGG/M4A. The server never
exposes the internal TTS token to the browser.

**Settings › Tools** lists both engines with a one-click **Install**. It loads/downloads the model
once and records the result in `/data/voices/engines.json`; after that the **Listen** buttons work
without waiting for a download. The preview files live under `/data/thumbs/voice-previews/`.

`TAYANG_HTTP_PORT` in `.env` is a Compose variable for the host port. If 8787 is already used, set
another loopback port there and point the reverse proxy at it. The container always listens on 8787.

The image includes Node 22, ffmpeg/ffprobe, Chromium (with the system libraries Chrome-based
renderers need), git, the server, opencode 2.2.6 (free models work without an account), Claude Code
2.1.319 and Codex 0.167.0. It runs as UID/GID `10001`. The
`tayang-data` volume keeps:

- `/data/tayang.db` — database (same schema as desktop, plus web tables)
- `/data/workspaces/` — projects, renders, frames and attachments
- `/data/style-media/`, `/data/style-refs/`, `/data/thumbs/` — generated style previews and thumbnails
- `/data/claude/` — Claude Code config used by Tayang's Claude sign-in
- `/data/home/` — agent credentials/config (`~/.config/opencode`, `~/.codex`, Gemini, etc.)
- `/data/templates/` — cached style templates

Back up the volume while the service is stopped:

```bash
docker compose stop tayang
docker run --rm -v tayang-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/tayang-data-$(date +%F).tgz -C /data .
docker compose start tayang
```

The server marks agents, renders and "making" slots as interrupted on restart. It does not pretend a
dead process is still running. Planned future autopilot slots resume on the next tick. Run the
service under systemd (default cgroup kill mode) or Docker so ffmpeg/agent child processes stop with
the service too.

If you use a bind mount instead of the named volume:

```bash
sudo chown -R 10001:10001 ./data
```

## Agents on the server

Agent detection runs on the server and describes the server, not the browser. Install the CLIs on
the host (or in the container) and authenticate them there. Their tokens/config stay on the server;
the browser never receives them.

The image already has opencode and Claude Code. Add Codex/Gemini or other tools if you need them:

```bash
docker compose exec -u root tayang npm install -g @openai/codex
docker compose exec -u root tayang npm install -g @google/gemini-cli
# root-created config dirs must still be writable by the server user:
docker compose exec -u root tayang chown -R 10001:10001 /data/home

# Optional for style studies, in the same environment as the server:
docker compose exec -u root tayang apt-get update
docker compose exec -u root tayang apt-get install -y yt-dlp
```

Installing an agent inside a running container is convenient for a first test, but those binaries are
lost when the container is recreated. For a durable deployment extend the image (or install the CLI
on the host and mount its binary/prefix). Agent credentials and configs in `/data/home` and
`/data/claude` survive.

### Use the server owner's existing agent logins (single-user)

This edition has one owner, so the simplest deployment is to reuse the logins already present on the
Linux server. The helper copies them into the container's persistent volume and never prints secrets:

```bash
# opencode, Claude Code and Codex must be installed and signed in on the host.
./scripts/web-import-agent-auth.sh
# or: pnpm web:import-agent-auth
```

It:

- exports opencode credentials with `opencode auth export` and imports them through stdin;
- copies `~/.claude/.credentials.json` and `~/.claude.json` into `/data/claude`;
- copies `~/.codex/auth.json` into `/data/home/.codex` (not the host's model config);
- fixes the volume ownership for the container's UID/GID 10001.

Credentials stay on the server in the `tayang-data` volume; they are never returned to the browser.
Re-run the helper after rotating a host login or when a provider token expires. Do not enable this
pattern for a multi-user deployment without separating credentials per user.

Authentication:

- **Claude Code:** open Settings › Agents › Claude › Sign in to Claude. The server starts
  `claude auth login --claudeai` in `/data/claude` and sends the sign-in URL to the browser; open it
  in any browser. The token is stored server-side in `/data/claude`. You can also run
  `docker compose exec -it tayang claude auth login` once.
- **opencode:** `docker compose exec -it tayang opencode auth login` (or its documented provider
  login). Credentials stay in `/data/home`.
- **Codex:** `docker compose exec -it tayang codex login`; credentials stay in `/data/home/.codex`.
  Tayang starts the maintained `@agentclientprotocol/codex-acp` adapter.
- **Gemini CLI:** run it once in the container and follow its sign-in.

Headless limitation: some providers open a browser or wait for a localhost callback. On a headless
server, copy the URL printed by the CLI to a browser that can reach the provider, or use
`ssh -L`/a temporary port forward when the CLI insists on `127.0.0.1`. If interactive sign-in is not
possible, pre-seed the provider's config/token directory and mount it read-only or into `/data`.
Tayang never sees or stores provider passwords.

`GET /api/capabilities` lists installed agents, ffmpeg/ffprobe, the plugin state and the unavailable
cloud features. `detect_agents` in the UI uses the same server environment.

### Permissions and Auto mode

The existing ACP behavior is preserved: a permission request becomes a card, only the allow-once
option is offered as Allow, reject/cancel are explicit, and Auto mode is still applied with the same
rules. Autopilot and style-study sessions use Auto mode; setup/install chats never do. The web
server does not add a broader always-allow option.

Agent configuration can still auto-allow commands (for example a provider's own `permissions.allow`
or a "yolo" mode). Tayang cannot show those. ACP command approval and the chosen working directory
are **not an operating-system sandbox**. Run the server as an unprivileged user and use the container
or a VM as the real boundary; do not mount the Docker socket or unrelated secrets into it.

## Jobs, tabs and restarts

- Agent processes live in the server's `AcpManager`, not in a browser. A tab close/reload does not
  cancel them.
- `agent_start` is idempotent for a chat: a second tab cannot restart and cancel a live session.
- Each event is stored with an id. SSE reconnects replay after `Last-Event-ID` (and the UI's saved
  cursor), so a refreshed tab rebuilds the stream and pending cards. Durable writes are throttled
  while a turn runs; after a reconnect the browser merges the authoritative live snapshot over the
  database copy and clears stale streaming/session state if the server restarted.
- Permission and question requests are stored until answered. Answering one tab broadcasts a
  resolved event; other tabs remove the card instead of answering twice.
- Every agent session gets `TAYANG_AI_URL` and a per-session `TAYANG_AI_TOKEN`. The loopback
  endpoint accepts the bundled skill's `curl -d` JSON for `/video` and `/schedule`; the action is
  delivered to the open chat tab, which starts the project.
- When the TTS sidecar is configured, the same session also gets `TAYANG_TTS_URL`,
  `TAYANG_TTS_TOKEN`, `TAYANG_TTS_ENGINE` and `TAYANG_TTS_VOICE`. `/speak` validates the output path
  inside that chat's project folder before forwarding the narration to the sidecar, so an agent
  cannot write audio anywhere else on the server.
- Autopilot slots are claimed with an atomic `planned → making` SQL update. A second engine pass or
  process cannot start the same slot twice. "Stop now" cancels the server's running turn and only
  marks a slot failed while it is still `making` (a late success cannot overwrite the stop).
- Renders are serialized per project with an in-process lock; a second request gets a clear conflict
  instead of starting a duplicate ffmpeg pipeline.
- On restart, pending cards and in-flight turns are closed, jobs/slots that were running are marked
  failed with a restart note, and the UI reconciles from the database. Agents cannot survive a
  restart; supported future work (planned slots) resumes.

Reminders are evaluated and stamped on the server, so they are not duplicated by each tab. Browser
notifications are delivered only while a tab is open (the browser Notification API needs a page);
there is no closed-tab push service. The Calendar still shows overdue items after reconnecting.

## Reverse proxy (HTTPS, SSE, uploads, video seeking)

The server already supports HTTP Range (`206 Partial Content`), `Accept-Ranges`, ETag and
`Content-Disposition`: do not strip or buffer those headers. Streaming replies use
`text/event-stream`.

Caddy:

```caddyfile
studio.example.com {
  encode gzip
  reverse_proxy 127.0.0.1:8787 {
    flush_interval -1
  }
  request_body {
    max_size 60MB
  }
  header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains"
  }
}
```

Nginx:

```nginx
server {
  listen 443 ssl http2;
  server_name studio.example.com;
  client_max_body_size 60m;

  location /api/events {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
  }

  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_request_buffering off;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

Set `TAYANG_PUBLIC_URL=https://studio.example.com`, `TAYANG_COOKIE_SECURE=true`, and
`TAYANG_TRUST_PROXY=true` when the proxy is the only route in.

## Security notes

- Single owner account, by design. Multi-user roles/team management are out of scope.
- Passwords are argon2id; sessions are random opaque tokens stored as SHA-256 hashes, in HttpOnly,
  SameSite=Lax cookies with `Secure` on HTTPS.
- Every mutating request needs the session's CSRF token; cross-site `Origin` and
  `Sec-Fetch-Site: cross-site` are refused. Login is rate-limited per client IP.
- Upload bodies are capped (`TAYANG_MAX_UPLOAD_MB`, 50 MB by default); filenames are reduced to a
  single safe component and written through the same attachment copier as desktop.
- The browser cannot submit an arbitrary server path: assets and project files are canonicalized and
  must stay under the workspace root or the server's style/thumbnail folders. `..`, absolute paths
  and symlinks that escape are refused.
- There is no shell endpoint. Agents run with the server user's OS permissions; use the container or
  a dedicated VM as the sandbox.
- Provider credentials, the database and the workspace never appear in API responses or frontend
  bundles. `TAYANG_API_URL` only changes the optional style/cloud API base; it does not enable the
  missing private cloud features.

## Tests

```bash
pnpm test
pnpm typecheck
cargo test -p tayang-core
cargo test -p tayang-server
cargo check -p tayang-studio       # desktop compatibility (needs Tauri system libs)
pnpm build:web
```

Server tests cover: argon2 round-trip, session expiry/revocation, cookie parsing, origin/CSRF checks,
workspace/asset path boundaries including symlink escapes, event replay ordering, pending card
durability, turn persistence, atomic slot claims (duplicate autopilot runs), topic parsing, slot
planning and reminder timing.

A manual browser smoke test with the built-in fake ACP agent covers: sign-in, topic/project creation,
upload, streamed agent reply, permission card (including reload while pending), question card,
reload mid-turn, render via `tayang.json`, scrub/seek, download and persisted history. Real agent
verification depends on one installed and authenticated CLI on the server; see above.

## What was verified in this environment

- `pnpm test`: 1,089 tests passed across shared, skills and desktop (71 Vitest files; plus the extra
  server-feature-focused browser smoke run).
- `pnpm typecheck`: passed.
- `cargo test -p tayang-core`: 171 tests passed (media tests included; ffmpeg/ffprobe from pnpm).
- `cargo test -p tayang-server`: 26 tests passed (auth/session/CSRF/origin, path and symlink boundaries, event replay, pending cards, turn persistence, restart recovery, duplicate slot claims, planning/reminders, action tokens, voice upload names).
- `cargo test -p tayang-studio`: 114 unit tests and 47 ACP integration tests passed with
  WebKitGTK/GTK system libs installed.
- `cargo clippy --all-targets -- -D warnings` for core, server and desktop: clean.
- `pnpm build:web`: production build passed; the web entry has no eager Tauri chunk.
- `pnpm --filter @tayang/desktop tauri build --no-bundle --debug`: the existing desktop binary still
  builds against the shared core.
- `docker build` and a container smoke test passed: UID 10001, health endpoint, login, static app,
  plugin present, and graceful `docker stop` exit 0.
- Real ACP verification: `opencode` on this server replied (`WEB_OK`) and ran a shell command
  through the real ACP server path with streamed SSE and persisted message history.
- Browser verification: Chromium completed the full flow above against the fake ACP agent on a clean
  data directory. `ffmpeg` produced a 3-second test render; seeking reached 2.07 s; the download was
  20,351 bytes; reload restored the attachment, agent messages, permission/question transcripts,
  rendered video and project file browser.

The remaining external prerequisites are provider sign-in for Claude/Codex/Gemini and the private
Tayang cloud API (not available by design in this edition).
