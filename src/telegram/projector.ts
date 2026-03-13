import { BridgeEvent, BridgeEventType } from './events';
import * as path from 'path';

export interface SessionMetadata {
    sessionId: string;
    chatId: number;
    currentTask: string;
    stepCount: number;
    status: 'IDLE' | 'THINKING' | 'PROCESSING' | 'REPLYING' | 'GATHERING' | 'SETTLED';
    lastEventTimestamp: number;
    lastActivityTimestamp: number;
    startTime: number;
    endTime?: number;
    messagesDetected: number;
    finalResponseSent: boolean;
}

export class MetadataProjector {
    private sessions: Map<string, SessionMetadata> = new Map();
    private statePath: string | null = null;

    public setStatePath(p: string) {
        this.statePath = path.join(p, 'projector_state.json');
        this.load();
    }

    private save() {
        if (!this.statePath) return;
        try {
            const fs = require('fs');
            fs.writeFileSync(this.statePath, JSON.stringify(Array.from(this.sessions.entries()), null, 2));
        } catch {}
    }

    private load() {
        if (!this.statePath) return;
        try {
            const fs = require('fs');
            if (fs.existsSync(this.statePath)) {
                const data = JSON.parse(fs.readFileSync(this.statePath, 'utf-8'));
                this.sessions = new Map(data);
            }
        } catch {}
    }

    public processEvent(event: BridgeEvent): SessionMetadata | null {
        const sessionId = event.sessionId;
        const chatId = event.chatId;
        if (!sessionId || !chatId) return null;

        let session = this.sessions.get(sessionId);
        if (!session) {
            session = {
                sessionId,
                chatId,
                currentTask: 'Initializing...',
                stepCount: 0,
                status: 'IDLE',
                lastEventTimestamp: event.timestamp,
                lastActivityTimestamp: event.timestamp,
                startTime: event.timestamp,
                messagesDetected: 0,
                finalResponseSent: false
            };
            this.sessions.set(sessionId, session);
        }

        const s = session!; // Guaranteed by above logic
        s.lastEventTimestamp = event.timestamp;

        // Determine if this is an "activity" event that resets the idle timer
        const isActivity = ['STEP_CHANGE', 'PROGRESS', 'MESSAGE_DETECTED', 'USER_MESSAGE'].includes(event.type);
        if (isActivity) {
            s.lastActivityTimestamp = event.timestamp;
            s.endTime = undefined; // Resume active timer if new activity arrives
        }

        switch (event.type) {
            case 'STEP_CHANGE':
                s.currentTask = event.data.title || s.currentTask;
                s.stepCount = event.data.newCount;
                s.status = 'THINKING';
                break;
            case 'PROGRESS':
                s.status = 'PROCESSING';
                s.stepCount = event.data.newCount;
                break;
            case 'MESSAGE_DETECTED':
                s.status = 'REPLYING';
                s.messagesDetected++;
                break;
            case 'USER_MESSAGE':
                s.stepCount = 0;
                s.messagesDetected = 0;
                s.status = 'THINKING';
                s.startTime = event.timestamp;
                s.finalResponseSent = false;
                s.currentTask = 'Entering new turn...';
                break;
            case 'TURN_SETTLED':
                s.status = 'GATHERING'; 
                s.endTime = event.timestamp;
                break;
            case 'TURN_COMPLETED':
                s.status = 'SETTLED';
                s.endTime = event.timestamp;
                break;
        }

        this.save();
        return s;
    }

    public getSession(sessionId: string): SessionMetadata | undefined {
        return this.sessions.get(sessionId);
    }

    public getAllSessions(): SessionMetadata[] {
        return Array.from(this.sessions.values());
    }
}
