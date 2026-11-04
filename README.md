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
- Installs go through the agent too, and nothing runs on your computer until you press Allow on the permission request.
- You pick a working folder. Projects live there, and agent sessions never work outside it.
- App data is stored in a local SQLite database, so the desktop app keeps its data on this computer and doesn't need the API (your agent still needs its own internet connection).
- The API is optional and only adds the online features.

## Credits

UI polished with unslop by Damir Sokolovsky (@heydamir), CC BY 4.0.
