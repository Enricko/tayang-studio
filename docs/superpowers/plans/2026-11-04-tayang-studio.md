# Tayang Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working, cross-platform Tayang Studio desktop app (Tauri) that connects to the user's AI agent over ACP, checks/installs requirements through the agent, guides video creation in chat with a frame-accurate preview, and keeps projects, styles and jobs in local SQLite — plus a Hono/D1 backend skeleton for tayang.app.

**Architecture:** pnpm monorepo. `apps/desktop` = Tauri 2 (Rust core: SQLite, system detection, ACP client, ffmpeg media helpers) + React UI. `apps/api` = Hono on Cloudflare Workers with D1, deployed by wrangler. `packages/shared` holds TS types/contracts and pure helpers used by UI and API; Rust mirrors the types with serde camelCase. `packages/skills` holds every prompt Tayang sends to agents.

**Tech Stack:** pnpm 11 workspaces, TypeScript 5 strict, Vitest 4, React 19, Vite 8, Tailwind CSS 4, Zustand 5, @tauri-apps/api 2, Tauri 2.12 (Rust 2021, rusqlite 0.41 bundled, tokio, serde, agent-client-protocol 5 crate), Hono 4, wrangler 4, Cloudflare D1, HyperFrames CLI (`npx hyperframes`), ffmpeg/ffprobe.

**Spec:** `docs/superpowers/specs/2026-11-04-tayang-studio-design.md`. Visual reference (exact colors, copy, layout): https://claude.ai/artifact/YQ5VdN8VyaRqaHq8hYBD1h

## Global Constraints

- Node.js floor for the app's own tooling: 22. Rendering requirement check: Node `>= 22`.
- Cross-platform: macOS, Windows, Linux. No hard-coded `/` paths in Rust; use `PathBuf`. Package managers: `brew` (macOS), `winget` (Windows), `apt`/`dnf`/`pacman` (Linux).
- Interface language English. Copy: sentence case, no exclamation marks, no trailing period on labels/buttons, say "this computer" never "this Mac".
- Brand tokens: ink `#141414`, sidebar `#0F0F0F`, card `#1A1A1A`, raised `#262626`, hairline `#262626`/`#333333`, text `#FDFDFD` / `#B4B4B4` / `#8C8C8C`, accent `#F2470C` (text on accent `#141414`), deep orange `#5C1C08`, tint `#2A140C`, light orange text `#FFB08F`. Fonts: Plus Jakarta Sans (UI, weights 400–600, 800 only onboarding hero), IBM Plex Mono (figures/meta), Lora (script text). Radii: controls 8, cards 12, panels 16. 4px spacing grid. Icons: lucide-react, 16/18px, stroke 1.5.
- One orange (accent) primary action per screen.
- Oyen expressions: wink = queued, sleepy = working, happy = done, surprised = error, default = idle/needs you. Assets copied from `/Users/macbookpro/development/web/niche-to-video/brand/` (logo/master, logo/expressions, patterns/dither-*.png).
- No AI inside Tayang: every generation and every install goes through the user's agent over ACP.
- Nothing executes on the user's computer from an agent without the user pressing Allow on the permission request.
- Each agent ACP session's working directory is the project folder (or a `.tayang/<purpose>` subfolder of the working folder) — never outside the working folder.
- Desktop works fully offline; the API is optional.
- Rust ↔ TS types: Rust structs use `#[serde(rename_all = "camelCase")]`, enums `#[serde(rename_all = "kebab-case")]` unless noted; field names below are the TS names.

## Review Focus

1. Working folder or project title containing spaces, non-ASCII or quotes (e.g. `~/Video Saya/Kopi "Senja"`) → project folders are created and ffmpeg/agent calls still work (args passed as arrays, never shell strings). Test in Task 7 and Task 9.
2. Agent process crashes or exits mid-prompt → UI shows an error message, the job becomes `failed`, the chat is usable again (no infinite spinner). Test in Task 8 (fake agent `--crash`) and Task 12.
3. User dismisses or cancels a permission request → Tayang answers the agent with the reject/cancel outcome; no command is reported as run. Test in Task 8 and Task 11.
4. Version strings in the wild (`v22.12.0`, `ffmpeg version n7.1-tessus`, `ffmpeg version 7.1.1-full_build-www.gyan.dev`, `2026.10.22`) and missing binaries → parsed or reported as not found, never a panic. Test in Task 2 and Task 6.
5. Titles that slugify to empty or collide (`"???"`, two `"Promo"` projects) → unique, non-empty folder names. Test in Task 2 and Task 7.

---

## File Structure

```
package.json, pnpm-workspace.yaml, tsconfig.base.json, .gitignore, README.md
packages/shared/src/{types.ts,api.ts,helpers.ts,index.ts}            + test/helpers.test.ts
packages/skills/src/{install.ts,project.ts,style.ts,builtinStyles.ts,frameCheck.ts,index.ts} + test/*.test.ts
apps/api/{wrangler.toml,migrations/0001_init.sql,src/{index.ts,routes/*.ts,repo.ts}}  + test/*.test.ts
apps/desktop/
  index.html, vite.config.ts, src/main.tsx, src/styles/tokens.css, src/assets/brand/*
  src/lib/{ipc.ts,events.ts}                 typed invoke/listen wrappers
  src/state/{app.ts,chat.ts}                 zustand stores
  src/components/{Sidebar.tsx,Oyen.tsx,AgentLogo.tsx,Button.tsx,PermissionCard.tsx,...}
  src/screens/onboarding/{Welcome,Connect,Requirements}.tsx
  src/screens/{ChatProject,ChatNew,Videos,Style,Agents,Calendar,Settings}.tsx
  src/screens/preview/{Preview.tsx,Scrubber.tsx}
  src/test/*.test.tsx
  src-tauri/{Cargo.toml,tauri.conf.json,build.rs,capabilities/default.json}
  src-tauri/src/{main.rs,lib.rs,types.rs,db.rs,system.rs,projects.rs,acp.rs,media.rs,commands.rs}
  src-tauri/tests/{fake_agent.mjs,acp_test.rs}
```

Execution order and parallel waves (tasks in a wave touch disjoint files):
- Wave 1: Task 1
- Wave 2: Tasks 2, 3, 4, 5
- Wave 3: Tasks 6, 7, 8, 9
- Wave 4: Task 10
- Wave 5: Tasks 11, 12, 13, 14
- Wave 6: Task 15

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.npmrc` (if needed), `README.md`, empty package dirs with `package.json` for `packages/shared` (`@tayang/shared`), `packages/skills` (`@tayang/skills`), `apps/api` (`@tayang/api`), `apps/desktop` (`@tayang/desktop`)

**Interfaces:**
- Produces: root scripts `pnpm test` (runs `pnpm -r test`), `pnpm typecheck` (`pnpm -r typecheck`), `pnpm dev:desktop` (`pnpm --filter @tayang/desktop tauri dev`), `pnpm dev:api` (`pnpm --filter @tayang/api dev`). Each workspace package has `test` (`vitest run`) and `typecheck` (`tsc --noEmit`) scripts. `tsconfig.base.json`: `strict`, `target ES2022`, `module ESNext`, `moduleResolution Bundler`, `noUncheckedIndexedAccess`. Internal packages are consumed as source (`"main": "src/index.ts"`, `"types": "src/index.ts"`).

- [ ] **Step 1:** `git init`, create files above. README states: what Tayang Studio is (one paragraph from the spec "Why"), the layout, and the four root scripts.
- [ ] **Step 2:** Run `pnpm install` → succeeds. Run `pnpm -r exec node -e "1"` → every package listed.
- [ ] **Step 3:** Commit `chore: scaffold tayang monorepo`.

---

### Task 2: `@tayang/shared` types and helpers

**Files:**
- Create: `packages/shared/src/types.ts`, `api.ts`, `helpers.ts`, `index.ts`; Test: `packages/shared/test/helpers.test.ts`

**Interfaces:**
- Produces (types, all exported from `index.ts`):
  - `AgentId = 'claude' | 'opencode' | 'gemini' | 'codex' | 'custom'`
  - `AgentInfo { id: AgentId; name: string; installed: boolean; version: string | null; acpCommand: string[]; recommended: boolean }`
  - `OsKind = 'macos' | 'windows' | 'linux'`; `PackageManager = 'brew' | 'winget' | 'apt' | 'dnf' | 'pacman'`
  - `SystemInfo { os: OsKind; osVersion: string; packageManager: PackageManager | null }`
  - `ToolId = 'node' | 'ffmpeg' | 'chrome' | 'ytdlp' | 'elevenlabs-mcp'`
  - `ToolStatus { id: ToolId; name: string; required: boolean; found: boolean; version: string | null; ok: boolean; detail: string }`
  - `VideoKind = 'explainer' | 'promo' | 'quote' | 'news' | 'tutorial' | 'data' | 'event'`; `VideoFormat = '9:16' | '1:1' | '16:9'`; `VideoLanguage = 'id' | 'en'`
  - `ProjectStatus = 'draft' | 'building' | 'rendered' | 'scheduled'`
  - `Project { id: string; title: string; slug: string; folder: string; kind: VideoKind; format: VideoFormat; language: VideoLanguage; status: ProjectStatus; styleId: string | null; scheduledAt: string | null; durationSec: number | null; createdAt: string; updatedAt: string }`
  - `NewProject { title: string; kind: VideoKind; format: VideoFormat; language: VideoLanguage; styleId?: string | null }`
  - `Chat { id: string; projectId: string | null; agentId: AgentId; title: string; createdAt: string }`
  - `Mark { x: number; y: number }` (0–1 relative)
  - `MessagePart = { type: 'text'; text: string } | { type: 'mention'; projectId: string; title: string } | { type: 'frame'; projectId: string; frame: number; timeSec: number; imagePath: string; marks: Mark[] } | { type: 'tool'; toolCallId: string; title: string; status: 'pending' | 'running' | 'done' | 'failed' }`
  - `ChatMessage { id: string; chatId: string; role: 'user' | 'agent' | 'system'; parts: MessagePart[]; createdAt: string }`
  - `StyleAspect = 'camera' | 'pacing' | 'type' | 'color' | 'captions' | 'transitions'`
  - `Style { id: string; name: string; source: 'builtin' | 'copied' | 'mine'; sourceUrl: string | null; notes: Partial<Record<StyleAspect, string>>; prompt: string; createdAt: string }`
  - `JobKind = 'build' | 'render' | 'install' | 'study-style' | 'script'`; `JobStatus = 'queued' | 'working' | 'needs-you' | 'done' | 'failed'`
  - `Job { id: string; kind: JobKind; title: string; projectId: string | null; chatId: string | null; agentId: AgentId; status: JobStatus; progress: number | null; note: string | null; updatedAt: string }`
  - `Settings { workingFolder: string; defaultAgent: AgentId; frameCheck: boolean; language: VideoLanguage; format: VideoFormat; fps: number; onboarded: boolean }` (defaults: workingFolder `<home>/Tayang`, `claude`, `true`, `id`, `9:16`, `30`, `false`)
  - `AgentUpdate = { kind: 'text'; text: string } | { kind: 'thought'; text: string } | { kind: 'tool'; toolCallId: string; title: string; status: 'pending' | 'running' | 'done' | 'failed' } | { kind: 'done'; stopReason: string } | { kind: 'error'; message: string }`
  - `PermissionRequest { chatId: string; requestId: string; title: string; commands: string[]; options: { id: string; label: string; kind: 'allow-once' | 'allow-always' | 'reject-once' | 'reject-always' }[] }`
  - `MediaInfo { durationSec: number; fps: number; frames: number; width: number; height: number }`
- `api.ts`: `Feature = 'voiceover' | 'cloud-render' | 'premium-styles' | 'autopilot'`; `HealthResponse { ok: true; version: string }`; `Entitlements { plan: 'free' | 'pro'; features: Feature[] }`.
- `helpers.ts`:
  - `slugify(title: string): string` — lowercase ASCII, Indonesian/Latin accents stripped, non-alphanumerics → `-`, trimmed, max 48 chars; empty result → `"video"`.
  - `uniqueSlug(base: string, taken: string[]): string` — `base`, then `base-2`, `base-3`…
  - `parseVersion(raw: string): string | null` — first `\d+(\.\d+)+` match (`"v22.12.0"`→`"22.12.0"`, `"ffmpeg version n7.1-tessus"`→`"7.1"`, `"ffmpeg version 7.1.1-full_build-www.gyan.dev"`→`"7.1.1"`, `"2026.10.22"`→`"2026.10.22"`, `"nope"`→`null`).
  - `versionAtLeast(v: string | null, min: number): boolean` — compares major.
  - `requiredMissing(tools: ToolStatus[]): ToolStatus[]` — required && !ok.
  - `formatTimecode(sec: number, fps: number): string` — `"0:11.00"` style (m:ss.cc where cc = frame/fps*100 floored).
  - `frameAt(sec: number, fps: number): number` / `secAt(frame: number, fps: number): number`.

- [ ] **Step 1: Write failing tests** in `helpers.test.ts`: every example above as an assertion; `slugify("Kenapa Rupiah Melemah?")==="kenapa-rupiah-melemah"`, `slugify("???")==="video"`, `slugify('Kopi "Senja" ÉLAN')==="kopi-senja-elan"`, `uniqueSlug("promo",["promo"])==="promo-2"`, `uniqueSlug("promo",["promo","promo-2"])==="promo-3"`, `versionAtLeast("22.12.0",22)===true`, `versionAtLeast("20.1.0",22)===false`, `versionAtLeast(null,22)===false`, `formatTimecode(11,30)==="0:11.00"`, `formatTimecode(11.5,30)==="0:11.50"`, `frameAt(11,30)===330`.
- [ ] **Step 2:** `pnpm --filter @tayang/shared test` → FAIL.
- [ ] **Step 3:** Implement types and helpers.
- [ ] **Step 4:** Test → PASS; `pnpm --filter @tayang/shared typecheck` → clean.
- [ ] **Step 5:** Commit `feat(shared): types, api contracts and helpers`.

---

### Task 3: `@tayang/skills` prompts

**Files:**
- Create: `packages/skills/src/{install.ts,project.ts,style.ts,builtinStyles.ts,frameCheck.ts,index.ts}`; Test: `packages/skills/test/skills.test.ts`

**Interfaces:**
- Consumes: types from `@tayang/shared`.
- Produces:
  - `buildInstallPrompt(tool: ToolId, sys: SystemInfo, agent: AgentId, opts?: { elevenLabsKey?: string }): string` — plain request + exact expected commands for the OS. Commands: ffmpeg: brew `brew install ffmpeg`, winget `winget install --id Gyan.FFmpeg -e`, apt `sudo apt install -y ffmpeg`, dnf `sudo dnf install -y ffmpeg`, pacman `sudo pacman -S --noconfirm ffmpeg`; ytdlp: brew `brew install yt-dlp`, winget `winget install --id yt-dlp.yt-dlp -e`, linux `pipx install yt-dlp`; node: brew `brew install node@22`, winget `winget install --id OpenJS.NodeJS.LTS -e`, linux via package manager `nodejs`; chrome: brew `brew install --cask google-chrome`, winget `winget install --id Google.Chrome -e`, linux: tell agent to install `chromium` via the package manager; elevenlabs-mcp for agent `claude`: `claude mcp add elevenlabs -e ELEVENLABS_API_KEY=<key> -- uvx elevenlabs-mcp` (install `uv` first if missing). For other agents: instruct to add an MCP server named `elevenlabs` running `uvx elevenlabs-mcp` with env `ELEVENLABS_API_KEY` in that agent's own MCP config. Every install prompt ends: "Then verify with `<verify command>` and reply with only the version you see." Verify commands: `ffmpeg -version`, `yt-dlp --version`, `node --version`, chrome: report the path found. The key appears in the prompt verbatim (it's sent to the user's own agent), never logged by Tayang.
  - `installCommands(tool: ToolId, sys: SystemInfo, agent: AgentId): string[]` — the commands listed above (for showing the expected commands in the UI before the agent's own permission request arrives); key shown as `sk_••••`.
  - `buildProjectBrief(p: Project, style: Style | null, settings: Settings): string` — the AGENTS.md content Tayang writes into each project folder: project facts, video language, format/fps, "use HyperFrames (`npx hyperframes`) and keep all files in this folder", the style prompt, and the quality loop (render stills of every scene, check overlaps/cut-off text/timing, fix, then report "Frames checked").
  - `buildTopicIdeasPrompt(kinds: VideoKind[], language: VideoLanguage): string` — asks the agent for exactly 3 topic ideas as a JSON array `[{ "title": string, "kind": VideoKind, "lengthSec": number }]` in a fenced ```json block.
  - `parseTopicIdeas(agentText: string): { title: string; kind: VideoKind; lengthSec: number }[]` — extracts the first ```json block; invalid → `[]`.
  - `buildStudyStylePrompt(url: string, outDir: string): string` — download with `yt-dlp` into `outDir`, sample ~48 frames with ffmpeg scene detection plus regular interval, study camera/pacing/type/color/captions/transitions, write `<outDir>/style.json` as `{ name, notes: { camera, pacing, type, color, captions, transitions }, prompt }`, then delete the video and frames. Copy the look, never the footage.
  - `parseStyleResult(json: string, url: string): Omit<Style, 'id' | 'createdAt'> | null` — validates shape; `source: 'copied'`, `sourceUrl: url`.
  - `BUILTIN_STYLES: Style[]` — three styles with exact name/notes/prompt from the canvas: "Bold explainer", "Kinetic quote", "News recap" (ids `builtin-bold-explainer`, `builtin-kinetic-quote`, `builtin-news-recap`, `createdAt: "2026-11-04T00:00:00Z"`).
  - `FRAME_CHECK_PROMPT: string` — standalone instruction for the quality loop.

- [ ] **Step 1: Write failing tests:** `buildInstallPrompt('ffmpeg', {os:'macos',osVersion:'26',packageManager:'brew'}, 'claude')` contains `brew install ffmpeg` and `ffmpeg -version`; windows variant contains `winget install --id Gyan.FFmpeg -e`; `installCommands('elevenlabs-mcp', mac, 'claude')` equals `['brew install uv', 'claude mcp add elevenlabs -e ELEVENLABS_API_KEY=sk_•••• -- uvx elevenlabs-mcp']`; `parseTopicIdeas` on text with a valid ```json block returns 3 items and on garbage returns `[]`; `parseStyleResult` rejects missing `prompt`; `BUILTIN_STYLES.length === 3`; `buildProjectBrief` contains the style prompt and `Frames checked`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS, typecheck clean.
- [ ] **Step 5:** Commit `feat(skills): prompts for install, project brief, topics and style study`.

---

### Task 4: `@tayang/api` Hono + D1 skeleton

**Files:**
- Create: `apps/api/{wrangler.toml,migrations/0001_init.sql,src/index.ts,src/repo.ts,src/routes/health.ts,src/routes/entitlements.ts,vitest.config.ts}`; Test: `apps/api/test/api.test.ts`

**Interfaces:**
- Consumes: `HealthResponse`, `Entitlements`, `Feature` from `@tayang/shared`.
- Produces: `export default app` (Hono app, `Bindings = { DB: D1Database; API_VERSION: string }`). Routes: `GET /health` → `HealthResponse` with `version` from `API_VERSION`; `GET /v1/entitlements` with header `Authorization: Bearer <token>` → `Entitlements` (looks up `accounts` by `token_hash` = SHA-256 hex of token; unknown/missing → 401 `{ error: "unauthorized" }`; free account → `{ plan:'free', features: [] }`). `Repo` interface `{ findAccountByTokenHash(hash: string): Promise<{ id: string; plan: 'free' | 'pro'; features: Feature[] } | null> }` with `d1Repo(db: D1Database): Repo`; app built by `createApp(repoFactory = d1Repo)` so tests inject a fake.
- `migrations/0001_init.sql`: tables `accounts(id TEXT PK, email TEXT UNIQUE, token_hash TEXT UNIQUE, plan TEXT NOT NULL DEFAULT 'free', created_at TEXT NOT NULL)`, `account_features(account_id TEXT, feature TEXT, PRIMARY KEY(account_id, feature))`.
- `wrangler.toml`: `name = "tayang-api"`, `main = "src/index.ts"`, `compatibility_date = "2026-11-01"`, `[[d1_databases]] binding = "DB" database_name = "tayang" database_id = "REPLACE_ME"`, `[vars] API_VERSION = "0.1.0"`. Scripts: `dev` = `wrangler dev`, `deploy` = `wrangler deploy`, `db:migrate` = `wrangler d1 migrations apply tayang`.

- [ ] **Step 1: Write failing tests** using `createApp(() => fakeRepo).request(...)`: `/health` → 200 `{ ok: true, version: "0.1.0" }`; `/v1/entitlements` without header → 401; with a token whose hash maps to a pro account with `['voiceover']` → 200 `{ plan:'pro', features:['voiceover'] }`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (add deps `hono`, dev `wrangler`, `@cloudflare/workers-types`). **Step 4:** Run → PASS; typecheck clean.
- [ ] **Step 5:** Commit `feat(api): hono worker with d1 entitlements skeleton`.

---

### Task 5: Desktop scaffold, design tokens, shell and sidebar

**Files:**
- Create: `apps/desktop/{index.html,vite.config.ts,vitest.config.ts,tsconfig.json,src/main.tsx,src/App.tsx,src/styles/tokens.css,src/assets/brand/*}`, `src/components/{Sidebar.tsx,Oyen.tsx,AgentLogo.tsx,Button.tsx}`, `src/state/app.ts`, `src/lib/ipc.ts` (stub signatures only, see Task 10), `src-tauri/{Cargo.toml,build.rs,tauri.conf.json,capabilities/default.json,src/main.rs,src/lib.rs}`, `src/test/setup.ts`, `src/test/sidebar.test.tsx`

**Interfaces:**
- Produces:
  - `type Route = { name: 'welcome' } | { name: 'connect' } | { name: 'requirements' } | { name: 'chat-new' } | { name: 'chat'; chatId: string } | { name: 'videos' } | { name: 'style' } | { name: 'agents' } | { name: 'calendar' } | { name: 'settings' }`
  - `useApp` zustand store: `{ route: Route; navigate(r: Route): void; settings: Settings | null; setSettings(s: Settings): void }`
  - `<Sidebar active: 'chat' | 'videos' | 'style' | 'agents' | 'calendar' | 'settings' />` — logo (`tayang-horizontal-reversed-color.svg`) + "Studio", "New chat" (secondary), nav Chat/Videos/Style/Agents/Calendar, "Recent" (last 3 projects, via `ipc.listProjects`), Settings, agent status card with dither-card corner glow. Exact look: canvas Sidebar artboard.
  - `<Oyen mood: 'default' | 'wink' | 'happy' | 'sleepy' | 'surprised' size?: number />`; `<AgentLogo id: AgentId | ToolId size?: number />` (logos from simple-icons: claude `#D97757`, googlegemini `#8E75B2`, openai, nodedotjs `#5FA04E`, ffmpeg, elevenlabs, googlechrome; opencode mark from its repo — use the exact SVGs uploaded to the canvas, which are also at the scratchpad path given in the task brief).
  - `<Button variant: 'primary' | 'secondary' | 'ghost' | 'light' ...props />`.
  - `App.tsx` renders onboarding routes full-window and app routes inside shell (sidebar + content). Unbuilt screens render a placeholder heading with the screen name (replaced by later tasks).
  - Tauri: `identifier = "app.tayang.studio"`, `productName = "Tayang Studio"`, window 1280×800, min 1024×700, `titleBarStyle` overlay on macOS. Plugins: `tauri-plugin-dialog`, `tauri-plugin-opener`. Asset protocol enabled for the working folder (scope `$HOME/**`).
- [ ] **Step 1:** Scaffold Tauri 2 + React + Vite + Tailwind 4 + Vitest (jsdom, @testing-library/react). Copy brand assets.
- [ ] **Step 2: Failing test** `sidebar.test.tsx`: renders `<Sidebar active="videos" />` with ipc mocked (`listProjects` → 3 projects); "Videos" link has `aria-current="page"`; shows "New chat"; shows the 3 project titles under "Recent".
- [ ] **Step 3:** Implement; run tests → PASS; `pnpm --filter @tayang/desktop typecheck` clean; `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` succeeds.
- [ ] **Step 4:** Commit `feat(desktop): tauri shell, tokens and sidebar`.

---

### Task 6: Rust system detection (`system.rs`, `types.rs`)

**Files:**
- Create: `apps/desktop/src-tauri/src/types.rs` (serde mirrors of every Task 2 type the Rust side returns), `src/system.rs`; tests inline (`#[cfg(test)]`)

**Interfaces:**
- Produces:
  - `pub trait Exec { fn run(&self, program: &str, args: &[&str]) -> Option<String>; fn which(&self, program: &str) -> Option<PathBuf>; }` with `RealExec` (std::process::Command, stdout+stderr joined, 5 s timeout, `None` on spawn failure).
  - `pub fn system_info(exec: &dyn Exec) -> SystemInfo` (os from `cfg!`, version via `sw_vers -productVersion` / `cmd /c ver` / `/etc/os-release`; package manager = first found of the OS's list).
  - `pub fn parse_version(raw: &str) -> Option<String>` (same rules as TS `parseVersion`).
  - `pub fn detect_agents(exec: &dyn Exec) -> Vec<AgentInfo>`: binaries `claude`, `opencode`, `gemini`, `codex`; `acpCommand`: claude → `["npx","-y","@agentclientprotocol/claude-agent-acp"]`, opencode → `["opencode","acp"]`, gemini → `["gemini","--experimental-acp"]`, codex → `["npx","-y","@zed-industries/codex-acp"]`; claude `recommended: true`. Order: claude, opencode, gemini, codex.
  - `pub fn check_tools(exec: &dyn Exec, agent: AgentId, home: &Path) -> Vec<ToolStatus>`: node (required, ok if major ≥ 22, `detail` "Runs the video engine · needs 22 or newer"), ffmpeg (required), chrome (required; macOS `/Applications/Google Chrome.app`, Windows `%ProgramFiles%\Google\Chrome\Application\chrome.exe`, Linux `google-chrome`/`chromium`/`chromium-browser` on PATH; version optional), ytdlp (recommended), elevenlabs-mcp (recommended; for `claude` read `<home>/.claude.json` and look for an `mcpServers` key named containing `elevenlabs` at top level or under any `projects.*.mcpServers`; other agents: `found=false`, detail "Check your agent's MCP settings").
  - `pub fn elevenlabs_in_claude_config(json: &str) -> bool`.
- [ ] **Step 1: Failing tests** with a `FakeExec` (HashMap program→output): parse_version cases from Review Focus 4; node `v20.11.0` → `ok=false`; missing ffmpeg → `found=false, ok=false`, no panic; `elevenlabs_in_claude_config(r#"{"mcpServers":{"elevenlabs":{}}}"#)` true, project-scoped variant true, `{}` false, invalid JSON false; detect_agents with only `claude` present → 4 entries, only claude installed.
- [ ] **Step 2:** `cargo test system` → FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(desktop): detect os, agents and required tools`.

---

### Task 7: Rust storage and projects (`db.rs`, `projects.rs`)

**Files:**
- Create: `apps/desktop/src-tauri/src/db.rs`, `src/projects.rs`; tests inline

**Interfaces:**
- Consumes: `types.rs` (Task 6) — if Task 6 isn't merged yet, add the needed structs to `types.rs` with identical names/fields.
- Produces:
  - `pub struct Db(Mutex<rusqlite::Connection>)`; `Db::open(path: &Path) -> Result<Db>`; `Db::open_in_memory()`; migrations run on open (tables `settings(key PK, value JSON)`, `projects`, `chats`, `messages(parts JSON)`, `styles(notes JSON)`, `jobs`). DB file: `<app_data_dir>/tayang.db`.
  - Settings: `get_settings(&self, home: &Path) -> Settings` (defaults from Task 2), `update_settings(&self, patch: serde_json::Value) -> Settings`.
  - Projects: `list_projects() -> Vec<Project>` (updatedAt desc), `insert_project(&Project)`, `update_project(id, patch: serde_json::Value) -> Project`, `get_project(id) -> Option<Project>`.
  - Chats/messages: `create_chat(project_id: Option<&str>, agent: AgentId, title: &str) -> Chat`, `list_chats(project_id: Option<&str>) -> Vec<Chat>`, `add_message(chat_id, role, parts: &[MessagePart]) -> ChatMessage`, `list_messages(chat_id) -> Vec<ChatMessage>`.
  - Styles: `list_styles() -> Vec<Style>` (builtins seeded on first open with the same three ids/names/prompts as Task 3 `BUILTIN_STYLES`), `save_style(&Style)`, `delete_style(id)` (builtins can't be deleted → error).
  - Jobs: `upsert_job(&Job)`, `list_jobs() -> Vec<Job>`.
  - `projects.rs`: `pub fn create_project_folder(working: &Path, title: &str, existing_slugs: &[String]) -> io::Result<(String /*slug*/, PathBuf)>` using slugify/unique rules from Task 2 (port to Rust: `slugify`, `unique_slug`); creates `<working>/<slug>/` and writes `AGENTS.md` placeholder (content filled by UI via `write_project_brief`). `pub fn write_project_brief(folder: &Path, brief: &str) -> io::Result<()>` writes `AGENTS.md` and `CLAUDE.md` (same content). `pub fn ensure_inside(working: &Path, p: &Path) -> bool`.
- [ ] **Step 1: Failing tests:** settings defaults; update_settings round-trip; insert/list/update project; chat + 2 messages round-trip with a `frame` part; builtin styles seeded once (open twice → still 3); delete builtin → Err; `create_project_folder` in a tempdir named `Video Saya` with title `Kopi "Senja"` → folder `kopi-senja` exists; title `???` → `video`; second `Promo` → `promo-2`; `ensure_inside` rejects `../x`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement (deps `rusqlite` with `bundled`, `uuid`, `chrono`, `tempfile` dev). **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(desktop): sqlite storage and project folders`.

---

### Task 8: Rust ACP client (`acp.rs`)

**Files:**
- Create: `apps/desktop/src-tauri/src/acp.rs`, `src-tauri/tests/fake_agent.mjs`, `src-tauri/tests/acp_test.rs`

**Interfaces:**
- Produces:
  - `pub struct AgentSession` and `pub struct AcpManager` (holds sessions by `chat_id`).
  - `AcpManager::start(&self, chat_id: &str, command: &[String], cwd: &Path, sink: Arc<dyn AcpSink>) -> Result<()>` — spawns the agent (args array, `cwd` set), performs ACP `initialize` (client capabilities: `fs.readTextFile`/`writeTextFile` true, `terminal` false) and `session/new` with `cwd`.
  - `AcpManager::prompt(&self, chat_id: &str, parts: Vec<PromptPart>) -> Result<()>` — sends `session/prompt`; `PromptPart = Text(String) | Image { path: PathBuf }` (image read from disk, base64, mime from extension). Streams `session/update` notifications to `sink.update(chat_id, AgentUpdate)` mapping: agent message chunks → `text`, thought chunks → `thought`, tool calls/updates → `tool`; prompt response → `done { stopReason }`.
  - Permission: on `session/request_permission`, call `sink.permission(PermissionRequest)` (commands = tool call raw input `command` if present, else title) and wait for `AcpManager::respond_permission(request_id, option_id: Option<String>)`; `None` → respond `cancelled` outcome. Pending permissions are cancelled if the session ends.
  - File system requests (`fs/read_text_file`, `fs/write_text_file`) served only when `projects::ensure_inside(cwd, path)`; otherwise JSON-RPC error.
  - `AcpManager::cancel(chat_id)` (`session/cancel`), `AcpManager::stop(chat_id)` (kill child).
  - Child exit while a prompt is in flight → `sink.update(chat_id, AgentUpdate::Error { message: "The agent stopped unexpectedly" })`.
  - `pub trait AcpSink: Send + Sync { fn update(&self, chat_id: &str, u: AgentUpdate); fn permission(&self, req: PermissionRequest); }`
  - Implementation choice: use the `agent-client-protocol` crate (v5) client-side types and connection if workable; otherwise a hand-rolled newline-delimited JSON-RPC 2.0 client over the child's stdio following the ACP schema (method names: `initialize`, `session/new`, `session/prompt`, `session/cancel`, `session/update`, `session/request_permission`, `fs/read_text_file`, `fs/write_text_file`). Protocol version 1.
- `fake_agent.mjs` (Node, no deps): speaks ACP over stdio; on prompt `"hello"` streams two text chunks then ends `end_turn`; on `"install"` sends a tool call with rawInput `{ command: "brew install ffmpeg" }` and a permission request with options allow-once/reject-once, then streams `"installed"` if allowed or `"skipped"` if rejected/cancelled; on `"crash"` exits with code 1 mid-turn.
- [ ] **Step 1: Failing integration tests** in `acp_test.rs` with a recording sink, launching `node tests/fake_agent.mjs`: hello → updates `text("Hel")`, `text("lo")`, `done("end_turn")`; install + respond allow-once → permission seen with `commands == ["brew install ffmpeg"]`, then text `installed`; install + respond `None` → text `skipped`; crash → `error` update received within 5 s; fs write outside cwd → error.
- [ ] **Step 2:** FAIL. **Step 3:** Implement (tokio process + io). **Step 4:** `cargo test --test acp_test` PASS.
- [ ] **Step 5:** Commit `feat(desktop): acp client with permissions and fake agent tests`.

---

### Task 9: Rust media helpers (`media.rs`)

**Files:**
- Create: `apps/desktop/src-tauri/src/media.rs`; tests inline (skip with a message when `ffmpeg` isn't on PATH)

**Interfaces:**
- Produces:
  - `pub fn latest_render(folder: &Path) -> Option<PathBuf>` — newest `*.mp4` in `<folder>/renders/` then `<folder>/`.
  - `pub fn probe(video: &Path) -> Result<MediaInfo>` via `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate,nb_frames:format=duration -of json`.
  - `pub fn extract_frame(video: &Path, time_sec: f64, out_dir: &Path) -> Result<PathBuf>` → `<out_dir>/frame-<ms>.png` via `ffmpeg -y -ss <t> -i <video> -frames:v 1 <out>`.
  - `pub fn thumbnails(video: &Path, count: u32, out_dir: &Path) -> Result<Vec<PathBuf>>` → evenly spaced frames scaled to height 96.
  - `pub fn render(folder: &Path) -> Result<PathBuf>` → runs `npx hyperframes render` in `folder` (args array), returns `latest_render`. (Exact HyperFrames CLI flags: implementer checks `npx hyperframes --help`; output must land in `<folder>/renders/`.)
  - All commands built with `Command::new(...).args([...])`, never a shell string.
- [ ] **Step 1: Failing tests:** generate a 2-second test clip in a tempdir whose path contains a space and `"` (`ffmpeg -f lavfi -i testsrc=size=270x480:rate=30 -t 2 clip.mp4`); `probe` → duration ≈ 2.0, fps 30, 270×480; `extract_frame(…, 1.0, …)` file exists; `thumbnails(…, 6, …)` returns 6 files; `latest_render` picks newest.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS (or reported skipped when ffmpeg missing — then install ffmpeg via `brew install ffmpeg` and re-run).
- [ ] **Step 5:** Commit `feat(desktop): ffmpeg probe, frames, thumbnails and render`.

---

### Task 10: Tauri commands, events and typed IPC

**Files:**
- Create: `apps/desktop/src-tauri/src/commands.rs`; Modify: `src-tauri/src/lib.rs` (state + `invoke_handler`); Modify: `apps/desktop/src/lib/ipc.ts`, Create: `src/lib/events.ts`; Test: `src/test/ipc.test.ts`

**Interfaces:**
- Consumes: Tasks 6–9.
- Produces Tauri commands (snake_case in Rust, TS wrapper name in `ipc.ts` in camelCase, args camelCase):
  - `get_system_info() -> SystemInfo`, `detect_agents() -> AgentInfo[]`, `check_tools(agent) -> ToolStatus[]`
  - `get_settings() -> Settings`, `update_settings(patch) -> Settings`, `pick_folder() -> string | null` (dialog)
  - `list_projects()`, `create_project(input: NewProject, brief: string) -> Project` (creates folder under working folder + writes brief), `update_project(id, patch) -> Project`
  - `list_chats(projectId?)`, `create_chat(projectId: string | null, agentId, title) -> Chat`, `list_messages(chatId)`, `add_message(chatId, role, parts) -> ChatMessage`
  - `list_styles()`, `save_style(style)`, `delete_style(id)`, `read_style_result(studyId) -> string | null` (reads `<working>/.tayang/style-study/<studyId>/style.json`), `study_dir(studyId) -> string` (creates it)
  - `list_jobs()`, `upsert_job(job)`
  - `agent_start(chatId, agentId) -> void` (cwd = project folder for project chats; `<working>/.tayang/chats/<chatId>` for new chats; `<working>/.tayang/setup` for install chats), `agent_prompt(chatId, parts: MessagePart[]) -> void` (text/mention → text; frame → image + text "Frame <n> at <timecode>, scene marks: …"), `agent_cancel(chatId)`, `agent_respond_permission(requestId, optionId: string | null)`
  - `media_latest_render(projectId) -> string | null`, `media_probe(projectId) -> MediaInfo | null`, `media_extract_frame(projectId, timeSec) -> string`, `media_thumbnails(projectId, count) -> string[]`, `media_render(projectId) -> string`
  - Events: `agent://update` payload `{ chatId: string; update: AgentUpdate }`, `agent://permission` payload `PermissionRequest`.
  - `events.ts`: `onAgentUpdate(cb): Promise<UnlistenFn>`, `onPermission(cb): Promise<UnlistenFn>`.
  - `ipc.ts` exports one async function per command with the TS types from `@tayang/shared`, plus `assetUrl(path: string): string` (`convertFileSrc`).
- [ ] **Step 1: Failing test** `ipc.test.ts`: with `@tauri-apps/api/mocks` `mockIPC`, `ipc.createProject(input, brief)` calls `create_project` with `{ input, brief }`; `ipc.agentRespondPermission('r1', null)` sends `{ requestId: 'r1', optionId: null }`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement Rust + TS. **Step 4:** Vitest PASS; `cargo build` succeeds; `cargo test` all green.
- [ ] **Step 5:** Commit `feat(desktop): tauri commands, agent events and typed ipc`.

---

### Task 11: Onboarding screens

**Files:**
- Create: `apps/desktop/src/screens/onboarding/{Welcome.tsx,Connect.tsx,Requirements.tsx}`, `src/components/PermissionCard.tsx`, `src/state/install.ts`; Test: `src/test/requirements.test.tsx`

**Interfaces:**
- Consumes: `ipc` (Task 10), `@tayang/skills` `buildInstallPrompt`, `installCommands`; `requiredMissing` from shared.
- Produces:
  - `<PermissionCard request: PermissionRequest ask?: string onRespond(optionId: string | null) />` — shows "Tayang asked <Agent>", the ask text (Lora), "<Agent> wants to run" + commands (mono), buttons "Allow and install" (light variant; maps to the first `allow-once` option) and "Cancel" (→ `null`). Reused by chat (Task 12) with label "Allow".
  - `useInstall` store: `start(tool: ToolId, opts?)` → creates/uses the setup chat (`agent_start` on `chatId = "setup"`), sends `buildInstallPrompt`, tracks per-tool state `'missing' | 'key' | 'confirm' | 'running' | 'done' | 'failed'`, log lines from tool updates, re-runs `check_tools` on `done`; `failed` on `error` update.
  - Screens match the canvas artboards exactly (copy, order, states): Welcome (step 1 of 3; dither; three fanned posts with winking Oyen), Connect (step 2 of 3; real logos; "Connect" sets `defaultAgent`), Requirements (step 3 of 3; "Check your computer"; "Installs run through <agent>" + "Detected <os> · <package manager>" + "Check again"; Required/Recommended groups; ElevenLabs warning "No voiceover without ElevenLabs" + API key step; "Start my first video" disabled with "Install <name> to continue" until `requiredMissing` is empty; on start → `update_settings({ onboarded: true })` and navigate `chat-new`).
  - App start: if `settings.onboarded` → `chat-new`, else `welcome`.
- [ ] **Step 1: Failing tests** (ipc mocked): ffmpeg missing → start button disabled and text "Install FFmpeg to continue"; click FFmpeg "Install" → `agentPrompt` called with text containing `brew install ffmpeg`; emitting a permission event renders the commands and "Allow and install"; clicking Cancel calls `agentRespondPermission(requestId, null)` and the row returns to "Install"; after a `done` update and `check_tools` returning ffmpeg ok, the start button is enabled.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(desktop): onboarding with agent-driven installs`.

---

### Task 12: Chat — new chat with @mention and project chat

**Files:**
- Create: `apps/desktop/src/screens/ChatNew.tsx`, `src/screens/ChatProject.tsx`, `src/components/{Composer.tsx,MentionMenu.tsx,MessageList.tsx,StepBar.tsx}`, `src/state/chat.ts`; Test: `src/test/chat.test.tsx`

**Interfaces:**
- Consumes: ipc/events (Task 10), `PermissionCard` (Task 11), skills `buildProjectBrief`, `buildTopicIdeasPrompt`, `parseTopicIdeas`, `BUILTIN_STYLES`.
- Produces:
  - `useChat` store: `messages: Record<chatId, ChatMessage[]>`, `streaming: Record<chatId, boolean>`, `send(chatId, parts: MessagePart[])` (persists via `add_message`, calls `agent_prompt`), handles `agent://update` (appends/merges agent text into the last agent message, tool parts, sets `streaming=false` on `done`/`error`, writes an error system message on `error`), `pendingPermission: Record<chatId, PermissionRequest | null>`.
  - `<Composer chatId onSend attachments? />` — textarea; `@` opens `<MentionMenu>` listing projects (↑ ↓ ↵ Esc); choosing inserts a `mention` chip; quick chips row (project chat only): "Faster pace", "Bigger text", "Change colors", "Add music", "Make it 15s"; agent selector shows default agent with logo.
  - ChatNew: "What are we making?" + three option cards (From a topic → asks agent for ideas via `buildTopicIdeasPrompt` and shows them as clickable cards; Remix a video → opens mention menu; Copy a style → navigates `style`); header "No video attached" / "1 video attached". Sending with a mention of project X: the prompt includes the project's folder and brief so the agent has it as context; without a mention, no project info is sent.
  - Picking a topic idea → `create_project` (brief from `buildProjectBrief`), `create_chat(projectId)`, navigate `chat` with that chat; project chat shows `StepBar` (Topic, Script, Style, Build, Render — derived from project status: draft→Script, building→Build, rendered→Render) and `MessageList` with Oyen avatars (sleepy while streaming).
  - Right panel slot renders `<Preview projectId />` (Task 13; until merged, a placeholder div with `data-testid="preview-slot"`).
- [ ] **Step 1: Failing tests:** typing `@` shows project titles; Enter inserts a chip and header becomes "1 video attached"; sending without a mention calls `agentPrompt` with no `mention` part; an `agent://update` text sequence renders one merged agent message; an `error` update shows "The agent stopped unexpectedly" and re-enables the composer; a permission event renders `PermissionCard` and Allow sends the allow option id.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(desktop): chat with @mention, streaming and permissions`.

---

### Task 13: Preview panel and frame scrubber

**Files:**
- Create: `apps/desktop/src/screens/preview/{Preview.tsx,Scrubber.tsx}`; Test: `src/test/scrubber.test.tsx`

**Interfaces:**
- Consumes: `media_*` ipc, `assetUrl`, `formatTimecode`, `frameAt`, `secAt`; `useChat` attachments API: `useChat.getState().attach(chatId, part: MessagePart)`, `detach(chatId, index)` (add to Task 12's store if missing).
- Produces:
  - `<Preview projectId chatId />`: 9:16 `<video>` of `media_latest_render` (empty state with sleepy Oyen "Nothing rendered yet" + "Render preview" button calling `media_render`), play/pause, ‹ › step one frame, timecode `0:11.00 / 0:34.00`, "Frame 330", "Send frame to chat" (calls `media_extract_frame` → attaches a `frame` part with marks), "Mark a spot" (next click on the video adds a numbered pin at relative x/y), keycap hint row, "Frames checked" with happy Oyen when the last agent message contains "Frames checked".
  - `<Scrubber durationSec fps frame thumbnails: string[] onSeek(frame: number) />`: thumbnail strip (12 thumbs from `media_thumbnails`), draggable handle (pointer events), tooltip "<timecode> · <scene>" when scenes known, keyboard on the focused strip: ← → ±1 frame, Shift+← → ±fps frames; `role="slider"` with `aria-valuemin=0`, `aria-valuemax=frames-1`, `aria-valuenow=frame`, `aria-valuetext=<timecode>`.
- [ ] **Step 1: Failing tests:** ArrowRight on the slider calls `onSeek(331)` from 330; Shift+ArrowRight → 360; pointer drag to 50% of a 1020-frame strip → `onSeek(510)` (±1); "Send frame to chat" calls `mediaExtractFrame(projectId, 11)` at frame 330 and attaches a `frame` part `{ frame: 330, timeSec: 11 }`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(desktop): preview with frame scrubber and send frame`.

---

### Task 14: Videos, Style, Agents, Calendar, Settings screens

**Files:**
- Create: `apps/desktop/src/screens/{Videos.tsx,Style.tsx,Agents.tsx,Calendar.tsx,Settings.tsx}`; Test: `src/test/screens.test.tsx`

**Interfaces:**
- Consumes: ipc (Task 10), skills `buildStudyStylePrompt`, `parseStyleResult`, `useInstall` (Task 11) for the Settings tools section.
- Produces (all matching the canvas artboards' copy and layout):
  - Videos: grid from `list_projects`, tabs All / In progress (draft+building) / Rendered / Scheduled with counts, search filters by title, status dot + meta, click → open (or create) the project's chat. Empty state: default Oyen + "No videos yet" + "New chat".
  - Style: "Copy a style from a video" (URL input + "Study video" primary): validates TikTok / instagram.com/reel / youtube.com / youtu.be URLs (else inline error "Paste a TikTok, Reels or YouTube link"); creates `study_dir`, a `study-style` job, starts agent chat `study-<id>` with cwd = that dir, sends `buildStudyStylePrompt`; on `done`, `read_style_result` → `parseStyleResult` → `save_style` and job `done`; parse failure → job `failed` with note. Library tabs Built in / Copied from videos / Yours, detail panel (sampled frames placeholder, notes, prompt in mono, "Use in a new chat", "Edit prompt" → editable textarea + Save creating/updating a `mine` style).
  - Agents: kanban columns Queued / Working / Needs you / Done (failed jobs also in Needs you with surprised Oyen and "Fix it" → opens the job's chat) with column Oyen moods wink / sleepy / default / happy; header shows installed agents with logos and state.
  - Calendar: month grid (Mon-first, 6 rows, today highlighted), projects with `scheduledAt` (ready = rendered/scheduled → raised chip with orange dot; others planned → dashed), prev/next/Today, "Ideas for this week" (via `buildTopicIdeasPrompt`, cached), Autopilot card (mono kicker "TAYANG AUTOPILOT", "Biar Tayang yang tayangin", "See plans" opens `https://tayang.app` with the opener plugin).
  - Settings: default agent radio (installed agents), "Check every frame before showing me" switch, working folder (path + "Change" → `pick_folder` → `update_settings`), video defaults (language, format, fps), "Where to render" (This computer; Cloud "with a plan" disabled), Tools (same rows/installs as Requirements), Account card ("Sign in to tayang.app" opens the site).
- [ ] **Step 1: Failing tests:** Videos tab "Rendered" shows only rendered projects and its count; Style invalid URL shows the inline error and doesn't call `agentPrompt`; valid TikTok URL calls `studyDir`, `upsertJob` with `kind: 'study-style'` and `agentPrompt`; Agents puts a `failed` job in "Needs you" with "Fix it"; Calendar for 2026-11 renders Monday Oct 26 as the first cell and 42 cells; Settings switch toggles `frameCheck` via `updateSettings`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(desktop): videos, style, agents, calendar and settings`.

---

### Task 15: End-to-end wiring check and docs

**Files:**
- Modify: `README.md`; Create: `docs/development.md`

- [ ] **Step 1:** Run `pnpm test`, `pnpm typecheck`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` → all green.
- [ ] **Step 2:** Run `pnpm --filter @tayang/desktop tauri build --debug` (or `cargo build`) → builds. Launch `pnpm dev:desktop` briefly and confirm the window opens on Welcome (screenshot if possible).
- [ ] **Step 3:** `docs/development.md`: prerequisites (Node 22+, pnpm, Rust, ffmpeg for media tests), how to run desktop/api, how to deploy api (`wrangler d1 create tayang`, set `database_id`, `pnpm --filter @tayang/api db:migrate`, `pnpm --filter @tayang/api deploy`), where data lives (SQLite in app data dir, projects in the working folder).
- [ ] **Step 4:** Commit `docs: development guide`.
