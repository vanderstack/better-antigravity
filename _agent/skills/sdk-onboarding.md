---
name: sdk_onboarding
description: Master the Antigravity SDK & Protocol path for deep diagnostic integration
---

# Antigravity SDK Onboarding Skill

This skill guides you through the **SDK Path**—a protocol-level integration that bypasses the UI to interact directly with Antigravity's internal "Cortex" events.

## 1. The SDK Mental Model

Unlike the Webview path (which watches the DOM), the SDK path hooks into the **Language Server RPC**.

- **The Bedrock**: The `better-antigravity` extension manages the "Hot-Swap" logic.
- **The Trace**: Every agent action (thoughts, tool calls, responses) is captured as a structured JSON payload.
- **The Truth Source**: All SDK telemetry is written to `.antigravity-diagnostics/` in real-time.

## 2. Your Toolset

Use these commands/paths to orient yourself immediately:

### A. Connectivity Check
Run `Better Antigravity: Status` in the command palette.
- **Engine Swapped: Yes** = You are in the driver's seat.
- **Hot-Reload Active: Yes** = Any changes to the extension's `src/` will take effect instantly (250ms).

### B. Diagnostic Control
- **`Better Antigravity: Clear Diagnostics`**: Run this before a new experiment to reset the logs.
- **`.antigravity-diagnostics/`**: Open this folder. Each turn generates a unique JSON file.

## 3. The "Think-First" Integration Loop

To constructively build context for your task, follow this sequence:

1.  **Locate the Engine**: Find the `vendor/better-antigravity/` directory.
2.  **Verify Tracing**: Check `src/tracing.ts` to see how raw RPC calls (like `GetConversation`) are captured.
3.  **Analyze a Trace**: Trigger an agent action (e.g., ask for a file list) and read the resulting JSON in `.antigravity-diagnostics/`.
    - *Look for*: `trace_id`, `step_index`, and specifically the `payload` object.
4.  **Reason before Acting**: Do not just "scrape" the trace. Map the raw protocol fields back to your high-level objective.

## 4. When to Use the SDK vs. Webview

| Scenario | Recommended Path | Why? |
| :--- | :--- | :--- |
| Extracting hidden "Thoughts" | **SDK** | Thoughts are often not visible in the DOM but are present in the RPC pipe. |
| Monitoring tool output status | **SDK** | The SDK provides explicit `step_index` and `status` flags. |
| Reconstructing Chat UI | **Webview** | The Webview reflects the exact HTML layout and styling the user sees. |

## 5. Next Steps for You

To build a comprehensive context for design evaluation:
1.  Read `vendor/better-antigravity/ARCHITECTURE.md`.
2.  Enable the `DEBUG_PORT=8787` to see the live state matrix.
3.  Use the `.antigravity-diagnostics/` payloads to verify your assumptions about how Antigravity handles your requests.
