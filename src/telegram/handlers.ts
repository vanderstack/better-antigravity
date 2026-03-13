import { Context, NextFunction, InlineKeyboard } from 'grammy';
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
 * Bot Command Definition
 */
interface BotCommand {
    command: string;
    description: string;
    handler: (ctx: any) => Promise<any> | any;
}

/**
 * Registers all bot command and message handlers.
 */
export function setupHandlers(bot: any, bridge: AntigravityBridge, manager: any) {
    const commands: BotCommand[] = [
        {
            command: 'start',
            description: 'Show welcome message and instructions',
            handler: (ctx) => ctx.reply('🚀 <b>Antigravity Bridge Active</b>\n\nSend me any prompt, and I will inject it directly into your active VS Code session.', { parse_mode: 'HTML' })
        },
        {
            command: 'status',
            description: 'Check bridge connection and IDE status',
            handler: async (ctx) => {
                const sdkStatus = await bridge.getStatus();
                const safeStatus = sdkStatus.replace(/</g, '&lt;').replace(/>/g, '&gt;');
                await ctx.reply(`📊 <b>Status Report</b>\n\n<b>Connection:</b> ${safeStatus}`, { parse_mode: 'HTML' });
            }
        },
        {
            command: 'new',
            description: 'Start a fresh conversation thread',
            handler: async (ctx) => {
                bridge.resetSession(ctx.chat.id);
                await ctx.reply('✨ <b>Session Reset</b>\n\nThe next message you send will start a fresh conversation.', { parse_mode: 'HTML' });
            }
        },
        {
            command: 'list',
            description: 'List your available Antigravity conversations',
            handler: async (ctx) => {
                const sessions = await bridge.getSessions();
                if (sessions.length === 0) {
                    return ctx.reply('📭 *No active conversations found.*');
                }

                const idMap = new Map<number, string>();
                let response = '📂 *Available Conversations:*\n\n';
                const keyboard = new InlineKeyboard();
                
                sessions.sort((a, b) => a.title.localeCompare(b.title)).forEach((s, i) => {
                    const num = i + 1;
                    idMap.set(num, s.id);
                    response += `${num}. *${s.title}*\n`;
                    keyboard.text(`Switch to ${num}`, `switch:${num}`);
                    if (num % 3 === 0) keyboard.row();
                });

                manager.setSessionMap(ctx.chat.id, idMap);
                await ctx.reply(response, { 
                    parse_mode: 'Markdown',
                    reply_markup: keyboard
                });
            }
        },
        {
            command: 'switch',
            description: 'Switch between conversations (`/switch {n}`)',
            handler: async (ctx) => {
                const arg = ctx.message.text.split(' ')[1];
                if (!arg) {
                    return ctx.reply('💡 *Usage:* `/switch {number}`\nRun `/list` first to see available numbers.', { parse_mode: 'Markdown' });
                }

                const num = parseInt(arg);
                const cascadeId = manager.getSessionFromMap(ctx.chat.id, num);

                if (!cascadeId) {
                    return ctx.reply(`❌ *Invalid number:* \`${arg}\`. Run \`/list\` to refresh IDs.`, { parse_mode: 'Markdown' });
                }

                bridge.setSession(ctx.chat.id, cascadeId);
                await ctx.reply(`🔄 *Switched to conversation:* \`${num}\``, { parse_mode: 'Markdown' });
            }
        },
        {
            command: 'errors',
            description: 'List failed messages in the error queue',
            handler: async (ctx) => {
                const files = manager.getErrorFiles();
                if (files.length === 0) {
                    return ctx.reply('✅ <b>No failed messages found.</b>', { parse_mode: 'HTML' });
                }

                let response = `⚠️ <b>Failed Messages (${files.length}):</b>\n\n`;
                files.slice(0, 15).forEach((f: string, i: number) => {
                    response += `${i + 1}. <code>${f}</code>\n`;
                });

                if (files.length > 15) {
                    response += `\n...and ${files.length - 15} more.`;
                }

                await ctx.reply(response, { parse_mode: 'HTML' });
            }
        },
        {
            command: 'clean_errors',
            description: 'Purge all failed messages from the error queue',
            handler: async (ctx) => {
                const count = manager.clearErrors();
                await ctx.reply(`🧹 <b>Cleanup Complete:</b> Removed <code>${count}</code> files from the error queue.`, { parse_mode: 'HTML' });
            }
        },
        {
            command: 'help',
            description: 'Show this list of available commands',
            handler: async (ctx) => {
                let helpText = '🛠️ <b>Antigravity Bot Help</b>\n\n';
                commands.forEach(cmd => {
                    helpText += `/${cmd.command} - ${cmd.description}\n`;
                });
                helpText += '\n<b>Any other text:</b> Forwarded to Antigravity';
                await ctx.reply(helpText, { parse_mode: 'HTML' });
            }
        }
    ];

    // Register all commands
    for (const cmd of commands) {
        bot.command(cmd.command, cmd.handler);
    }

    // Handle Inline Keyboard callback buttons
    bot.callbackQuery(/^switch:(\d+)$/, async (ctx: any) => {
        const num = parseInt(ctx.match[1]);
        const chatId = ctx.chat?.id;
        
        if (!chatId) {
            return ctx.answerCallbackQuery({ text: '❌ Chat context lost.', show_alert: true });
        }

        const cascadeId = manager.getSessionFromMap(chatId, num);

        if (!cascadeId) {
            return ctx.answerCallbackQuery({ 
                text: `❌ Link expired. Run /list again.`,
                show_alert: true 
            });
        }

        bridge.setSession(chatId, cascadeId);
        await ctx.answerCallbackQuery({ text: `🔄 Switched to conversation ${num}` });
        await ctx.reply(`🔄 <b>Switched to conversation:</b> <code>${num}</code>`, { parse_mode: 'HTML' });
    });

    // Catch-all for unmatched commands (anything starting with /)
    bot.on('message:text', async (ctx: any, next: NextFunction) => {
        if (ctx.message.text.startsWith('/')) {
            const commandTried = ctx.message.text.split(' ')[0];
            const safeCmd = commandTried.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return ctx.reply(`❓ <b>Unknown command:</b> <code>${safeCmd}</code>\n\nRun /help to see all available commands.`, { parse_mode: 'HTML' });
        }
        return next();
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
            const errMsg = err instanceof Error ? err.message : String(err);
            const safeErr = errMsg.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            await ctx.reply(`❌ <b>Failed to forward:</b> ${safeErr}`, { parse_mode: 'HTML' });
        }
    });
}
