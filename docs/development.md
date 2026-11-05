# Development guide

## Prerequisites

- Node 22 or newer
- pnpm (the repo pins the version in `package.json`)
- Rust (stable toolchain) and the Tauri 2 system dependencies for your platform
- ffmpeg on your PATH. The app needs it at runtime and checks for it on first launch.
  - macOS: `brew install ffmpeg`
  - Windows: `winget install --id Gyan.FFmpeg -e`
  - Linux: `sudo apt install ffmpeg`

  The media tests use the bundled `ffmpeg-static` that `pnpm install` fetches, and skip if it is missing.

Install dependencies once from the repo root:

```
pnpm install
```

## Run the desktop app

```
pnpm dev:desktop
```

This starts Vite on port 1420 and the Tauri shell. The first Rust build takes a while. The desktop app keeps its data on this computer and doesn't need the API (your agent still needs its own internet connection).

To check everything:

```
pnpm test
pnpm typecheck
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

## The API

Online features (Google sign-in, paid plans, the built-in styles, install stats) come from the Tayang API at `https://studio.tayang.app/api`. Its code lives in a separate private repository; the desktop app talks to it only over HTTP, using the request and response types in `packages/shared`.

The app works without it: making videos, styles you copy or write, and everything on this computer. To point the app at another API (for example a local one), set Settings › Account › API address, or start the app with `TAYANG_API_URL` (a base with the path, used as given and never saved):

```
TAYANG_API_URL=http://localhost:8787/api pnpm dev:desktop
```

Old saved addresses are migrated when the app reads its settings: `https://api.tayang.app` becomes `https://studio.tayang.app/api`, and `http://localhost:8787` or `http://127.0.0.1:8787` without a path gets `/api` appended.

## Where data lives

- App data (SQLite, `tayang.db`) is in the operating system's app data directory for Tayang Studio.
- Projects live in the working folder the user picks. Agent sessions run with the project folder, or a `.tayang/<purpose>` subfolder of the working folder, as their working directory. They never run outside it.

## Permissions and the agent's own settings

Tayang answers the ACP permission requests an agent sends (`session/request_permission`) and only ever picks the allow-once option after the user presses Allow. It can't see or block commands the agent runs without asking: if the agent's own configuration auto-allows a command (for example Claude Code's `permissions.allow` rules in `~/.claude/settings.json`, or a "yolo"/auto-approve mode), that command runs without a card in Tayang. Tayang does not change agent configuration, with one exception: Auto mode. Style studies always run in auto mode, and chats do when Settings › Agents › Auto mode for chats (or a chat's Auto toggle) is on. For Claude Code, Tayang sends `session/set_mode` with `auto` (and `default` when turned off); if the agent doesn't list an `auto` mode or the switch fails, and for every other agent, Tayang answers each permission request with its allow-once option (never allow-always) and shows "Ran without asking: <command>". A request with no allow-once option still shows the card. The setup (install) chat never runs in auto mode. The product copy is worded to match: "Tayang shows you every command your agent asks to run, and nothing it asks about runs until you allow it."

## Release smoke test

Run this on a packaged build (`pnpm --filter @tayang/desktop tauri build`) before shipping. A release build never falls back to the repo's copy of the agent plugin.

- [ ] The bundle has the plugin: `agent-plugin/.claude-plugin/plugin.json` is in the app's resources (macOS: `Tayang Studio.app/Contents/Resources/agent-plugin/`). Start the app's binary from a terminal (macOS: `Tayang Studio.app/Contents/MacOS/`), start a Claude chat and check stderr has no "plugin.json is missing" warning. Without the plugin Claude still gets the skills, as text in its first prompt, but the bundle is wrong.
- [ ] CSP: style previews load on the Style screen (from the API origin in `img-src`), the style popup plays its preview video (API origin in `media-src`; needs Range responses), and a rendered video and its frames play in the preview.
- [ ] A2UI images: an agent reply with an A2UI `Image` that points at a project file (`asset:` / `http://asset.localhost`) shows the image; one at any other https address shows nothing.
- [ ] Windows: build and install the Windows bundle, run onboarding (winget installs), start a chat and render one video.
- [ ] Autopilot with the window hidden (packaged macOS build, by hand): turn on background mode and close the window. Make an autopilot whose next slot is 2 minutes ahead; confirm the slot starts and finishes on time while the window stays hidden. On a second slot, use Stop now from the Autopilot screen once. Use the tray's Pause all once and check every autopilot shows Paused. With the window hidden, confirm a review reminder and a post reminder arrive. If slots start late, a hidden webview is being throttled (App Nap): see the review's note on `NSAppSleepDisabled`.

## Downgrades

Chats saved by this version can store `thought` parts (the agent's reasoning) and images the agent made (`file` parts with `modifiedAt`). An older build can't read a `thought` part, so going back to it breaks those chats' message lists. Don't ship a downgrade path.

## Notifications and background mode

- Reminders use `tauri-plugin-notification`. On desktop the plugin always reports the permission as granted, so Tayang cannot tell when a user has turned its notifications off in the operating system (macOS, Windows). The Calendar banner only shows where the plugin does report a denial. Settings › General has a "Send a test notification" button so people can check that notifications reach them.
- Background mode shows a tray icon only while it is on. On Linux the tray needs AppIndicator: the deb depends on `libayatana-appindicator3-1` and the rpm on `libayatana-appindicator-gtk3`; an AppImage uses the system's library, so it must be installed there. Without it the tray library crashes while loading; Tayang catches that (`std::panic::catch_unwind`), turns background mode and Open at login back off, shows "Background mode needs a system tray, which isn't available here" in Settings, and never hides the window. The same failure at startup turns the setting off and the app opens normally.
- Launching Tayang a second time shows the running window (`tauri-plugin-single-instance`). "Open at login" starts the app with `--hidden`, which keeps the window hidden when a tray icon exists.
- Dev builds register the login item for the dev binary, and notifications in dev may carry the terminal's identity until the app is bundled.
