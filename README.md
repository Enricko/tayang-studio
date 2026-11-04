# Tayang Studio

Tayang Studio is a free, open-source desktop app that helps Indonesian creators make motion videos without writing prompts. It picks topics, writes scripts and handles the prompting, while the user's own AI agent (Claude Code, opencode, Gemini CLI, Codex or any ACP agent) does the building.

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
