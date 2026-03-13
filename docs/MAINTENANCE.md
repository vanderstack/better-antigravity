# Maintenance & Environmental Nuances

This document outlines the environmental dependencies, side effects, and maintenance requirements of the Better Antigravity extension.

## 1. Workspace Side Effects

The extension is designed to be "proactive," which results in the creation of several files and folders within any workspace it is active in:

### `.antigravity-diagnostics/`
- **Purpose**: Stores raw SDK protocol traces and JSON payload dumps.
- **Location**: Created in the workspace root.
- **Maintenance**: Safe to delete, but will be recreated on next activation.

### `.agents/skills/better-antigravity.md`
- **Purpose**: "Discovery Injection" to inform other AI agents about the bridge's capabilities.
- **Location**: Injected into every workspace on startup.
- **Maintenance**: Can be deleted, but the extension will re-inject it if missing to ensure agentic continuity.

## 2. Build-Time Dependencies

The extension's build pipeline (`build.mjs`) is optimized for a specific development environment:

- **SDK Coupling**: The builder uses an ESBuild `alias` to resolve `antigravity-sdk` from `../antigravity-sdk`. This assumes the extension and SDK repositories are peers.
- **Dependency Resolution**: SQL.js WASM binaries are pulled from either the local `node_modules` or the peer SDK's `node_modules`.
- **Node.js Environment**: Requires Node.js 18+ for `fs.cpSync` and other modern filesystem APIs.

## 3. IDE-Wide Patching

Commands like `Auto-Run Fix` apply patches directly to the Antigravity IDE bundles (`workbench.desktop.main.js`).

- **Global Effect**: Because these patches modify the IDE binary, they affect **all** workspaces and projects opened in that IDE instance, not just the one where the extension was developed.
- **Updates**: Antigravity updates will likely overwrite these patches. Use the `Better Antigravity: Status` command to check patch health.

## 4. State Persistence

- **Telegram Session State**: Stored in VS Code's `globalStorageUri`. This persists across different workspaces.
- **Legacy Bridge (`inbox.json`)**: Still attempts to read/write to the workspace root if no other configuration is found.
