---
name: skill_planning
description: Meta-skill for designing high-fidelity guidance and mental models for the Antigravity ecosystem
---

# Skill Planning Meta-Skill

This is a **Meta-Skill** designed to guide you in creating effective, agent-centric documentation (Skills) for the Antigravity project. Use this to ensure all new guidance builds a robust mental model rather than just listing commands.

## Phase 1: Grounding (The Concrete Reality)

Before writing a skill, you must locate the "Truth Sources." Do not guess; verify.

1.  **Registry Check**: Read `src/view-model-registry.ts` to see current active ViewModels.
2.  **Harness Check**: Read `vendor/better-antigravity/src/host.ts` to understand the current hot-reload state.
3.  **Path Choice**: Is the task UI-based (requires `antigravity-bridge`) or Protocol-based (requires `better-antigravity`)?

## Phase 2: Contextualization (Reasoning)

Guide the agent to build its OWN context. Do not just provide facts; provide a research strategy.

- **Hot-Swap Boundary**: Clearly define where the "Swap" happens (the `dist/reloads/` folder).
- **Event Flow**: Map the path from a Browser Mutation (`window.emitGravityEvent`) to a Node.js Reducer.
- **Protocol Depth**: If using the SDK, point the agent toward the raw telemetry in `.antigravity-diagnostics/`.

## Phase 3: Design Evaluation (The "Think-First" Strategy)

Every skill should force a "Reasoning step" before any action.

> [!TIP]
> **The 3-Step Validation Rule**:
> 1.  **Verify Presence**: "Can I see the Engine running in the Command Palette?"
> 2.  **Verify Trace**: "Can I see my action reflected in the diagnostics/logs?"
> 3.  **Verify Feedback**: "Did the Telegram bridge/Webview respond as expected?"

## Phase 4: Standard Skill Structure

Maintain a consistent UX for agents. Use the following sections in order:

1.  **Mental Model**: 2-3 sentences on the "Why" and the "How it works."
2.  **Quick Start**: The single most effective command or script (e.g., `send_telegram.py`).
3.  **Technical Deep-Dive**: File paths and directory structures.
4.  **Best Practices**: "Think-First" instructions and safety checks.
5.  **Troubleshooting**: Common failure modes (Race conditions, missing extensions).

## Verification of Your Skill

Before finalizing a new `SKILL.md`:
- [ ] Does it specify the **Integration Path** (Webview vs. SDK)?
- [ ] Does it name the **Extension Dependency**?
- [ ] Does it provide **Concrete Truth Sources** for the agent to read?
