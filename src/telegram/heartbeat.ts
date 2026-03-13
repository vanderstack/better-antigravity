import { BridgeEventBus } from './events';

export class HeartbeatGenerator {
    private interval: NodeJS.Timeout | null = null;
    private bus: BridgeEventBus;

    constructor() {
        this.bus = BridgeEventBus.getInstance();
    }

    public start(intervalMs: number = 5000) {
        if (this.interval) return;
        
        this.interval = setInterval(() => {
            this.bus.emitEvent({
                type: 'HEARTBEAT',
                timestamp: Date.now(),
                data: { pulse: true }
            });
        }, intervalMs);
    }

    public stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }
}
