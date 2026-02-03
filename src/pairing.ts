/**
 * Simple pairing system for NanoClaw
 * 
 * The first user to complete pairing becomes the owner.
 * Their room becomes the "main" admin channel.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DATA_DIR, MAIN_GROUP_FOLDER } from './config.js';
import { loadJson, saveJson } from './utils.js';

const PAIRING_CODE_LENGTH = 8;
const PAIRING_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export interface Owner {
  ownerId: string;      // @user:matrix.org
  mainRoomId: string;   // !room:matrix.org
  pairedAt: string;     // ISO timestamp
}

interface PendingPairing {
  code: string;
  oderId: string;
  roomId: string;
  roomName: string;
  createdAt: string;
}

const OWNER_PATH = path.join(DATA_DIR, 'owner.json');
const PENDING_PATH = path.join(DATA_DIR, 'pending_pairing.json');

/**
 * Generate a random pairing code (8 chars, uppercase, no ambiguous chars)
 */
function generateCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No 0O1I
  let code = '';
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
    code += alphabet[crypto.randomInt(0, alphabet.length)];
  }
  return code;
}

/**
 * Get the current owner, or null if not paired
 */
export function getOwner(): Owner | null {
  return loadJson<Owner | null>(OWNER_PATH, null);
}

/**
 * Check if a user is the owner
 */
export function isOwner(userId: string): boolean {
  const owner = getOwner();
  return owner?.ownerId === userId;
}

/**
 * Check if NanoClaw has been paired (has an owner)
 */
export function isPaired(): boolean {
  return getOwner() !== null;
}

/**
 * Get the main room ID (owner's room)
 */
export function getMainRoomId(): string | null {
  const owner = getOwner();
  return owner?.mainRoomId ?? null;
}

/**
 * Create a pending pairing request
 * Returns the code to display to the user
 */
export function createPairingRequest(userId: string, roomId: string, roomName: string): string {
  const code = generateCode();
  const pending: PendingPairing = {
    code,
    oderId: userId,
    roomId,
    roomName,
    createdAt: new Date().toISOString(),
  };
  saveJson(PENDING_PATH, pending);
  return code;
}

/**
 * Get the current pending pairing request, or null if none/expired
 */
export function getPendingPairing(): PendingPairing | null {
  const pending = loadJson<PendingPairing | null>(PENDING_PATH, null);
  if (!pending) return null;
  
  // Check if expired
  const createdAt = new Date(pending.createdAt).getTime();
  if (Date.now() - createdAt > PAIRING_CODE_TTL_MS) {
    // Expired, clean up
    try {
      fs.unlinkSync(PENDING_PATH);
    } catch { /* ignore */ }
    return null;
  }
  
  return pending;
}

/**
 * Approve a pairing code
 * Returns the owner info if successful, null if code is invalid/expired
 */
export function approvePairing(code: string): Owner | null {
  const pending = getPendingPairing();
  if (!pending) return null;
  
  // Normalize code comparison
  if (pending.code.toUpperCase() !== code.toUpperCase()) {
    return null;
  }
  
  // Create owner
  const owner: Owner = {
    ownerId: pending.oderId,
    mainRoomId: pending.roomId,
    pairedAt: new Date().toISOString(),
  };
  
  saveJson(OWNER_PATH, owner);
  
  // Clean up pending
  try {
    fs.unlinkSync(PENDING_PATH);
  } catch { /* ignore */ }
  
  return owner;
}

/**
 * Build the pairing message to send to the user
 */
export function buildPairingMessage(code: string): string {
  return [
    '🔐 **NanoClaw no está configurado**',
    '',
    `Código de pairing: \`${code}\``,
    '',
    'Si eres el owner, ejecuta en la terminal del servidor:',
    '```',
    `npm run pair ${code}`,
    '```',
    '',
    `_El código expira en ${PAIRING_CODE_TTL_MS / 60000} minutos._`,
  ].join('\n');
}

/**
 * Check if a room is the main (admin) room
 */
export function isMainRoom(roomId: string): boolean {
  const owner = getOwner();
  return owner?.mainRoomId === roomId;
}
