#!/usr/bin/env node

/**
 * Generates an Apple Shortcuts (.shortcut) file that POSTs an encrypted
 * credentials payload to the ioniq-autolock webhook.
 *
 * Credentials are AES-256-GCM encrypted with a key that only lives in Vercel
 * env vars — the shortcut file itself never contains plaintext credentials.
 *
 * Usage:
 *   node scripts/generate-shortcut.js \
 *     --url https://your-project.vercel.app/api/lock \
 *     --encryption-key <64_char_hex_key> \
 *     --username <bluelink_email> \
 *     --password <bluelink_password> \
 *     --pin <4_digit_pin> \
 *     --vin <vehicle_vin> \
 *     --region <US|CA|EU> \
 *     [--output ioniq-autolock.shortcut]
 *
 * Omit --encryption-key to have one generated for you.
 * Add the printed key to Vercel as the ENCRYPTION_KEY environment variable.
 */

import { createCipheriv, randomBytes } from 'crypto';
import { execSync } from 'child_process';
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
      '  --encryption-key <64_char_hex_key> \\\n' +
      '  --username <bluelink_email> \\\n' +
      '  --password <bluelink_password> \\\n' +
      '  --pin <4_digit_pin> \\\n' +
      '  --vin <vehicle_vin> \\\n' +
      '  --region <US|CA|EU> \\\n' +
      '  [--output ioniq-autolock.shortcut]'
  );
  process.exit(1);
}

const { url, username, password, pin, vin, region } = args;
const outputPath = resolve(args.output ?? 'ioniq-autolock.shortcut');

// ---------------------------------------------------------------------------
// Encryption
// ---------------------------------------------------------------------------

let encryptionKeyHex = args['encryption-key'];
let keyWasGenerated = false;

if (!encryptionKeyHex) {
  encryptionKeyHex = randomBytes(32).toString('hex');
  keyWasGenerated = true;
} else if (!/^[0-9a-fA-F]{64}$/.test(encryptionKeyHex)) {
  console.error('Error: --encryption-key must be a 64-character hex string (32 bytes).');
  console.error('Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}

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
// Plist helpers
// ---------------------------------------------------------------------------

/** @param {string} str */
function xmlEscape(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** @param {string} value */
function textTokenString(value) {
  return `<dict>
                            <key>Value</key>
                            <dict>
                                <key>attachmentsByRange</key>
                                <dict/>
                                <key>string</key>
                                <string>${xmlEscape(value)}</string>
                            </dict>
                            <key>WFSerializationType</key>
                            <string>WFTextTokenString</string>
                        </dict>`;
}

/**
 * @param {string} key
 * @param {string} value
 */
function dictionaryItem(key, value) {
  return `                    <dict>
                        <key>WFItemType</key>
                        <integer>0</integer>
                        <key>WFKey</key>
                        ${textTokenString(key)}
                        <key>WFValue</key>
                        ${textTokenString(value)}
                    </dict>`;
}

// ---------------------------------------------------------------------------
// Build the shortcut plist
// ---------------------------------------------------------------------------

// Shortcut body carries only the opaque encrypted payload — no plaintext credentials.
const bodyFields = { payload };
const dictionaryItems = Object.entries(bodyFields)
  .map(([k, v]) => dictionaryItem(k, v))
  .join('\n');

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>WFWorkflowClientVersion</key>
    <string>2600</string>
    <key>WFWorkflowMinimumClientVersion</key>
    <integer>900</integer>
    <key>WFWorkflowMinimumClientVersionString</key>
    <string>900</string>
    <key>WFWorkflowIcon</key>
    <dict>
        <key>WFWorkflowIconGlyphNumber</key>
        <integer>59511</integer>
        <key>WFWorkflowIconStartColor</key>
        <integer>431817727</integer>
    </dict>
    <key>WFWorkflowImportQuestions</key>
    <array/>
    <key>WFWorkflowInputContentItemClasses</key>
    <array/>
    <key>WFWorkflowOutputContentItemClasses</key>
    <array/>
    <key>WFWorkflowTypes</key>
    <array/>
    <key>WFWorkflowActions</key>
    <array>
        <dict>
            <key>WFWorkflowActionIdentifier</key>
            <string>is.workflow.actions.downloadurl</string>
            <key>WFWorkflowActionParameters</key>
            <dict>
                <key>ShowHeaders</key>
                <false/>
                <key>WFHTTPBodyType</key>
                <string>JSON</string>
                <key>WFHTTPMethod</key>
                <string>POST</string>
                <key>WFJSONValues</key>
                <dict>
                    <key>Value</key>
                    <dict>
                        <key>WFDictionaryFieldValueItems</key>
                        <array>
${dictionaryItems}
                        </array>
                    </dict>
                    <key>WFSerializationType</key>
                    <string>WFDictionaryFieldValue</string>
                </dict>
                <key>WFURL</key>
                <string>${xmlEscape(url)}</string>
            </dict>
        </dict>
    </array>
</dict>
</plist>`;

// ---------------------------------------------------------------------------
// Write output — convert to binary plist if plutil is available (macOS)
// ---------------------------------------------------------------------------

writeFileSync(outputPath, plist, 'utf8');

let format = 'XML plist';
try {
  execSync(`plutil -convert binary1 "${outputPath}"`, { stdio: 'ignore' });
  format = 'binary plist';
} catch {
  // plutil not available (non-macOS); XML plist is still importable
}

console.log(`Shortcut written to: ${outputPath} (${format})`);

if (keyWasGenerated) {
  console.log('');
  console.log('A new encryption key was generated. Add it to Vercel as an environment variable:');
  console.log('');
  console.log(`  ENCRYPTION_KEY=${encryptionKeyHex}`);
  console.log('');
  console.log('Without this key the webhook cannot decrypt the payload — keep it secret.');
}

console.log('');
console.log('To install on your iPhone:');
console.log('  1. AirDrop the file to your iPhone, or add it to iCloud Drive and open it there');
console.log('  2. Tap "Add Shortcut" when prompted');
console.log('  3. Go to Automation → New Automation → CarPlay → Disconnects');
console.log('  4. Add a "Run Shortcut" action and select this shortcut');
console.log('  5. Disable "Ask Before Running"');
console.log('');
console.log('Note: if iOS blocks import, enable Settings → Shortcuts → Allow Untrusted Shortcuts');
