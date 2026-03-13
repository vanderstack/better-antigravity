import { EventEmitter } from 'events';

export type BridgeEventType = 
    | 'STEP_CHANGE'      // e.g. "Thinking..." -> "Implementing..."
    | 'PROGRESS'         // e.g. "Processing steps 10 to 15"
    | 'MESSAGE_DETECTED' // e.g. "Detected Model message"
    | 'USER_MESSAGE'     // e.g. "User sent a prompt"
    | 'TURN_SETTLED'     // Agent hasn't moved for X seconds (entering gathering phase)
    | 'TURN_COMPLETED'   // Final results have been sent
    | 'OUTBOUND_MESSAGE'  // Request to send a message to Telegram
    | 'ERROR'            // e.g. "Validation Failed"
    | 'HEARTBEAT'        // 5s temporal pulse
    | 'SYSTEM';          // Start/Stop events

export interface BridgeEvent {
    type: BridgeEventType;
    sessionId?: string;
    chatId?: number;
    timestamp: number;
    data: any;
}

export class BridgeEventBus extends EventEmitter {
    private static instance: BridgeEventBus;

    private constructor() {
        super();
        this.setMaxListeners(20);
    }

    public static getInstance(): BridgeEventBus {
        if (!BridgeEventBus.instance) {
            BridgeEventBus.instance = new BridgeEventBus();
        }
        return BridgeEventBus.instance;
    }

    public emitEvent(event: BridgeEvent) {
        // Fire and forget to the file system queue
        this.publishToFile(event);
        
        // Also persist to the debug log as before
        this.persistToLog(event);
    }

    /**
     * Internal dispatch for the EventProcessor to trigger in-memory Sagas etc.
     */
    public dispatchInternal(event: BridgeEvent) {
        this.emit('event', event);
        this.emit(event.type, event);
    }

    private publishToFile(event: BridgeEvent) {
        try {
            const fs = require('fs');
            const path = require('path');
            const inboxDir = '/config/gravity-claw/telegram_bridge/events/inbox';
            if (!fs.existsSync(inboxDir)) {
                fs.mkdirSync(inboxDir, { recursive: true });
            }
            
            const filename = `${event.timestamp}_${event.type}_${Math.random().toString(36).substring(2, 7)}.json`;
            fs.writeFileSync(path.join(inboxDir, filename), JSON.stringify(event, null, 2));
        } catch (err: any) {
            console.error(`Failed to publish event to file: ${err.message}`);
        }
    }

    private persistToLog(event: BridgeEvent) {
        try {
            const fs = require('fs');
            const logLine = JSON.stringify(event) + '\n';
            fs.appendFileSync('/config/gravity-claw/telegram_bridge/events.jsonl', logLine);
        } catch {}
    }

    public onEvent(callback: (event: BridgeEvent) => void) {
        this.on('event', callback);
    }
}
