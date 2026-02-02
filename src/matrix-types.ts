/**
 * Matrix Type Definitions for NanoClaw
 */

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
