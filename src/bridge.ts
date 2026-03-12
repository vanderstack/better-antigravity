/**
 * Legacy Bridge functionality ported to Antigravity SDK.
 * 
 * Watches for an explicit `inbox.json` file to inject chat messages
 * silently using the Language Server RPC connection instead of clipboard hacks.
 *
 * @module bridge
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { AntigravitySDK } from 'antigravity-sdk';

interface BridgeMessage {
    text: string;
}

export function initializeBridge(sdk: AntigravitySDK, context: vscode.ExtensionContext, output: vscode.OutputChannel): void {
    // Determine inbox path: workspace root or global storage as fallback
    let inboxPath: string;
    const workspaceFolders = vscode.workspace.workspaceFolders;
    
    if (workspaceFolders && workspaceFolders.length > 0) {
        inboxPath = path.join(workspaceFolders[0].uri.fsPath, 'inbox.json');
    } else {
        // Fallback to global storage if no workspace is open
        inboxPath = path.join(context.globalStorageUri.fsPath, 'inbox.json');
        // Ensure directory exists
        if (!fs.existsSync(path.dirname(inboxPath))) {
            fs.mkdirSync(path.dirname(inboxPath), { recursive: true });
        }
    }

    output.appendLine(`[bridge] Initializing legacy bridge via SDK (watching: ${inboxPath})...`);

    // Function to process a single message file
    const processInbox = async (fileUri: vscode.Uri) => {
        try {
            // Ensure file still exists (could be deleted quickly)
            if (!fs.existsSync(fileUri.fsPath)) return;

            // Read and parse
            const data = await vscode.workspace.fs.readFile(fileUri);
            const content = Buffer.from(data).toString('utf8');
            let json: BridgeMessage;
            
            try {
                json = JSON.parse(content);
            } catch (e) {
                // Not JSON or empty, ignore
                return;
            }

            if (!json || typeof json.text !== 'string') return;
            const messageStr = json.text.trim();
            if (!messageStr) return;

            output.appendLine(`[bridge] Processing incoming message: ${messageStr.substring(0, 50)}...`);

            // Inject via SDK Language Server
            if (sdk.ls.isReady) {
                // Create a cascade/conversation
                const startResp = await sdk.ls.rawRPC('StartCascade', { source: 0 });
                const cascadeId = startResp?.cascadeId;
                
                if (cascadeId) {
                    output.appendLine(`[bridge] Cascade created: ${cascadeId}. Injecting message...`);
                    
                    // 1. Send message FIRST (critical path)
                    sdk.ls.sendMessage({ cascadeId, text: messageStr }).then(() => {
                        output.appendLine(`[bridge] Message successfully injected into cascade ${cascadeId}`);
                    }).catch(e => {
                        output.appendLine(`[bridge] Message injection error: ${e.message}`);
                    });

                    // 2. Focus SECOND (non-blocking, best effort)
                    sdk.ls.focusCascade(cascadeId).catch(e => {
                        output.appendLine(`[bridge] Focus failed (skipping): ${e.message}`);
                    });
                } else {
                    output.appendLine('[bridge] Failed to create cascade for message');
                }
            } else {
                output.appendLine('[bridge] Error: LSBridge is not ready. Cannot inject message.');
            }

            // Clean up file
            await vscode.workspace.fs.delete(fileUri);
        } catch (error) {
            output.appendLine(`[bridge] Error processing inbox: ${error}`);
        }
    };

    // Set up standard VS Code File System Watcher
    const watcher = vscode.workspace.createFileSystemWatcher(inboxPath, false, false, false);
    
    // Process on creation and modification
    watcher.onDidCreate(processInbox);
    watcher.onDidChange(processInbox);
    
    context.subscriptions.push(watcher);
    output.appendLine(`[bridge] Watching for messages at ${inboxPath}`);

    // If file already exists, process it immediately
    const inboxUri = vscode.Uri.file(inboxPath);
    if (fs.existsSync(inboxPath)) {
        processInbox(inboxUri);
    }
}
