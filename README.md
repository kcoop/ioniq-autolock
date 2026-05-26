# ioniq-autolock

A token-secured webhook that locks your Hyundai Ioniq 5's doors when triggered — designed to be called by an iOS Shortcut on CarPlay disconnect.

Bluelink credentials (username, password, PIN, VIN) are AES-256-GCM encrypted at shortcut generation time. The shortcut stores only an opaque ciphertext — plaintext credentials never leave your machine. The decryption key lives exclusively in Vercel environment variables. All requests are made over HTTPS.

## How it works

`POST /api/lock` decrypts the credentials payload using `ENCRYPTION_KEY`, authenticates with Hyundai Bluelink, checks whether the engine is running, and locks the doors if the car is powered down. If the engine is still on, the lock is skipped as a safety measure.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Push to GitHub and deploy to Vercel

Create a new GitHub repo, push this project to it, then import it at [vercel.com](https://vercel.com). Deploy without setting any environment variables for now.

### 3. Generate the shortcut and encryption key

Run the generator with your deployment URL and Bluelink credentials:

```bash
npm run generate-shortcut -- \
  --url https://your-project.vercel.app/api/lock \
  --username <bluelink_email> \
  --password <bluelink_password> \
  --pin <4_digit_pin> \
  --vin <your_vin> \
  --region <US|CA|EU>
```

This writes `ioniq-autolock.json` containing the webhook URL and encrypted payload, and prints a freshly generated `ENCRYPTION_KEY`.

### 4. Add the encryption key to Vercel

In the Vercel dashboard under **Settings → Environment Variables**, add the key printed by the generator:

| Variable | Description |
|---|---|
| `ENCRYPTION_KEY` | 64-char hex key printed by the generator |

Redeploy after saving so the new variable takes effect.

### 5. Create the iOS Shortcut manually

1. Open the **Shortcuts** app, tap **+**, and name it **ioniq-autolock**
2. Add a **Get Contents of URL** action and configure it:
   - **URL:** copy from `ioniq-autolock.json`
   - **Method:** POST
   - Tap **Show More** → **Request Body:** JSON
   - Add a key `payload` with the value copied from `ioniq-autolock.json`
3. Save the shortcut
4. Go to **Automation → New Automation → CarPlay → Disconnects**
5. Add a **Run Shortcut** action and select **ioniq-autolock**
6. Disable **Ask Before Running**

## API

### `POST /api/lock`

**Request body:**

```json
{
  "payload": "<aes-256-gcm encrypted credentials>"
}
```

The `payload` field is a base64url string produced by the shortcut generator. It decrypts to `{"username","password","pin","vin","region"}` using the server-side `ENCRYPTION_KEY`.

**Responses:**

| Status | Body | Meaning |
|---|---|---|
| `200` | `{"ok":true,"locked":true}` | Doors locked successfully |
| `200` | `{"ok":true,"locked":false,"reason":"..."}` | Lock skipped (engine running) |
| `400` | `{"ok":false,"error":"..."}` | Missing or invalid payload |
| `403` | `{"ok":false,"error":"HTTPS required"}` | Request made over plain HTTP |
| `500` | `{"ok":false,"error":"..."}` | Bluelink auth or command failure |

## Local development

Copy `.env.example` to `.env` and fill in your values, then:

```bash
npm run dev
```

This starts a local Vercel dev server at `http://localhost:3000`. The HTTPS check is bypassed locally since `x-forwarded-proto` is not set by the local dev server.
