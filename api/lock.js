import { createDecipheriv } from 'crypto';
import BlueLinky from 'bluelinky';

function badRequest(res, message) {
  console.error('[400]', message);
  res.status(400).json({ ok: false, error: message });
}

function serverError(res, message) {
  console.error('[500]', message);
  res.status(500).json({ ok: false, error: message });
}

/**
 * Decrypts an AES-256-GCM payload produced by the shortcut generator.
 * Expects a base64url string encoding: iv (12 bytes) + authTag (16 bytes) + ciphertext.
 * @param {string} encoded
 * @param {string} keyHex
 * @returns {string}
 */
function decrypt(encoded, keyHex) {
  const key = Buffer.from(keyHex, 'hex');
  const buf = Buffer.from(encoded, 'base64url');
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext, undefined, 'utf8') + decipher.final('utf8');
}

/**
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<Record<string, unknown>>}
 */
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  // Reject non-HTTPS in production (Vercel sets x-forwarded-proto)
  const proto = req.headers['x-forwarded-proto'];
  if (proto && proto !== 'https') {
    return res.status(403).json({ ok: false, error: 'HTTPS required' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey) {
    return serverError(res, 'ENCRYPTION_KEY environment variable is not set');
  }

  const body = await parseBody(req);
  const { payload } = body;
  if (!payload || typeof payload !== 'string') {
    return badRequest(res, 'Missing required field: payload');
  }

  let credentials;
  try {
    credentials = JSON.parse(decrypt(payload, encryptionKey));
  } catch {
    return badRequest(res, 'Invalid payload — decryption failed');
  }

  const { username, password, pin, vin, region } = credentials;
  const missingFields = ['username', 'password', 'pin', 'vin', 'region'].filter((k) => !credentials[k]);
  if (missingFields.length > 0) {
    return badRequest(res, `Payload missing required fields: ${missingFields.join(', ')}`);
  }

  let client;
  try {
    client = new BlueLinky({ username, password, pin, region, brand: 'hyundai' });

    await new Promise((resolve, reject) => {
      client.on('ready', resolve);
      client.on('error', (/** @type {unknown} */ err) => reject(err ?? new Error('Unknown BlueLinky error')));
    });
  } catch (err) {
    console.error('BlueLinky login failed:', err?.message ?? err);
    return serverError(res, 'Failed to authenticate with Bluelink');
  }

  let vehicle;
  try {
    vehicle = await client.getVehicle(vin);
    if (!vehicle) {
      return badRequest(res, `No vehicle found for VIN: ${vin}`);
    }
  } catch (err) {
    console.error('Failed to get vehicle:', err.message);
    return serverError(res, 'Failed to retrieve vehicle');
  }

  // Check vehicle status before locking
  let status;
  try {
    status = await vehicle.status({ refresh: true, parsed: true });
  } catch (err) {
    console.error('Failed to get vehicle status:', err.message);
    return serverError(res, 'Failed to retrieve vehicle status');
  }

  const engineOn = status?.engine?.running ?? false;

  if (engineOn) {
    console.log('Engine is running — skipping lock');
    return res.status(200).json({
      ok: true,
      locked: false,
      reason: 'Engine is running — lock skipped for safety',
    });
  }

  // Engine is off — lock the doors
  try {
    await vehicle.lock();
    console.log('Doors locked successfully');
    return res.status(200).json({ ok: true, locked: true });
  } catch (err) {
    console.error('Lock command failed:', err.message);
    return serverError(res, 'Lock command failed');
  }
}
