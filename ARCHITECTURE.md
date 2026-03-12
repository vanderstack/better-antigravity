# Architecture: Better Antigravity

This document details the internal design of the progressive hot-reload system and its supporting reliability layers.

## 1. Progressive Hot-Reload (The Host/Engine Split)

Standard VS Code extensions require a full extension host restart (window reload) to apply code changes. `better-antigravity` bypasses this using a **Bootstrap Loader** architecture.

### The Host (`src/host.ts`)
The Host is the slim permanent resident of the IDE. Its only jobs are:
- Watching `dist/reloads/` for new builds.
- Orchestrating the **Teardown** of the old Engine.
- **Cache Busting**: Clearing `require.cache` for all extension paths.
- **Activation**: Dynamically `require()`ing the new Engine and calling its `start()` method.

### The Engine (`src/engine.ts`)
The Engine contains all functional logic (SDK interactions, Commands, Telegram Bot). It implements a strict `start()`/`stop()` lifecycle to ensure it can be cleanly swapped out without leaving orphaned listeners or command collisions.

## 2. The Reliability Layer (Convergence Model)

Filesystem events are not 100% reliable. The extension uses a "Belt and Suspenders" model to ensure code updates and messaging never fail.

- **Layer 1: Chokidar (Event-Driven)**: High-performance, debounced monitoring of `dist/reloads/` and `outbox/`.
- **Layer 2: Convergence Polling**: A 1-second (Bridge) or 5-second (Host) background loop that verifies the current state against the filesystem. 
- **Layer 3: Atomic Staging**: Builds are compiled to a `.staging` folder and only moved to the watcher path once serialized and finalized.

## 3. High-Reliability Telegram Bridge

The bridge uses a **Linear State Machine** based on atomic renames:
`outbox` (New) -> `pending` (Locked) -> `archive` (Success) OR `error` (Fail).

- **No Data Loss**: Messages stay in `pending` if the Engine crashes mid-send.
- **Attachment Resolution**: Resolves paths relative to the `attachments/` folder and handles base64 decoding on-the-fly.
- **Heartbeat**: 1-second polling ensures that even if `inotify` queue overflows, messages are processed with sub-second latency.

## 4. SDK Diagnostic Tracing

Interaction with the **Antigravity Language Server** is traced via the `TracingManager`.

- **Interception**: Captures `GetConversation` and `GetTrajectory` responses.
- **Persistence**: Dumps high-volume JSON payloads to `.antigravity-diagnostics/`.
- **Analysis**: Enables developers to see the exact turn content and hidden "cortex step" metadata that determines agent behavior.

## 5. Fault Tolerance & Safety

- **Teardown Timeout**: If an Engine's `stop()` method hangs for more than 2000ms, the Host forces a full window reload to prevent an unstable IDE state.
- **Memory Leak Protection**: After 20 hot-reloads, the Host triggers a window reload to reclaim memory from the Extension Host process.
- **Reload Mutex**: Ensures that overlapping filesystem events or polling hits do not trigger simultaneous activation attempts.
