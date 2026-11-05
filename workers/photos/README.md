# StormShield photo storage (Cloudflare R2)

New job photos can be stored in Cloudflare R2 instead of Supabase Storage.
R2's free tier includes 10 GB of storage, 1 million uploads and 10 million
views a month, and viewing/downloading photos is always free.

**Until this is set up, nothing changes:** the CRM keeps saving photos to
Supabase like it does today. Older photos stay in Supabase either way.

## How it fits together

```
Phone (CRM)  ──upload──▶  this worker  ──▶  R2 bucket "stormshield-photos" (private)
             ◀─signed link─┘   │
                               └─ asks Supabase: is this person logged in, and can they open this job?
Share page (photos.html) ──▶ Supabase edge function "photo-share" ──▶ signed links to the same photos
```

- The bucket is private. Photos are only reachable through links signed with
  `URL_SIGNING_SECRET`, which expire (7 days in the CRM, 1 day on share pages;
  both re-sign automatically).
- The worker applies the CRM's own job permissions (`public.can_access_job`).

## One-time setup (~15 minutes)

### 1. Cloudflare account and bucket
1. Sign up at <https://dash.cloudflare.com> (free).
2. Left menu → **R2 Object Storage** → turn it on. Cloudflare asks for a card;
   you are not charged while inside the free limits.
3. **Create bucket** → name it `stormshield-photos` → location Automatic → Create.

### 2. Deploy the worker
On a computer with Node.js:

```sh
cd workers/photos
npx wrangler login                       # opens the browser to approve
npx wrangler secret put URL_SIGNING_SECRET
#   paste a long random value, e.g. from:  openssl rand -hex 32
#   (save it — step 3 needs the same value)
npx wrangler deploy
```

`deploy` prints the worker's address, like
`https://stormshield-photos.<your-name>.workers.dev`. Opening it should show
`{"ok":true,"service":"stormshield-photos"}`.

### 3. Let share links reach R2 photos
In Supabase → Edge Functions → Secrets, add:

| Name | Value |
|---|---|
| `PHOTO_WORKER_URL` | the worker address from step 2 |
| `PHOTO_URL_SECRET` | the same value as `URL_SIGNING_SECRET` |

### 4. Turn it on in the CRM
In `crm-photos.js`, set:

```js
const PHOTO_WORKER_URL = 'https://stormshield-photos.<your-name>.workers.dev';
```

Commit, and new photos go to R2 from then on.

## Tests

```sh
node workers/photos/sign.test.mjs
node workers/photos/worker.test.mjs
```
