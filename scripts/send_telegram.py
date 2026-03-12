#!/usr/bin/env python3
import os
import sys
import json
import time
import argparse
import shutil

BRIDGE_DIR = "/config/gravity-claw/telegram_bridge"

def main():
    parser = argparse.ArgumentParser(description="Send a Telegram message via the Antigravity Bridge.")
    parser.add_argument("--text", help="The message text", required=True)
    parser.add_argument("--attach", help="Path to a file to attach")
    parser.add_argument("--mode", help="Parse mode (Markdown or HTML)", default="Markdown")
    parser.add_argument("--base64", action="store_true", help="Treat attachment as base64 content (not yet implemented fully in this helper)")

    args = parser.parse_args()

    # Ensure directories exist
    outbox = os.path.join(BRIDGE_DIR, "outbox")
    attachments = os.path.join(BRIDGE_DIR, "attachments")
    for d in [outbox, attachments]:
        if not os.path.exists(d):
            os.makedirs(d, exist_ok=True)

    payload = {
        "text": args.text,
        "parse_mode": args.mode
    }

    if args.attach:
        if not os.path.exists(args.attach):
            print(f"Error: Attachment not found at {args.attach}")
            sys.exit(1)
        
        # Copy to bridge attachments folder
        filename = os.path.basename(args.attach)
        dest = os.path.join(attachments, filename)
        shutil.copy2(args.attach, dest)
        payload["attachment_path"] = filename

    # Write unique JSON file to outbox
    timestamp = int(time.time() * 1000)
    msg_file = os.path.join(outbox, f"msg_{timestamp}.json")
    
    with open(msg_file, 'w') as f:
        json.dump(payload, f, indent=2)

    print(f"Message queued successfully: {msg_file}")
    print(f"Check /config/gravity-claw/telegram_bridge/archive/ for delivery confirmation.")

if __name__ == "__main__":
    main()
