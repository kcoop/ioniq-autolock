#!/usr/bin/env node

/**
 * Encrypts Bluelink credentials for use in the ioniq-autolock iOS Shortcut.
 *
 * Writes an encrypted payload file and prints the ENCRYPTION_KEY.
 * Use the payload file when manually configuring the iOS Shortcut.
 *
 * Usage:
 *   node scripts/generate-shortcut.js \
 *     --url https://your-project.vercel.app/api/lock \
 *     --username <bluelink_email> \
 *     --password <bluelink_password> \
 *     --pin <4_digit_pin> \
 *     --vin <vehicle_vin> \
 *     --region <US|CA|EU> \
 *     [--output ioniq-autolock.json]
 */

import { createCipheriv, randomBytes } from 'crypto';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const REQUIRED_ARGS = ['url', 'username', 'password', 'pin', 'vin', 'region'];

/**
 * @param {string[]} argv
 * @returns {Record<string, string>}
 */
function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      args[key] = argv[i + 1] ?? '';
      i++;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

const missing = REQUIRED_ARGS.filter((k) => !args[k]);
if (missing.length > 0) {
  console.error(`Error: missing required arguments: ${missing.map((k) => `--${k}`).join(', ')}\n`);
  console.error(
    'Usage: node scripts/generate-shortcut.js \\\n' +
      '  --url https://your-project.vercel.app/api/lock \\\n' +
      '  --username <bluelink_email> \\\n' +
      '  --password <bluelink_password> \\\n' +
      '  --pin <4_digit_pin> \\\n' +
      '  --vin <vehicle_vin> \\\n' +
      '  --region <US|CA|EU> \\\n' +
      '  [--output ioniq-autolock.json]'
  );
  process.exit(1);
}

const { url, username, password, pin, vin, region } = args;
const outputPath = resolve(args.output ?? 'ioniq-autolock.json');

// ---------------------------------------------------------------------------
// Encryption
// ---------------------------------------------------------------------------

const encryptionKeyHex = randomBytes(32).toString('hex');

/**
 * Encrypts plaintext with AES-256-GCM.
 * Returns a base64url string: iv (12 bytes) + authTag (16 bytes) + ciphertext.
 * @param {string} plaintext
 * @param {string} keyHex
 * @returns {string}
 */
function encrypt(plaintext, keyHex) {
  const key = Buffer.from(keyHex, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64url');
}

const payload = encrypt(
  JSON.stringify({ username, password, pin, vin, region }),
  encryptionKeyHex
);

// ---------------------------------------------------------------------------
// Write payload file and print instructions
// ---------------------------------------------------------------------------

writeFileSync(outputPath, JSON.stringify({ url, payload }, null, 2), 'utf8');

console.log('');
console.log(`Payload written to: ${outputPath}`);
console.log('');
console.log('1. Add to Vercel (Settings → Environment Variables):');
console.log('');
console.log(`   ENCRYPTION_KEY=${encryptionKeyHex}`);
console.log('');
console.log('2. Create an iOS Shortcut with a "Get Contents of URL" action:');
console.log('');
console.log(`   URL:    ${url}`);
console.log('   Method: POST');
console.log('   Body:   JSON');
console.log('   Key:    payload');
console.log(`   Value:  (copy from ${outputPath})`);
console.log('');
console.log('Then create an Automation: CarPlay → Disconnects → Run Shortcut.');
