import { Context, NextFunction } from 'grammy';
import { AntigravityBridge } from './engine-bridge';
import * as vscode from 'vscode';

/**
 * Middleware to restrict access to the bot to a specific list of User IDs.
 */
export async function authMiddleware(ctx: Context, next: NextFunction) {
    const config = vscode.workspace.getConfiguration('better-antigravity.telegram');
    const allowedUsers = config.get<string[]>('allowedUserIds') || [];
    
    const userId = ctx.from?.id.toString();
    
    if (!userId) return;

    // If allowedUsers is empty, we allow everyone (useful for INITIAL setup, but warned)
    if (allowedUsers.length > 0 && !allowedUsers.includes(userId)) {
        console.warn(`Unauthorized access attempt from User ID: ${userId}`);
        if (ctx.chat?.type === 'private') {
            await ctx.reply(`⚠️ Unauthorized. Your User ID is \`${userId}\`. Add it to VS Code settings to enable access.`);
        }
        return;
    }
    
    return next();
}

/**
 * Registers all bot command and message handlers.
 */
export function setupHandlers(bot: any, bridge: AntigravityBridge, manager: any) {
    // /start - Welcome message
    bot.command('start', (ctx: any) => ctx.reply('🚀 *Antigravity Bridge Active*\n\nSend me any prompt, and I will inject it directly into your active VS Code session.', { parse_mode: 'Markdown' }));
    
    // /status - Check connection to IDE
    bot.command('status', async (ctx: any) => {
        const sdkStatus = await bridge.getStatus();
        await ctx.reply(`📊 *Status Report*\n\n*Connection:* ${sdkStatus}`, { parse_mode: 'Markdown' });
    });

    // /new - Start a fresh conversation
    bot.command('new', async (ctx: any) => {
        bridge.resetSession(ctx.chat.id);
        await ctx.reply('✨ *Session Reset*\n\nThe next message you send will start a fresh conversation.', { parse_mode: 'Markdown' });
    });

    // Handle plain text messages
    bot.on('message:text', async (ctx: any) => {
        const config = vscode.workspace.getConfiguration('better-antigravity.telegram');
        const shouldLog = config.get<boolean>('logMessages');
        
        if (shouldLog) {
            manager.log(`Received: "${ctx.message.text}" from ${ctx.from.username || ctx.from.id}`);
        }

        try {
            await bridge.sendUserMessage({
                text: ctx.message.text,
                userId: ctx.from.id.toString(),
                username: ctx.from.username,
                chatId: ctx.chat.id
            }, (msg) => manager.log(msg));
            
            // Subtle acknowledgement (using reaction if possible, or just a small text)
            try {
                // Reactions are Bot API 7.0+
                await ctx.react('👌');
            } catch {
                // Fallback for older bot API or if reactor fails
            }
        } catch (err) {
            await ctx.reply(`❌ *Failed to forward:* ${err instanceof Error ? err.message : String(err)}`, { parse_mode: 'Markdown' });
        }
    });
}
