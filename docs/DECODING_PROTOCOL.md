# Antigravity Decoding Protocol

This document details the technical nuances involved in extracting assistant responses from the Antigravity Language Server across different versions.

## 1. Multi-Schema Message Handling

Antigravity versions vary in how they structure "steps" within a conversation trajectory. The extension handles this by sweeping across known fields and types.

### Primary Message Types
- `CORTEX_STEP_TYPE_NOTIFY_USER`: The standard "user-facing" notification from the assistant.
- `CORTEX_STEP_SOURCE_MODEL`: Direct model output in newer versions.
- `CHAT_MESSAGE_SOURCE_MODEL`: Direct model output in legacy/intermediate versions.

### Field Mapping Heuristics
When a step is identified as a model response, the extractor checks the following fields in order of priority:
1. `step.notifyUser.message`
2. `step.prompt`
3. `step.data.content`
4. `step.content`

## 2. Formatting & Escape Logic

The bridge communicates with Telegram, which supports MarkdownV2 and HTML. Antigravity responses occasionally contain mixed content or raw HTML.

### Markdown vs HTML Detection
The extension uses a heuristic to determine the `parseMode` for the Telegram API:
- **Heuristic**: If the content contains common HTML closing tags (e.g., `</p>`, `</div>`) or has characters that look like layout tags (`<` and `>`), it is marked as `HTML`.
- **Safety Escaping**: If "unsafe" HTML tags (like `<script>`, `<iframe>`, or `h1-h6`) are detected, the entire message is HTML-escaped (`&lt;`, `&gt;`) to prevent Telegram API errors while preserving readability.

## 3. Turn Settling Logic

Because Antigravity generates responses across multiple "steps" (thinking, tool use, then final response), the bridge uses a **Metadata Projector** to track "settling".

- **Step Count Monitoring**: The bridge tracks the `stepCount` of a cascade.
- **Idle Detection**: A turn is considered "Resolved" when the `stepCount` has not increased for a set duration (default 5s) and no new activity is detected.
- **Final Fetch**: Only once a turn has settled does the bridge perform a backwards-sweep of the trajectory to find the "Final Response" to send to Telegram.
