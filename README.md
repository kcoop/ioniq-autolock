# ioniq-autolock

A token-secured webhook that locks your Hyundai Ioniq 5's doors when triggered — designed to be called by an iOS Shortcut on CarPlay disconnect.

Bluelink credentials (username, password, PIN, VIN) are AES-256-GCM encrypted at shortcut generation time. The shortcut stores only an opaque ciphertext — plaintext credentials never leave your machine. The decryption key lives exclusively in Vercel environment variables. All requests are made over HTTPS.

## How it works

`POST /api/lock` validates the bearer token, decrypts the credentials payload using `ENCRYPTION_KEY`, then authenticates with Hyundai Bluelink, checks whether the engine is running, and locks the doors if the car is powered down. If the engine is still on, the lock is skipped as a safety measure.

## Deploy to Vercel

### 1. Install dependencies

```bash
npm install
```

### 2. Push to GitHub

Create a new GitHub repo and push this project to it.

### 3. Import to Vercel

Go to [vercel.com](https://vercel.com), import your GitHub repo, and deploy.

### 4. Set environment variables

In the Vercel dashboard under **Settings → Environment Variables**, add:

| Variable | Description |
|---|---|
| `ENCRYPTION_KEY` | 64-char hex key used to decrypt the credentials payload |

Generate the key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Or omit `--encryption-key` when running the shortcut generator — it will create one and print it for you.

## iOS Shortcut setup

### Option A — generate the shortcut file (recommended)

Run the generator script with your deployment URL and credentials:

```bash
npm run generate-shortcut -- \
  --url https://your-project.vercel.app/api/lock \
  --encryption-key <64_char_hex_key> \
  --username <bluelink_email> \
  --password <bluelink_password> \
  --pin <4_digit_pin> \
  --vin <your_vin> \
  --region <US|CA|EU> \
  --output ioniq-autolock.shortcut
```

Omit `--encryption-key` to have one generated automatically — it will be printed at the end; add it to Vercel as `ENCRYPTION_KEY` before using the shortcut.

This writes `ioniq-autolock.shortcut` to the project root (binary plist on macOS, XML plist otherwise — both are importable). The file contains only an opaque encrypted blob — no plaintext credentials. Then:

1. AirDrop the file to your iPhone, or add it to iCloud Drive and open it from there
2. Tap **Add Shortcut** when prompted
3. Go to **Automation → New Automation → CarPlay → Disconnects**
4. Add a **Run Shortcut** action and select **ioniq-autolock**
5. Disable **Ask Before Running**

> If iOS blocks the import, go to **Settings → Shortcuts → Allow Untrusted Shortcuts** and enable it.

### Option B — build it manually

1. Open the **Shortcuts** app and go to **Automation**
2. Create a new **Personal Automation** triggered by **CarPlay** → **Disconnects**
3. Add a **Get Contents of URL** action with:
   - **URL:** `https://your-project.vercel.app/api/lock`
   - **Method:** `POST`
   - **Request Body:** JSON with the following fields:
     ```json
     {
       "payload": "<encrypted blob from the generator>"
     }
     ```
4. Disable **Ask Before Running** so it fires automatically

> The shortcut communicates over HTTPS, so the payload is encrypted in transit and your credentials are never stored on the server.

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
