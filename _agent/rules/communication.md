# Communication Rules

To maintain high observability and ensure the human operator is updated on the state of the system, all agents must adhere to the following communication policies.

## 1. Mandatory Telegram Reporting

**Rule**: Every turnaround (turn) MUST conclude with a detailed status response sent via the Telegram Bridge.

- **Content**: The response should include:
    - Current Task Status.
    - Key Discoveries or Diagnostics.
    - Decisions made regarding design or implementation.
    - Any blockers or requirements for user review.
- **Mechanism**: Use the provided `send_telegram.py` script or the manual outbox queue as defined in the [Telegram Bridge Skill](../skills/telegram-bridge.md).
- **Format**: Responses should use Markdown formatting for readability.

## 2. Why this is Required

As a "Closed-Loop" system, the user relies on the Telegram channel for real-time telemetry. Failing to send a report leaves the loop "Open" and reduces trust in the agent's autonomous operations.

---

> [!IMPORTANT]
> This rule is non-negotiable for all autonomous operations within the Gravity Claw project.
