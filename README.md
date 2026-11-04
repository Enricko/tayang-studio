# Tayang Studio

Tayang Studio is a free, open-source desktop app that helps Indonesian creators make motion videos without writing prompts. It picks topics, writes scripts and handles the prompting, while the user's own AI agent (Claude Code, opencode, Gemini CLI, Codex or any ACP agent) does the building.

## Run it

```
pnpm install
pnpm dev:desktop
```

Requires Node 22+, pnpm and Rust. See [docs/development.md](docs/development.md) for the full setup, API deployment and where data lives.

## Layout

```
tayang-desktop/
├── apps/
│   ├── desktop/   @tayang/desktop  Tauri + React desktop app
│   └── api/       @tayang/api      Hono API (optional, online features)
├── packages/
│   ├── shared/    @tayang/shared   Types and schemas shared across apps
│   └── skills/    @tayang/skills   Agent skills bundled with Tayang
├── docs/                           Spec and implementation plan
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

## Scripts

| Script | Command | Purpose |
| --- | --- | --- |
| `pnpm test` | `pnpm -r test` | Run tests in every workspace package |
| `pnpm typecheck` | `pnpm -r typecheck` | Type-check every workspace package |
| `pnpm dev:desktop` | `pnpm --filter @tayang/desktop tauri dev` | Run the desktop app in dev mode |
| `pnpm dev:api` | `pnpm --filter @tayang/api dev` | Run the API in dev mode |

## How it works

- The agent runs over ACP. Tayang has no AI of its own: every generation goes through the agent you already use.
- Installs go through the agent too. Tayang shows you every command your agent asks to run, and nothing it asks about runs until you allow it. An agent whose own settings already allow a command won't ask, so check your agent's permission settings (see `docs/development.md`).
- You pick a working folder. Projects live there and keep their folder if you change it later. Agent sessions work in the working folder or in a project's own folder.
- App data is stored in a local SQLite database, so the desktop app keeps its data on this computer and doesn't need the API (your agent still needs its own internet connection).
- The API is optional and only adds the online features.

## Privacy

Tayang sends a random install ID, your system (macOS, Windows or Linux), its version and the app version once a day. Nothing about you or your videos. The API stores no IP address, name or path.

To turn it off, open Settings › Account and switch off "Share anonymous install stats".

For the owner: set the secret with `wrangler secret put ADMIN_TOKEN`, then `GET /v1/stats` with `Authorization: Bearer <ADMIN_TOKEN>` returns the counts. `pnpm --filter @tayang/api stats -- --remote` prints the same table straight from D1 (use `--local` for the dev database). Set `TAYANG_API_URL` when starting the desktop app to point it at another API; it is used instead of the saved API URL and never stored.

## Credits

UI polished with unslop by Damir Sokolovsky (@heydamir), CC BY 4.0.
