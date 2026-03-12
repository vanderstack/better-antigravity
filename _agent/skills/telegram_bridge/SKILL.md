---
name: telegram_bridge
description: How to send Telegram messages and attachments via the High-Reliability Queue Bridge
---

# Telegram Bridge Skill

This skill provides instructions for sending Telegram messages and attachments through the `better-antigravity` extension's high-reliability queue bridge.

## Quick Start (Recommended)

The easiest way to send a message is to use the provided Python helper script. This handles the JSON formatting, unique filenames, and attachment copying for you.

### 1. Send Simple Text
```bash
python3 /config/gravity-claw/telegram_bridge/bin/send_telegram.py --text "Hello from the agent!"
```

### 2. Send with Attachment
```bash
python3 /config/gravity-claw/telegram_bridge/bin/send_telegram.py --text "Here is the log" --attach "/tmp/build.log"
```

---

## Technical Details (Manual Mode)

If you cannot run the script, you can manually write to the `outbox`.

### Core Directories
All paths are relative to `/config/gravity-claw/telegram_bridge/`:
- `outbox/`: Drop your message JSON files here.
- `attachments/`: Put binary files/media here.

### Manual Message Format (`outbox/msg_<unique>.json`)
```json
{
    "text": "Your message",
    "parse_mode": "Markdown",
    "attachment_path": "optional_filename_in_attachments_folder"
}
```

---

## Best Practices for Agents

1. **Check Status First**: Run `Better Antigravity: Status` command to confirm the Engine is active.
2. **Path Verification**: Always use absolute paths when referencing files in `--attach`.
3. **Atomic verification**: After sending, check `archive/` for your message to confirm delivery.
4. **Error Handling**: If a message appears in `error/`, read the corresponding JSON inside the error folder to see the failure log.

## Troubleshooting
- **Message not sending?** Ensure the `better-antigravity` extension is active.
- **Attachment missing?** The bridge looks for attachments in the `attachments/` sub-folder specifically. The helper script handles this copy automatically.
- **JSON Error?** If writing manually, ensure no trailing commas and valid UTF-8 encoding.

