import BlueLinky from 'bluelinky';

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
  // Reject non-HTTPS in production (Vercel sets x-forwarded-proto)
  const proto = req.headers['x-forwarded-proto'];
  if (proto && proto !== 'https') {
    return res.status(403).json({ ok: false, error: 'HTTPS required' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // Token auth — accept from Authorization header (Bearer) or body token field
  const authHeader = req.headers['authorization'] ?? '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = bearerToken ?? req.body?.token;

  if (!token || token !== process.env.WEBHOOK_TOKEN) {
    return unauthorized(res);
  }

  // Credentials from request body
  const { username, password, pin, vin } = req.body ?? {};
  const region = process.env.BLUELINK_REGION;

  const missingFields = ['username', 'password', 'pin', 'vin'].filter(
    (k) => !req.body?.[k]
  );
  if (missingFields.length > 0) {
    return badRequest(res, `Missing required fields: ${missingFields.join(', ')}`);
  }

  if (!region) {
    return serverError(res, 'BLUELINK_REGION environment variable is not set');
  }

  let client;
  try {
    client = new BlueLinky({ username, password, pin, region, brand: 'hyundai' });

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
