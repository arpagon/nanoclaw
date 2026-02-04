---
name: add-matrix
description: Add Matrix as a communication channel to NanoClaw. Can replace WhatsApp entirely or run alongside it. Supports rooms, DMs, end-to-end encryption (E2EE), and all existing NanoClaw features (scheduled tasks, file mounts, isolated groups). Triggers on "add matrix", "matrix channel", "matrix support", "replace whatsapp with matrix", or "element".
---

# Add Matrix Channel

This skill adds Matrix protocol support to NanoClaw. Matrix is an open, decentralized communication protocol used by clients like Element, FluffyChat, and others.

## Initial Questions

Ask the user:

> How do you want to use Matrix with NanoClaw?
>
> **Option 1: Replace WhatsApp**
> - Matrix becomes your only communication channel
> - Removes WhatsApp code entirely
> - Cleaner codebase, single protocol
>
> **Option 2: Add alongside WhatsApp**
> - Both channels work simultaneously
> - Messages from either can trigger the agent
> - More complex setup but maximum flexibility
>
> Which option do you prefer?

Also ask:

> Do you have a Matrix account already, or do you need guidance setting one up?
>
> You'll need:
> - A Matrix homeserver URL (e.g., `https://matrix.org` or self-hosted)
> - A user ID (e.g., `@yourbot:matrix.org`)
> - An access token (generated from your client or via API)

Store their choices for implementation.

---

## Prerequisites

### 1. Check Node.js Version

Matrix SDK requires Node.js 18+:

```bash
node --version
```

If below 18, tell the user to upgrade first.

### 2. Verify Matrix Credentials

Ask the user for their Matrix credentials:

> Please provide your Matrix credentials:
>
> 1. **Homeserver URL**: The Matrix server URL (e.g., `https://matrix.org`, `https://matrix.example.com`)
> 2. **User ID**: Your bot's Matrix user ID (e.g., `@nanoclaw:matrix.org`)
> 3. **Access Token**: An access token for authentication
>
> **To get an access token from Element:**
> 1. Open Element and log in as your bot account
> 2. Go to Settings -> Help & About
> 3. Click "Access Token" (you may need to enable developer mode first)
> 4. Copy the token (keep it secret!)
>
> **Or via curl:**
> ```bash
> curl -X POST "https://YOUR_HOMESERVER/_matrix/client/r0/login" \
>   -H "Content-Type: application/json" \
>   -d '{"type":"m.login.password","user":"YOUR_USERNAME","password":"YOUR_PASSWORD"}'
> ```

### 3. Install Matrix SDK

```bash
npm install matrix-bot-sdk
```

Add to `package.json` dependencies:

```json
"matrix-bot-sdk": "^0.7.1"
```

---

## Option 1: Replace WhatsApp with Matrix

This section completely replaces WhatsApp with Matrix.

### Step 1: Create Matrix Types

Create `src/matrix-types.ts`:

```typescript
export interface MatrixConfig {
  homeserver: string;
  userId: string;
  accessToken: string;
  /** Enable end-to-end encryption (requires additional setup). */
  encryption?: boolean;
  /** Rooms/DMs the bot should respond in. Key is room ID or alias. */
  rooms?: Record<string, MatrixRoomConfig>;
  /** Default: require @mention to trigger in rooms. */
  requireMention?: boolean;
}

export interface MatrixRoomConfig {
  /** If false, ignore this room. Default: true. */
  enabled?: boolean;
  /** Override global requireMention for this room. */
  requireMention?: boolean;
  /** Folder name for this room's isolated context. */
  folder?: string;
  /** Custom trigger pattern (regex). */
  triggerPattern?: string;
}

export interface MatrixMessage {
  roomId: string;
  eventId: string;
  sender: string;
  senderName: string;
  content: string;
  timestamp: string;
  threadId?: string;
  replyToId?: string;
}
```

### Step 2: Create Matrix Client Module

Create `src/matrix-client.ts`:

```typescript
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
import type { MatrixConfig, MatrixMessage } from './matrix-types.js';

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
  
  // Create client
  client = new MatrixClient(
    config.homeserver,
    config.accessToken,
    storage
  );
  
  // Enable E2EE if configured
  if (config.encryption) {
    const cryptoDir = path.join(storageDir, 'crypto');
    fs.mkdirSync(cryptoDir, { recursive: true });
    const cryptoStorage = new RustSdkCryptoStorageProvider(cryptoDir);
    await client.crypto.prepare(cryptoStorage);
    logger.info('Matrix E2EE enabled');
  }
  
  // Auto-join rooms when invited
  AutojoinRoomsMixin.setupOnClient(client);
  
  // Process reply fallbacks
  client.addPreprocessor(new RichRepliesPreprocessor());
  
  logger.info({ homeserver: config.homeserver, userId: config.userId }, 'Matrix client initialized');
  
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
```

### Step 3: Create Matrix Monitor Module

Create `src/matrix-monitor.ts`:

```typescript
import { MessageEvent, RoomEvent } from 'matrix-bot-sdk';
import pino from 'pino';
import {
  getMatrixClient,
  getMatrixConfig,
  sendMatrixMessage,
  setMatrixTyping,
} from './matrix-client.js';
import { ASSISTANT_NAME, TRIGGER_PATTERN, MAIN_GROUP_FOLDER } from './config.js';
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
  
  client.on('room.message', async (roomId: string, event: MessageEvent<unknown>) => {
    // Ignore own messages
    if (event.sender === config.userId) return;
    
    // Ignore non-text messages
    const content = event.content as { msgtype?: string; body?: string; 'm.relates_to'?: { rel_type?: string; event_id?: string } };
    if (content.msgtype !== 'm.text' || !content.body) return;
    
    const text = content.body.trim();
    if (!text) return;
    
    // Get room config
    const roomConfig = config.rooms?.[roomId] ?? null;
    if (roomConfig?.enabled === false) return;
    
    // Determine if this is the main room
    const isMain = roomConfig?.folder === MAIN_GROUP_FOLDER;
    
    // Check if we should respond
    const requireMention = roomConfig?.requireMention ?? config.requireMention ?? !isMain;
    
    if (requireMention && !mentionPattern.test(text) && !TRIGGER_PATTERN.test(text)) {
      return;
    }
    
    // Get sender display name
    let senderName = event.sender;
    try {
      const profile = await client.getUserProfile(event.sender);
      senderName = profile.displayname || event.sender;
    } catch {
      // Use sender ID if profile fetch fails
    }
    
    // Extract thread info
    const relatesTo = content['m.relates_to'];
    const threadId = relatesTo?.rel_type === 'm.thread' ? relatesTo.event_id : undefined;
    
    const message: MatrixMessage = {
      roomId,
      eventId: event.event_id,
      sender: event.sender,
      senderName,
      content: text,
      timestamp: new Date(event.origin_server_ts).toISOString(),
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
  client.on('room.invite', (roomId: string, event: RoomEvent<unknown>) => {
    logger.info({ roomId, inviter: event.sender }, 'Received room invite (auto-joining)');
  });
  
  logger.info('Matrix monitor started');
}
```

### Step 4: Update Main Entry Point

Replace the WhatsApp-specific code in `src/index.ts` with Matrix. The structure should follow the same pattern:

**Key changes:**

1. Replace `connectWhatsApp()` with `connectMatrix()`:

```typescript
import {
  initMatrixClient,
  getMatrixClient,
  sendMatrixMessage,
  setMatrixTyping,
  stopMatrixClient,
  loadMatrixConfig,
} from './matrix-client.js';
import { startMatrixMonitor } from './matrix-monitor.js';
import type { MatrixMessage, MatrixRoomConfig } from './matrix-types.js';

async function connectMatrix(): Promise<void> {
  const client = await initMatrixClient();
  
  startMatrixMonitor(async (message, roomConfig, isMain) => {
    await processMatrixMessage(message, roomConfig, isMain);
  });
  
  // Start the client (begins syncing)
  await client.start();
  logger.info('Connected to Matrix');
  
  // Start scheduler and IPC watcher
  startSchedulerLoop({
    sendMessage: async (jid: string, text: string) => {
      // jid is room ID for Matrix
      await sendMatrixMessage(jid, text);
    },
    registeredGroups: () => registeredGroups,
    getSessions: () => sessions,
  });
  startIpcWatcher();
}
```

2. Replace `processMessage()` with `processMatrixMessage()`:

```typescript
async function processMatrixMessage(
  message: MatrixMessage,
  roomConfig: MatrixRoomConfig | null,
  isMain: boolean
): Promise<void> {
  const folder = roomConfig?.folder ?? (isMain ? MAIN_GROUP_FOLDER : `matrix-${message.roomId.replace(/[^a-zA-Z0-9]/g, '_')}`);
  
  // Build group object for container runner
  const group: RegisteredGroup = {
    name: folder,
    folder,
    trigger: roomConfig?.triggerPattern ?? `@${ASSISTANT_NAME}`,
    added_at: new Date().toISOString(),
  };
  
  // Ensure group is registered
  if (!registeredGroups[message.roomId]) {
    registeredGroups[message.roomId] = group;
    saveJson(path.join(DATA_DIR, 'registered_groups.json'), registeredGroups);
    
    // Create group folder
    const groupDir = path.join(DATA_DIR, '..', 'groups', folder);
    fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });
  }
  
  // Build prompt with context
  const prompt = `<message sender="${message.senderName}" time="${message.timestamp}">${message.content}</message>`;
  
  await setMatrixTyping(message.roomId, true);
  const response = await runAgent(group, prompt, message.roomId);
  await setMatrixTyping(message.roomId, false);
  
  if (response) {
    lastAgentTimestamp[message.roomId] = message.timestamp;
    await sendMatrixMessage(message.roomId, `${ASSISTANT_NAME}: ${response}`, message.threadId);
  }
}
```

3. Update `main()`:

```typescript
async function main(): Promise<void> {
  ensureContainerSystemRunning();
  initDatabase();
  logger.info('Database initialized');
  loadState();
  await connectMatrix();
}
```

### Step 5: Update IPC Message Handler

Update `processIpcFiles()` to use `sendMatrixMessage()` instead of WhatsApp:

```typescript
// In the message IPC handler:
if (data.type === 'message' && data.chatJid && data.text) {
  // chatJid is now a Matrix room ID
  const targetGroup = registeredGroups[data.chatJid];
  if (isMain || (targetGroup && targetGroup.folder === sourceGroup)) {
    await sendMatrixMessage(data.chatJid, `${ASSISTANT_NAME}: ${data.text}`);
    logger.info({ roomId: data.chatJid, sourceGroup }, 'IPC message sent');
  } else {
    logger.warn({ roomId: data.chatJid, sourceGroup }, 'Unauthorized IPC message attempt blocked');
  }
}
```

### Step 6: Create Matrix Configuration File

Create `data/matrix_config.json` with user's credentials:

```json
{
  "homeserver": "https://matrix.org",
  "userId": "@nanoclaw:matrix.org",
  "accessToken": "syt_XXXXXXXXXXXX",
  "encryption": false,
  "requireMention": true,
  "rooms": {
    "!roomid:matrix.org": {
      "folder": "main",
      "requireMention": false
    }
  }
}
```

Or add to `.env`:

```bash
MATRIX_HOMESERVER=https://matrix.org
MATRIX_USER_ID=@nanoclaw:matrix.org
MATRIX_ACCESS_TOKEN=syt_XXXXXXXXXXXX
MATRIX_ENCRYPTION=false
MATRIX_REQUIRE_MENTION=true
```

### Step 7: Update Group Memory

Update `groups/CLAUDE.md` and `groups/main/CLAUDE.md` to reference Matrix:

```markdown
# ${ASSISTANT_NAME}

You are ${ASSISTANT_NAME}, a personal AI assistant communicating via Matrix.

## Communication

- Respond to messages in Matrix rooms
- Use @mentions to reply to specific users
- Support threads when responding to threaded messages
```

### Step 8: Remove WhatsApp Dependencies

Remove baileys from package.json:

```bash
npm uninstall @whiskeysockets/baileys
```

Remove the WhatsApp auth directory:

```bash
rm -rf store/auth
```

### Step 9: Update Container Image

Update `container/Dockerfile` if needed (Matrix SDK is pure JS, no native dependencies required for basic usage).

### Step 10: Build and Test

```bash
npm run build
```

Start the service:

```bash
npm run dev
```

Or restart the launchd service:

```bash
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

Test by sending a message to your bot in Matrix:

```
@YourBotName hello
```

---

## Option 2: Add Matrix Alongside WhatsApp

This section adds Matrix as an additional channel while keeping WhatsApp.

### Step 1: Create Matrix Modules (Same as Option 1)

Create the same files from Option 1:
- `src/matrix-types.ts`
- `src/matrix-client.ts`
- `src/matrix-monitor.ts`

### Step 2: Create Channel Abstraction

Create `src/channels.ts`:

```typescript
import { sendMatrixMessage, setMatrixTyping } from './matrix-client.js';
import { WASocket } from '@whiskeysockets/baileys';

export type ChannelType = 'whatsapp' | 'matrix';

export interface Channel {
  type: ChannelType;
  sendMessage: (target: string, text: string, threadId?: string) => Promise<void>;
  setTyping: (target: string, isTyping: boolean) => Promise<void>;
}

export function createWhatsAppChannel(sock: WASocket): Channel {
  return {
    type: 'whatsapp',
    sendMessage: async (jid, text) => {
      await sock.sendMessage(jid, { text });
    },
    setTyping: async (jid, isTyping) => {
      await sock.sendPresenceUpdate(isTyping ? 'composing' : 'paused', jid);
    },
  };
}

export function createMatrixChannel(): Channel {
  return {
    type: 'matrix',
    sendMessage: sendMatrixMessage,
    setTyping: setMatrixTyping,
  };
}

// Determine channel type from JID/room ID
export function detectChannelType(target: string): ChannelType {
  // Matrix room IDs start with ! or # (aliases)
  if (target.startsWith('!') || target.startsWith('#')) {
    return 'matrix';
  }
  // WhatsApp JIDs end with @g.us or @s.whatsapp.net
  if (target.includes('@')) {
    return 'whatsapp';
  }
  // Default to WhatsApp for backward compatibility
  return 'whatsapp';
}
```

### Step 3: Update Registered Groups Type

Update `src/types.ts`:

```typescript
export interface RegisteredGroup {
  name: string;
  folder: string;
  trigger: string;
  added_at: string;
  channel?: 'whatsapp' | 'matrix';  // NEW: Track which channel
  containerConfig?: {
    additionalMounts?: Array<{
      hostPath: string;
      containerPath: string;
      readonly?: boolean;
    }>;
    timeout?: number;
  };
}
```

### Step 4: Update Main Entry Point

Modify `src/index.ts` to initialize both channels:

```typescript
import { initMatrixClient, getMatrixClient } from './matrix-client.js';
import { startMatrixMonitor } from './matrix-monitor.js';
import { createWhatsAppChannel, createMatrixChannel, detectChannelType, Channel } from './channels.js';

let channels: Record<string, Channel> = {};

async function main(): Promise<void> {
  ensureContainerSystemRunning();
  initDatabase();
  logger.info('Database initialized');
  loadState();
  
  // Initialize WhatsApp
  await connectWhatsApp();
  channels.whatsapp = createWhatsAppChannel(sock);
  
  // Initialize Matrix (if configured)
  try {
    await initMatrixClient();
    const matrixClient = getMatrixClient();
    
    startMatrixMonitor(async (message, roomConfig, isMain) => {
      await processMatrixMessage(message, roomConfig, isMain);
    });
    
    await matrixClient.start();
    channels.matrix = createMatrixChannel();
    logger.info('Matrix channel initialized');
  } catch (err) {
    logger.warn({ err }, 'Matrix not configured, skipping');
  }
}

// Universal send function
async function sendMessage(target: string, text: string): Promise<void> {
  const channelType = detectChannelType(target);
  const channel = channels[channelType];
  
  if (!channel) {
    logger.error({ target, channelType }, 'Channel not available');
    return;
  }
  
  await channel.sendMessage(target, text);
}
```

### Step 5: Update IPC Handler

Update `processIpcFiles()` to route messages to the correct channel:

```typescript
if (data.type === 'message' && data.chatJid && data.text) {
  const targetGroup = registeredGroups[data.chatJid];
  if (isMain || (targetGroup && targetGroup.folder === sourceGroup)) {
    // Use universal send function
    await sendMessage(data.chatJid, `${ASSISTANT_NAME}: ${data.text}`);
    logger.info({ target: data.chatJid, sourceGroup }, 'IPC message sent');
  }
}
```

### Step 6: Update Scheduler

Update `src/task-scheduler.ts` to use the universal send function.

### Step 7: Test Both Channels

```bash
npm run build
npm run dev
```

Test WhatsApp:
```
@Assistant hello from WhatsApp
```

Test Matrix:
```
@Assistant hello from Matrix
```

---

## Troubleshooting

### Matrix SDK not found

```bash
npm install matrix-bot-sdk
```

### Access token invalid

```
Error: M_UNKNOWN_TOKEN: Invalid macaroon passed
```

Generate a new access token from your Matrix client or via the login API.

### E2EE not working

E2EE requires additional setup:
1. Install Rust SDK crypto dependencies
2. Verify device from another session
3. Ensure room is encrypted

For basic usage, set `encryption: false`.

### Bot not responding in rooms

Check:
1. Bot is a member of the room
2. Room ID is in `rooms` config (or global `requireMention` is false)
3. Message contains the trigger/mention pattern

### Container can't send Matrix messages

Ensure the Matrix config is mounted in the container or use environment variables that persist in the container context.

---

## Summary of Changes

### Option 1 (Replace WhatsApp)

| File | Change |
|------|--------|
| `package.json` | Remove baileys, add matrix-bot-sdk |
| `src/matrix-types.ts` | NEW: Matrix type definitions |
| `src/matrix-client.ts` | NEW: Matrix client wrapper |
| `src/matrix-monitor.ts` | NEW: Matrix event handler |
| `src/index.ts` | Replace WhatsApp with Matrix |
| `src/config.ts` | Add Matrix config constants |
| `data/matrix_config.json` | NEW: Matrix credentials |
| `.env` | Add Matrix environment variables |
| `groups/*/CLAUDE.md` | Update channel references |
| `store/auth/` | DELETE: WhatsApp auth (no longer needed) |

### Option 2 (Add Alongside)

| File | Change |
|------|--------|
| `package.json` | Add matrix-bot-sdk |
| `src/matrix-types.ts` | NEW: Matrix type definitions |
| `src/matrix-client.ts` | NEW: Matrix client wrapper |
| `src/matrix-monitor.ts` | NEW: Matrix event handler |
| `src/channels.ts` | NEW: Channel abstraction |
| `src/types.ts` | Add channel field to RegisteredGroup |
| `src/index.ts` | Initialize both channels |
| `src/task-scheduler.ts` | Use universal send |
| `data/matrix_config.json` | NEW: Matrix credentials |

---

## Reference: OpenClaw Matrix Extension

This skill is informed by the Matrix extension in OpenClaw (`extensions/matrix/`). Key differences:

| OpenClaw | NanoClaw |
|----------|----------|
| Plugin architecture | Direct code modification |
| Complex account management | Single account |
| MCP server integration | Claude Agent SDK direct |
| Config via YAML | Config via JSON/env |

The NanoClaw implementation is intentionally simpler, following the project's philosophy of "small enough to understand."

---

## Security Considerations

1. **Access Token**: Store in `data/matrix_config.json` (not in git) or environment variables
2. **Room Permissions**: Only respond in explicitly configured rooms, or require @mention
3. **E2EE**: Enable for sensitive communications (requires additional setup)
4. **Rate Limiting**: Matrix homeservers have rate limits; avoid spamming

---

## Future Enhancements

Consider contributing additional skills:
- `/add-matrix-e2ee` - Full E2EE setup with device verification
- `/add-matrix-bridge` - Bridge Matrix to WhatsApp rooms
- `/add-matrix-admin` - Admin commands for room management
