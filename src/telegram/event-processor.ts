import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { BridgeEvent } from './events';
import { MetadataProjector } from './projector';
import { ReportingSaga } from './saga';

export class EventProcessor {
    private isProcessing = false;
    private timer: NodeJS.Timeout | null = null;
    private processingStart: number | null = null;
    private readonly inboxDir: string;
    private readonly pendingDir: string;
    private readonly archiveDir: string;
    private readonly errorDir: string;

    constructor(
        private readonly baseDir: string,
        private readonly projector: MetadataProjector,
        private readonly saga: ReportingSaga,
        private readonly log: (msg: string) => void
    ) {
        this.inboxDir = path.join(this.baseDir, 'events', 'inbox');
        this.pendingDir = path.join(this.baseDir, 'events', 'pending');
        this.archiveDir = path.join(this.baseDir, 'events', 'archive');
        this.errorDir = path.join(this.baseDir, 'events', 'error');
        this.ensureDirs();
    }

    private ensureDirs() {
        [this.inboxDir, this.pendingDir, this.archiveDir, this.errorDir].forEach(d => {
            if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
        });
    }

    public start(intervalMs: number = 5000) {
        if (this.timer) return;
        this.log('Event Processor started.');

        const runCycle = async () => {
            // Produce a HEARTBEAT event to keep temporal logic alive
            try {
                const bus = require('./events').BridgeEventBus.getInstance();
                bus.emitEvent({
                    type: 'HEARTBEAT',
                    timestamp: Date.now(),
                    data: { pulse: true, batchId: Date.now() }
                });
            } catch {}
            
            await this.flush();
        };

        // Initial run
        runCycle();

        this.timer = setInterval(runCycle, intervalMs);
    }

    public stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.log('Event Processor stopped.');
    }

    public async flush() {
        // Circuit Breaker Check
        if (this.isProcessing && this.processingStart) {
            const duration = Date.now() - this.processingStart;
            if (duration > 15000) { // 15s threshold
                this.log(`⚠️ Circuit Breaker: Processing batch timed out after ${duration}ms. Forcing reset.`);
                this.handleTimeout();
                return;
            }
            this.log(`[Processor] Still processing current batch... (${duration}ms)`);
            return;
        }

        try {
            const files = fs.readdirSync(this.inboxDir).filter(f => f.endsWith('.json'));
            if (files.length === 0) return;

            this.isProcessing = true;
            this.processingStart = Date.now();
            this.log(`[Processor] Consuming ${files.length} events...`);

            // Move files to pending atomically
            const batch: string[] = [];
            for (const file of files) {
                const src = path.join(this.inboxDir, file);
                const dest = path.join(this.pendingDir, file);
                try {
                    fs.renameSync(src, dest);
                    batch.push(dest);
                } catch (err: any) {
                    this.log(`Error moving event to pending: ${err.message}`);
                }
            }

            // Sequential Processing
            batch.sort(); // Process in order of filename (timestamp)
            for (const filePath of batch) {
                await this.processEventFile(filePath);
            }

            this.log(`[Processor] Batch complete. Time: ${Date.now() - this.processingStart}ms`);
        } catch (err: any) {
            this.log(`Error in processor flush: ${err.message}`);
        } finally {
            this.isProcessing = false;
            this.processingStart = null;
        }
    }

    private async processEventFile(filePath: string) {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const event: BridgeEvent = JSON.parse(content);
            
            // 1. Move through reducer (Functional Projection)
            this.projector.processEvent(event);
            
            // 2. Dispatch internally to trigger Sagas
            const bus = require('./events').BridgeEventBus.getInstance();
            bus.dispatchInternal(event);

            // 3. Move to archive
            const dest = path.join(this.archiveDir, path.basename(filePath));
            fs.renameSync(filePath, dest);
        } catch (err: any) {
            this.log(`Error processing event ${filePath}: ${err.message}`);
            try {
                const dest = path.join(this.errorDir, path.basename(filePath));
                fs.renameSync(filePath, dest);
            } catch {}
        }
    }

    private handleTimeout() {
        // Move everything in pending to error
        try {
            const files = fs.readdirSync(this.pendingDir);
            for (const file of files) {
                fs.renameSync(path.join(this.pendingDir, file), path.join(this.errorDir, file));
            }
        } catch {}
        this.isProcessing = false;
        this.processingStart = null;
    }
}
