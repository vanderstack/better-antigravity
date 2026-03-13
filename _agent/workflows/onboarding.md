# Agent Entry Point: Managed Onboarding Flow

Welcome, Agent. To ensure you operate safely within the Gravity Claw / Antigravity ecosystem, you must follow this mandatory onboarding sequence before performing any tasks.

## 1. Skill Discovery
Your first action is to reference the **Skill Registry**. This will tell you what capabilities are currently active and provide the necessary mental models for operation.
- **Action**: Read [skills/0-skill-registry.md](../skills/0-skill-registry.md)

## 2. Technical Grounding
Once you understand the available skills, follow the **SDK Onboarding** skill. This will guide you in building a protocol-level context of the extension's internal states.
- **Action**: Follow the 3-step validation rule in [skills/sdk-onboarding.md](../skills/sdk-onboarding.md)

## 3. Communication Check
After you have successfully calibrated your mental model and verified connectivity to the SDK, you must signal your readiness to the user.
- **Action**: Use the **Telegram Bridge** skill to send a message confirming onboarding is complete.
- **Script**: `python3 /config/gravity-claw/telegram_bridge/bin/send_telegram.py --text "Agent <Name>: Onboarding complete. System connectivity verified via SDK path."`
- **Reference**: [skills/telegram-bridge.md](../skills/telegram-bridge.md)

## 4. Policy Compliance
Finally, you must read the project rules to understand the reporting requirements.
- **Action**: Read the [Communication Rules](../rules/communication.md).

---

## Operating Principles
- **Think-First**: Always verify your own traces in `.antigravity-diagnostics/` before proposing changes.
- **Hot-Swap Aware**: Remember that the Engine is hot-reloadable. Verify if a swap has occurred and its version before acting.
- **Path Selection**: Choose between the **Webview Path** and **SDK Path** based on the specific requirements of your task as defined in the registry.
