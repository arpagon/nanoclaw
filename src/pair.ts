#!/usr/bin/env node
/**
 * NanoClaw Pairing CLI
 * 
 * Usage: npm run pair <code>
 * 
 * Approves a pairing request and sets up the main admin channel.
 */

import { approvePairing, getPendingPairing, getOwner } from './pairing.js';
import { loadJson, saveJson } from './utils.js';
import { DATA_DIR, MAIN_GROUP_FOLDER } from './config.js';
import { RegisteredGroup } from './types.js';
import fs from 'fs';
import path from 'path';

const code = process.argv[2];

if (!code) {
  console.error('Usage: npm run pair <CODE>');
  console.error('');
  
  const pending = getPendingPairing();
  if (pending) {
    console.error('Pending pairing request:');
    console.error(`  Code: ${pending.code}`);
    console.error(`  User: ${pending.oderId}`);
    console.error(`  Room: ${pending.roomName}`);
    console.error(`  Created: ${pending.createdAt}`);
  } else {
    const owner = getOwner();
    if (owner) {
      console.error('NanoClaw is already paired:');
      console.error(`  Owner: ${owner.ownerId}`);
      console.error(`  Main Room: ${owner.mainRoomId}`);
      console.error(`  Paired: ${owner.pairedAt}`);
    } else {
      console.error('No pending pairing request. Send a message to the bot first.');
    }
  }
  process.exit(1);
}

// Check if already paired
const existingOwner = getOwner();
if (existingOwner) {
  console.error('NanoClaw is already paired!');
  console.error(`  Owner: ${existingOwner.ownerId}`);
  console.error(`  Main Room: ${existingOwner.mainRoomId}`);
  console.error(`  Paired: ${existingOwner.pairedAt}`);
  console.error('');
  console.error('To reset, delete data/owner.json and restart NanoClaw.');
  process.exit(1);
}

// Try to approve
const owner = approvePairing(code);

if (!owner) {
  console.error('Invalid or expired pairing code.');
  
  const pending = getPendingPairing();
  if (pending) {
    console.error(`Current valid code: ${pending.code}`);
  } else {
    console.error('No pending pairing request. Send a message to the bot first.');
  }
  process.exit(1);
}

// Register the main group
const groupsPath = path.join(DATA_DIR, 'registered_groups.json');
const groups = loadJson<Record<string, RegisteredGroup>>(groupsPath, {});

groups[owner.mainRoomId] = {
  name: 'main',
  folder: MAIN_GROUP_FOLDER,
  trigger: '@Andy',
  added_at: new Date().toISOString(),
};

saveJson(groupsPath, groups);

// Create the main group folder if it doesn't exist
const mainGroupDir = path.join(DATA_DIR, '..', 'groups', MAIN_GROUP_FOLDER);
fs.mkdirSync(path.join(mainGroupDir, 'logs'), { recursive: true });

console.log('✅ Pairing successful!');
console.log('');
console.log(`  Owner: ${owner.ownerId}`);
console.log(`  Main Room: ${owner.mainRoomId}`);
console.log(`  Folder: groups/${MAIN_GROUP_FOLDER}/`);
console.log('');
console.log('Restart NanoClaw to apply changes:');
console.log('  systemctl --user restart nanoclaw');
