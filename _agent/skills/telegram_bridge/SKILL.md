---
name: telegram_bridge
description: How to send Telegram messages and attachments via the High-Reliability Queue Bridge
---

# Telegram Bridge Skill

This skill provides instructions for sending Telegram messages and attachments through the `better-antigravity` extension's high-reliability queue bridge.

## Overview
The bridge works by monitoring an `outbox` folder for JSON files. It processes them atomically, handles attachments, and archives the results.

### Core Directories
All paths are relative to `/config/gravity-claw/telegram_bridge/`:
- `outbox/`: Drop your message JSON files here to trigger a send.
- `attachments/`: Put binary files/media here if you want to attach them to a message.
- `archive/`: Successfully sent messages are moved here (cleaned every 24h).
- `error/`: Messages that failed to send are moved here for debugging.

---

## Message Format
Messages are defined as `.json` files.

### 1. Simple Text Message
Filename: `msg_123.json`
```json
{
    "text": "🚀 *System Update*\nThe build process is complete.",
    "parse_mode": "Markdown"
}
```

### 2. Message with Attachment
If you want to send a log file or an image:
1. Copy the file to `attachments/`.
2. Reference it in the JSON.

```json
{
    "text": "See attached build log",
    "attachment_path": "build_error.log"
}
```

### 3. Base64 Attachment
If you have a binary in memory, you can write it as base64 to a file in `attachments/` and specify the encoding.

```json
{
    "text": "Screen Capture",
    "attachment_path": "shot.b64",
    "attachment_encoding": "base64"
}
```

---

## Instructions for Agents

1. **Check Bridge Health**: Run the VS Code command `Better Antigravity: Status` to ensure the bridge is active and view queue metrics.
2. **Atomic Write**: Always use a unique filename (e.g., `msg_<timestamp>.json`) to prevent collisions.
3. **Wait for Archive**: If you need to confirm delivery, monitor the `archive/` folder for your filename. If it appears in `error/`, delivery failed.
4. **Cleanup**: You do not need to clean up `archive/`; the Engine automatically purges files older than 24 hours.

## Example Python Snippet (Quick Send)
```python
import json, time, os

def send_telegram(text, attachment=None):
    bridge_dir = "/config/gravity-claw/telegram_bridge"
    filename = f"msg_{int(time.time())}.json"
    
    payload = {"text": text, "parse_mode": "Markdown"}
    if attachment:
        payload["attachment_path"] = os.path.basename(attachment)
    
    with open(f"{bridge_dir}/outbox/{filename}", 'w') as f:
        json.dump(payload, f)

send_telegram("Hello from the Agent Bridge!")
```
