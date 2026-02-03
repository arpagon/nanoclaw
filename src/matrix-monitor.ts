/**
 * Matrix Monitor Module for NanoClaw
 * Handles incoming Matrix events and routes them to the message handler
 */

import pino from 'pino';
import {
  getMatrixClient,
  getMatrixConfig,
} from './matrix-client.js';
import { ASSISTANT_NAME, TRIGGER_PATTERN } from './config.js';
import { isPaired, isMainRoom } from './pairing.js';
import type { MatrixMessage, MatrixRoomConfig } from './matrix-types.js';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: { target: 'pino-pretty', options: { colorize: true } }
});

type MessageHandler = (message: MatrixMessage, roomConfig: MatrixRoomConfig | null, isMain: boolean) => Promise<void>;

export function startMatrixMonitor(onMessage: MessageHandler): void {
  const client = getMatrixClient();
  const config = getMatrixConfig();
  
  const buildMentionPattern = (): RegExp => {
    const userId = config.userId;
    const localpart = userId.split(':')[0].replace('@', '');
    // Match @botname, @localpart, or full user ID
    return new RegExp(`(@${ASSISTANT_NAME}|@${localpart}|${userId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'i');
  };
  
  const mentionPattern = buildMentionPattern();
  
  client.on('room.message', async (roomId: string, event: Record<string, unknown>) => {
    logger.debug({ roomId, sender: event.sender, type: event.type }, 'Received room.message event');
    
    // Ignore own messages
    if (event.sender === config.userId) return;
    
    // Ignore non-text messages
    const content = event.content as { msgtype?: string; body?: string; 'm.relates_to'?: { rel_type?: string; event_id?: string } } | undefined;
    if (!content || content.msgtype !== 'm.text' || !content.body) {
      logger.debug({ roomId, msgtype: content?.msgtype }, 'Ignoring non-text message');
      return;
    }
    
    const text = content.body.trim();
    if (!text) return;
    
    // Get room config
    const roomConfig = config.rooms?.[roomId] ?? null;
    if (roomConfig?.enabled === false) return;
    
    // Determine if this is the main room (owner's room after pairing)
    const isMain = isPaired() && isMainRoom(roomId);
    
    // Check if this is a DM (direct message) - DMs don't require mention
    let isDM = false;
    try {
      const members = await client.getJoinedRoomMembers(roomId);
      isDM = members.length <= 2;
    } catch {
      // If we can't get members, assume it's not a DM
    }
    
    // Check if we should respond: DMs always respond, others check requireMention
    const requireMention = isDM ? false : (roomConfig?.requireMention ?? config.requireMention ?? !isMain);
    
    logger.debug({ roomId, text: text.substring(0, 50), isDM, requireMention, isMain }, 'Message check');
    
    if (requireMention && !mentionPattern.test(text) && !TRIGGER_PATTERN.test(text)) {
      logger.debug({ roomId }, 'Message ignored - no trigger/mention');
      return;
    }
    
    // Get sender display name
    let senderName = event.sender as string;
    try {
      const profile = await client.getUserProfile(event.sender as string);
      senderName = (profile as { displayname?: string }).displayname || (event.sender as string);
    } catch {
      // Use sender ID if profile fetch fails
    }
    
    // Extract thread info
    const relatesTo = content['m.relates_to'];
    const threadId = relatesTo?.rel_type === 'm.thread' ? relatesTo.event_id : undefined;
    
    const message: MatrixMessage = {
      roomId,
      eventId: event.event_id as string,
      sender: event.sender as string,
      senderName,
      content: text,
      timestamp: new Date((event.origin_server_ts as number) || Date.now()).toISOString(),
      threadId,
    };
    
    logger.info({ roomId, sender: senderName }, 'Processing Matrix message');
    
    try {
      await onMessage(message, roomConfig, isMain);
    } catch (err) {
      logger.error({ err, roomId, eventId: event.event_id }, 'Error handling Matrix message');
    }
  });
  
  // Handle room invites (already handled by AutojoinRoomsMixin, but log them)
  client.on('room.invite', (roomId: string, event: Record<string, unknown>) => {
    logger.info({ roomId, inviter: event.sender }, 'Received room invite (auto-joining)');
  });
  
  logger.info('Matrix monitor started');
}
