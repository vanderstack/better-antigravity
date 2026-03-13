# Better Antigravity Extension 🚀

**Better Antigravity** is the "Bedrock" of the Gravity Claw ecosystem. It is a developer-centric extension for the Antigravity IDE, designed for rapid prototyping, deep protocol visibility, and high-reliability agentic communication.

---

## 🛠 Features

### 1. Progressive Hot-Reload Engine
The extension is built with a dual-layer architecture:
- **The Host (Resident)**: A thin loader that stays active in the IDE.
- **The Engine (Hot-Swap)**: The core logic that can be re-bundled and swapped in milliseconds without restarting the IDE.
- **Reliability**: Uses a Chokidar-backed watcher with a 5s convergence poll to ensure zero-loss activation of new versions.

### 2. Consolidated Telegram Bridge
A high-integrity messaging gateway that bridges the isolation between the IDE and Telegram:
- **Event-Sourced**: Every action is a durable event stored in standard VS Code storage.
- **Command API**: Exposes `better-antigravity.telegram.sendEvent` for direct interaction.
- **Turn Settling**: Intelligent idle detection to capture final assistant responses.

### 3. SDK Protocol Probing & Tracing
Integrated deep-hooks into the Antigravity Language Server:
- **Trace Dumps**: Raw RPC payloads are captured to `.antigravity-diagnostics/`.
- **Live Probes**: Use `Better Antigravity: Probe SDK` to test LS capabilities in real-time.
- **Seamless Install**: Automated injection of title proxies and maintenance scripts.

### 4. Agentic Self-Discovery 🤖
Built specifically for AI agents operating in the IDE:
- **Skill Injection**: Automatically injects `.agents/skills/better-antigravity.md` into any workspace on startup.
- **Doc Command**: Agents can call `better-antigravity.getAgentDocumentation` to self-onboard.

---

## 📦 Installation & Setup

### 1. Standalone SDK Usage
The `antigravity-sdk` (found in `../antigravity-sdk`) is a standard Node.js library. It **works independently** of this extension and can be imported into any script, CLI tool, or background service to interact with the Antigravity Language Server.

### 2. Extension Installation (Recommended)
To benefit from hot-reloading and IDE-level features (like the Telegram Bridge), you should use the automated installer to symlink the extension into your Antigravity profile:

```bash
# In the vendor/better-antigravity directory:
npx . install
```

This command will:
- Auto-detect your Antigravity profile (Windows, macOS, or Linux).
- Create the necessary `extensions/` directory if missing.
- Symlink the current repository into the IDE.
- Verify the presence of the peer `antigravity-sdk`.

After running the installer, perform a **Full Window Reload** (`Developer: Reload Window`) in Antigravity to activate the Host.

---

## 🧪 The Rapid Prototyping Loop

This extension is optimized for "Full Stream" development where you can modify code and see results without state-loss or IDE restarts.

1.  **Activate**: Reload the IDE window once after creating the symlink.
2.  **Observe**: Open the **Output Channel** and select `Better Antigravity (Host)`.
3.  **Iterate**: 
    - Modify `src/engine.ts` (Core logic) or `src/commands.ts` (UI actions).
    - Run `npm run build` (or `npm run watch`).
4.  **Confirm**: The Host output will show `[host] Engine swapped to version <TS>`.
5.  **Test**: Trigger your change via the Command Palette or the `better-antigravity.probeSDK` command.

---

## 📂 Project Structure

- `src/host.ts`: Stable bootstrap loader.
- `src/engine.ts`: Hot-swappable core logic.
- `src/telegram/`: Consolidated event-sourced bridge.
- `src/auto-run.ts`: Patches for IDE-level terminal behavior.
- `_agent/`: Bundled skills for AI agent consumption.

---

## 📜 Legal
See [LICENSE](./LICENSE) and [LEGAL.md](./LEGAL.md) for details on the AGPL-3.0 license and Antigravity SDK usage.
