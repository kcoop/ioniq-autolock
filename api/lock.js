import BlueLinky from 'bluelinky';

const REQUIRED_ENV = [
  'BLUELINK_USERNAME',
  'BLUELINK_PASSWORD',
  'BLUELINK_PIN',
  'BLUELINK_REGION',
  'BLUELINK_VIN',
  'WEBHOOK_TOKEN',
];

function validateEnv() {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

function unauthorized(res, message = 'Unauthorized') {
  res.status(401).json({ ok: false, error: message });
}

function badRequest(res, message) {
  res.status(400).json({ ok: false, error: message });
}

function serverError(res, message) {
  res.status(500).json({ ok: false, error: message });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // Token auth — accept from Authorization header (Bearer) or body/query token field
  const authHeader = req.headers['authorization'] ?? '';
  const bearerToken = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;
  const token = bearerToken ?? req.body?.token ?? req.query?.token;

  if (!token || token !== process.env.WEBHOOK_TOKEN) {
    return unauthorized(res);
  }

  try {
    validateEnv();
  } catch (err) {
    console.error(err.message);
    return serverError(res, err.message);
  }

  const {
    BLUELINK_USERNAME: username,
    BLUELINK_PASSWORD: password,
    BLUELINK_PIN: pin,
    BLUELINK_REGION: region,
    BLUELINK_VIN: vin,
  } = process.env;

  let client;
  try {
    client = new BlueLinky({
      username,
      password,
      pin,
      region,
      brand: 'hyundai',
    });

    await new Promise((resolve, reject) => {
      client.on('ready', resolve);
      client.on('error', reject);
    });
  } catch (err) {
    console.error('BlueLinky login failed:', err.message);
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
