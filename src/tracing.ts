import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * TracingManager - Handles persistent diagnostic logging and SDK payload dumping.
 */
export class TracingManager {
    private diagnosticDir: string;
    private logFile: string;

    constructor(private readonly context: vscode.ExtensionContext) {
        // Find workspace root
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            this.diagnosticDir = path.join(workspaceFolders[0].uri.fsPath, '.antigravity-diagnostics');
        } else {
            // Fallback to extension global storage
            this.diagnosticDir = path.join(context.globalStorageUri.fsPath, 'diagnostics');
        }

        if (!fs.existsSync(this.diagnosticDir)) {
            fs.mkdirSync(this.diagnosticDir, { recursive: true });
        }

        const date = new Date().toISOString().split('T')[0];
        this.logFile = path.join(this.diagnosticDir, `trace_${date}.log`);
    }

    /**
     * Appends a message to the diagnostics log.
     */
    public log(message: string): void {
        const ts = new Date().toISOString().substring(11, 19);
        const line = `[${ts}] ${message}\n`;
        fs.appendFileSync(this.logFile, line);
    }

    /**
     * Dumps a raw data structure to a JSON file for analysis.
     * @param name Name of the file (e.g. 'GetConversation_123')
     * @param payload The object to serialize
     */
    public dumpPayload(name: string, payload: any): string {
        try {
            const filename = `${name.replace(/[^a-z0-9]/gi, '_')}.json`;
            const fullPath = path.join(this.diagnosticDir, filename);
            fs.writeFileSync(fullPath, JSON.stringify(payload, null, 2));
            this.log(`Dumped payload: ${filename}`);
            return fullPath;
        } catch (err: any) {
            this.log(`Failed to dump payload ${name}: ${err.message}`);
            return '';
        }
    }

    /**
     * Returns the diagnostic folder path.
     */
    public getDiagnosticDir(): string {
        return this.diagnosticDir;
    }
}
