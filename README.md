# ioniq-autolock

A token-secured webhook that locks your Hyundai Ioniq 5's doors when triggered — designed to be called by an iOS Shortcut on CarPlay disconnect.

Bluelink credentials (username, password, PIN, VIN) are sent in the POST body rather than stored on the server. All requests must be made over HTTPS so the payload is encrypted in transit.

## How it works

`POST /api/lock` validates the bearer token, then uses the credentials from the request body to authenticate with Hyundai Bluelink, check whether the engine is running, and lock the doors if the car is powered down. If the engine is still on, the lock is skipped as a safety measure.

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
| `BLUELINK_REGION` | `US`, `CA`, or `EU` |
| `WEBHOOK_TOKEN` | A secret token you generate (see below) |

Generate a secure webhook token:

```bash
openssl rand -hex 32
```

## iOS Shortcut setup

### Option A — generate the shortcut file (recommended)

Run the generator script with your deployment URL and credentials:

```bash
npm run generate-shortcut -- \
  --url https://your-project.vercel.app/api/lock \
  --token <webhook_token> \
  --username <bluelink_email> \
  --password <bluelink_password> \
  --pin <4_digit_pin> \
  --vin <your_vin> \
  --output ioniq-autolock.shortcut
```

This writes `ioniq-autolock.shortcut` to the project root (binary plist on macOS, XML plist otherwise — both are importable). Then:

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
       "token": "<your_webhook_token>",
       "username": "<bluelink_email>",
       "password": "<bluelink_password>",
       "pin": "<4_digit_pin>",
       "vin": "<your_vin>"
     }
     ```
4. Disable **Ask Before Running** so it fires automatically

> The shortcut communicates over HTTPS, so the payload is encrypted in transit and your credentials are never stored on the server.

## API

### `POST /api/lock`

**Authentication:** Bearer token in the `Authorization` header, or a `token` field in the JSON body.

```
Authorization: Bearer <your_webhook_token>
```

**Request body:**

```json
{
  "token": "<webhook_token>",
  "username": "<bluelink_email>",
  "password": "<bluelink_password>",
  "pin": "<4_digit_pin>",
  "vin": "<vehicle_vin>"
}
```

**Responses:**

| Status | Body | Meaning |
|---|---|---|
| `200` | `{"ok":true,"locked":true}` | Doors locked successfully |
| `200` | `{"ok":true,"locked":false,"reason":"..."}` | Lock skipped (engine running) |
| `400` | `{"ok":false,"error":"..."}` | Missing required fields |
| `401` | `{"ok":false,"error":"Unauthorized"}` | Invalid or missing token |
| `403` | `{"ok":false,"error":"HTTPS required"}` | Request made over plain HTTP |
| `500` | `{"ok":false,"error":"..."}` | Bluelink auth or command failure |

## Local development

Copy `.env.example` to `.env` and fill in your values, then:

```bash
npm run dev
```

This starts a local Vercel dev server at `http://localhost:3000`. The HTTPS check is bypassed locally since `x-forwarded-proto` is not set by the local dev server.
