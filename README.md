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

## 📦 Installation

### Developer Setup (Hot-Reload Mode)
1. **Clone & Link**:
   ```bash
   REPO_PATH="/path/to/better-antigravity"
   EXT_PATH="/config/.antigravity/extensions/better-antigravity"
   ln -s "$REPO_PATH" "$EXT_PATH"
   ```
2. **First Run**: Reload the window (`Cmd+R` or `Developer: Reload Window`).
3. **Build Pipeline**:
   ```bash
   npm run build  # Triggers Host to swap to the new Engine version
   ```

---

## 📡 Telegram Bridge Integration

### For AI Agents (Recommended)
Use the extension's native API for the most reliable delivery:
```typescript
vscode.commands.executeCommand('better-antigravity.telegram.sendEvent', {
    type: 'OUTBOUND_MESSAGE',
    timestamp: Date.now(),
    data: { text: "Hello from the agent!" }
});
```

### Configuration
Configure the following in VS Code Settings (`Ctrl+,`):
- `better-antigravity.telegram.botToken`: Your token from @BotFather.
- `better-antigravity.telegram.allowedUserIds`: Whitelist of Telegram IDs.
- `better-antigravity.telegram.enabled`: Toggle the bridge on/off.

---

## 🧪 Prototyping & SDK Probing

The extension is designed for rapid iteration on the Antigravity protocol:
1. **Modify** `src/engine.ts` or add handlers in `src/commands.ts`.
2. **Run** `npm run build`.
3. **Observe** the update in the `Better Antigravity (Host)` output channel.
4. **Test** using `Better Antigravity: Probe SDK`.

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
