# Better Antigravity Extension

A high-performance, developer-centric extension for the Antigravity IDE, designed for rapid debugging, reliable messaging, and deep SDK visibility.

## Key Features

- **🚀 Progressive Hot-Reloading**: Change extension logic (the "Engine") and see updates in real-time without restarting the IDE.
- **🛡️ Hardened Reliability**: Multi-layered watchers (Chokidar + Polling) ensure no reload or message events are missed, even under heavy filesystem load.
- **📡 Reliable Telegram Bridge**: A high-integrity queue system (`outbox` -> `pending` -> `archive`) for bidirectional communication between the agent and Telegram.
- **🔍 SDK Diagnostic Tracing**: Automatically capture and dump raw SDK payloads to disk for deep protocol analysis.
- **🤖 Agent SKILL Integration**: Pre-built instructions and CLI helpers for other agents to use the system.

---

## Installation (Developer Mode)

To install the extension, symlink this repository into your Antigravity extensions folder:

```bash
# Define paths
REPO_PATH="/config/gravity-claw/vendor/better-antigravity"
EXT_PATH="/config/.antigravity/extensions/better-antigravity"

# Create symlink
ln -s "$REPO_PATH" "$EXT_PATH"
```

After symlinking, perform a **Full Window Reload** (`Developer: Reload Window`) in VS Code to activate the Host loader.

---

## Usage & Build Pipeline

The extension is split into two layers:
1. **The Host**: Stays resident in the IDE. It watches for new builds and safely swaps the logic.
2. **The Engine**: Contains the actual extension features. This is what you hot-swap.

### Building
To apply changes and trigger a hot-swap:
```bash
npm run build
```
The Host will detect the new build in `dist/reloads/` and perform a safe swap automatically.

---

## Commands

| Command | Description |
|---------|-------------|
| **`Better Antigravity: Status`** | Show health metrics for the Engine and the Telegram Bridge. |
| **`Better Antigravity: Probe SDK`** | Execute diagnostic probes against the Antigravity Language Server. |
| **`Better Antigravity: Open Diagnostics`** | Reveal the SDK trace folder in the sidebar. |
| **`Better Antigravity: Force Reload`** | Manually trigger a hot-swap of the latest build. |

---

## SDK Tracing
Raw payloads are dumped to `.antigravity-diagnostics/` in the workspace root.
- `trace.log`: Daily rotating log of all bridge/SDK events.
- `GetConversation_*.json`: Raw RPC responses captured during agent turns.

---

## Telegram Bridge
Send messages by writing JSON to the queue or using the CLI helper:
```bash
python3 scripts/send_telegram.py --text "Hello world"
```
For full agent instructions, see [SKILL.md](./_agent/skills/telegram_bridge/SKILL.md).
