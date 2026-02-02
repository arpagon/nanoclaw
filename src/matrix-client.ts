/**
 * Matrix Client Module for NanoClaw
 * Handles Matrix connection, authentication, message sending, and E2EE
 */

import {
  MatrixClient,
  SimpleFsStorageProvider,
  AutojoinRoomsMixin,
  RichRepliesPreprocessor,
  RustSdkCryptoStorageProvider,
} from 'matrix-bot-sdk';
import path from 'path';
import fs from 'fs';
import pino from 'pino';
import { STORE_DIR, DATA_DIR } from './config.js';
import type { MatrixConfig } from './matrix-types.js';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: { target: 'pino-pretty', options: { colorize: true } }
});

let client: MatrixClient | null = null;
let config: MatrixConfig | null = null;

export function loadMatrixConfig(): MatrixConfig {
  const configPath = path.join(DATA_DIR, 'matrix_config.json');
  
  // Try loading from config file first
  if (fs.existsSync(configPath)) {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  }
  
  // Fall back to environment variables
  const homeserver = process.env.MATRIX_HOMESERVER;
  const userId = process.env.MATRIX_USER_ID;
  const accessToken = process.env.MATRIX_ACCESS_TOKEN;
  
  if (!homeserver || !userId || !accessToken) {
    throw new Error(
      'Matrix credentials not configured. Set MATRIX_HOMESERVER, MATRIX_USER_ID, and MATRIX_ACCESS_TOKEN ' +
      'in .env or create data/matrix_config.json'
    );
  }
  
  return {
    homeserver,
    userId,
    accessToken,
    encryption: process.env.MATRIX_ENCRYPTION === 'true',
    requireMention: process.env.MATRIX_REQUIRE_MENTION !== 'false',
  };
}

export async function initMatrixClient(): Promise<MatrixClient> {
  if (client) return client;
  
  config = loadMatrixConfig();
  
  const storageDir = path.join(STORE_DIR, 'matrix');
  fs.mkdirSync(storageDir, { recursive: true });
  
  const storage = new SimpleFsStorageProvider(path.join(storageDir, 'bot.json'));
  
  // Setup E2EE crypto storage if encryption is enabled
  let cryptoStore: RustSdkCryptoStorageProvider | undefined;
  if (config.encryption) {
    const cryptoDir = path.join(storageDir, 'crypto');
    fs.mkdirSync(cryptoDir, { recursive: true });
    cryptoStore = new RustSdkCryptoStorageProvider(cryptoDir);
    logger.info({ cryptoDir }, 'E2EE crypto storage initialized');
  }
  
  // Create client with optional crypto store
  client = new MatrixClient(
    config.homeserver,
    config.accessToken,
    storage,
    cryptoStore
  );
  
  // Auto-join rooms when invited
  AutojoinRoomsMixin.setupOnClient(client);
  
  // Process reply fallbacks
  client.addPreprocessor(new RichRepliesPreprocessor());
  
  logger.info({ 
    homeserver: config.homeserver, 
    userId: config.userId,
    encryption: config.encryption ?? false
  }, 'Matrix client initialized');
  
  return client;
}

export function getMatrixClient(): MatrixClient {
  if (!client) {
    throw new Error('Matrix client not initialized. Call initMatrixClient() first.');
  }
  return client;
}

export function getMatrixConfig(): MatrixConfig {
  if (!config) {
    config = loadMatrixConfig();
  }
  return config;
}

export async function sendMatrixMessage(roomId: string, text: string, threadId?: string): Promise<string> {
  const matrixClient = getMatrixClient();
  
  const content: Record<string, unknown> = {
    msgtype: 'm.text',
    body: text,
  };
  
  // Thread support
  if (threadId) {
    content['m.relates_to'] = {
      rel_type: 'm.thread',
      event_id: threadId,
    };
  }
  
  // sendMessage auto-encrypts if room is encrypted and crypto is enabled
  const eventId = await matrixClient.sendMessage(roomId, content);
  logger.info({ roomId, eventId, length: text.length }, 'Matrix message sent');
  return eventId;
}

export async function setMatrixTyping(roomId: string, isTyping: boolean): Promise<void> {
  try {
    const matrixClient = getMatrixClient();
    await matrixClient.setTyping(roomId, isTyping, isTyping ? 30000 : 0);
  } catch (err) {
    logger.debug({ roomId, err }, 'Failed to set typing indicator');
  }
}

export function stopMatrixClient(): void {
  if (client) {
    client.stop();
    client = null;
    logger.info('Matrix client stopped');
  }
}
