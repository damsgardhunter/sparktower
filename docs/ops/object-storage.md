# Uploads: the bucket, and getting it right on Render

Every avatar, cover photo, project logo, post image, artifact and merch render
goes through object storage. This is how to set it up off Replit.

The symptom that brings people here:

```
[surfaces] uploads is off: PRIVATE_OBJECT_DIR is not set, so there is no bucket
to write to. Set it and deploy again.
```

That is the **Uploads** surface switching itself off at boot, on purpose.
Production refuses to fall back to the container's disk, because a Render
container's disk is wiped on every deploy and uploads written there would
disappear silently — the kind of data loss nobody notices for a month. So the
feature goes off loudly instead, and `/admin/surfaces` shows the reason.

## What you need, in total

Two environment variables and one thing that is not an environment variable:

| | |
|---|---|
| `PRIVATE_OBJECT_DIR` | `/<bucket>/<prefix>`, e.g. `/sparktower-uploads/uploads` |
| `GCS_SERVICE_ACCOUNT_KEY` | the whole service-account JSON key, or that base64-encoded |
| **CORS on the bucket** | not an env var, and the step most likely to be missed — see below |

You do **not** need `PUBLIC_OBJECT_SEARCH_PATHS`. Its error message tells you to
set it and mentions Replit's Object Storage tool; nothing reads it. The only
function that did, `searchPublicObject`, has no callers.

You do **not** need `GOOGLE_CLOUD_PROJECT`, and setting it *without*
`GCS_SERVICE_ACCOUNT_KEY` actively hurts: it selects application-default
credentials, which on Render do not exist, and the resulting auth error says
nothing about the variable that caused it.

Storage is Google Cloud Storage. The client is `@google-cloud/storage`, so an
S3-compatible bucket — Cloudflare R2, Backblaze, S3 itself — will not work
without real code changes. Use GCS.

## 1. Make the bucket

```sh
gcloud auth login
gcloud config set project YOUR_PROJECT_ID

# Pick a region near your Render region. Uniform access, not per-object ACLs:
# the app stores its own ACL in object metadata and does not use GCS ACLs.
gcloud storage buckets create gs://sparktower-uploads \
  --location=us-central1 \
  --uniform-bucket-level-access
```

Keep the bucket **private**. Objects are served through this app's
`GET /objects/...` route, which checks the stored ACL policy before streaming
them. Making the bucket public would bypass that check entirely.

## 2. Make a service account and get its key

```sh
gcloud iam service-accounts create sparktower-uploads \
  --display-name="SparkTower uploads"

# On the bucket, not the project — this account has no business anywhere else.
gcloud storage buckets add-iam-policy-binding gs://sparktower-uploads \
  --member="serviceAccount:sparktower-uploads@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"

gcloud iam service-accounts keys create key.json \
  --iam-account="sparktower-uploads@YOUR_PROJECT_ID.iam.gserviceaccount.com"
```

`roles/storage.objectAdmin` is the right role and the minimum that works. It
covers all four things the app does: write an object, read it, write its
metadata (which is where the ACL policy lives), and delete it for a takedown.
`objectViewer` or `objectCreator` alone will each fail on one of those.

> `storage.objectAdmin` does not include `storage.buckets.get`, so the CORS check
> in step 5 will report that it couldn't run. That is expected and fine — add
> `roles/storage.legacyBucketReader` if you want the check to work.

## 3. Set the variables on Render

Render dashboard → your service → **Environment**.

```
PRIVATE_OBJECT_DIR = /sparktower-uploads/uploads
GCS_SERVICE_ACCOUNT_KEY = <contents of key.json>
```

**Base64-encode the key.** The code accepts raw JSON or base64, and base64 is
strongly preferred, because a multi-line JSON key pasted into a web form usually
arrives with its newlines mangled — which surfaces much later as
`error:1E08010C:DECODER routines::unsupported`, an OpenSSL message that says
nothing about where it came from.

```sh
base64 -i key.json | tr -d '\n'      # macOS
base64 -w0 key.json                  # Linux
```

Then delete `key.json` from your machine. It is a credential with write access
to everything your users upload.

## 4. CORS — the step that is always missed

The browser uploads **directly to `storage.googleapis.com`**, not through this
server. The server's only job is to hand over a signed URL; the PUT that follows
is cross-origin, so Google has to be told to allow it.

Nothing on the server can detect this being wrong. The server's work finished
when it issued the URL, Google refuses the preflight before any request reaches
you, and the only evidence is a CORS error in one user's browser console. A
perfectly configured bucket with no CORS rules looks completely healthy from
here and cannot be uploaded to.

`cors.json`:

```json
[
  {
    "origin": ["https://your-real-domain.com"],
    "method": ["GET", "PUT", "HEAD"],
    "responseHeader": ["Content-Type", "Content-Length"],
    "maxAgeSeconds": 3600
  }
]
```

```sh
gcloud storage buckets update gs://sparktower-uploads --cors-file=cors.json
```

Notes:

- `origin` must list every origin people actually load the app from — your
  custom domain **and** the `onrender.com` host if that is still reachable, and
  `http://localhost:5001` if you want local development to use the real bucket.
  It is matched exactly: no wildcards within a host, and the scheme counts.
- `PUT` is the one that matters. `GET` is only needed if a browser ever fetches
  a signed URL directly rather than going through `/objects/...`.
- `Content-Type` must be in `responseHeader`, because the uploader sends that
  header and a preflight that doesn't allow it is refused.

## 5. Prove it before you deploy

```sh
PUBLIC_URL=https://your-real-domain.com \
PRIVATE_OBJECT_DIR=/sparktower-uploads/uploads \
GCS_SERVICE_ACCOUNT_KEY="$(base64 -i key.json | tr -d '\n')" \
npx tsx script/verify-object-storage.ts
```

It walks the same path a real upload takes — which credential mode was chosen,
whether the bucket is reachable, write, V4 signing, read back through a signed
URL, object metadata, bucket CORS — and then deletes its test object, which is
how it checks delete permission too. `PUBLIC_URL` is what it checks the CORS
origins against, so pass it.

Exit code is 1 if anything failed, so it works in a release script.

## 6. Deploy, and read the boot log

The variables are read at boot, not stored as a decision, so a deploy is all it
takes. The log says which credentials were resolved:

```
[storage] bucket /sparktower-uploads/uploads via service-account credentials
```

`via replit-sidecar` on Render means `GCS_SERVICE_ACCOUNT_KEY` did not arrive —
the sidecar lives on `127.0.0.1:1106` and only exists inside Replit.

Then upload something. A profile photo through **Edit Profile → Profile photo**
exercises the whole path: presigned URL, cross-origin PUT, ACL write, and the
read back through `GET /objects/...`.

## Troubleshooting

| What you see | What it is |
|---|---|
| `uploads is off: PRIVATE_OBJECT_DIR is not set` | The variable isn't on the service. Deploys don't carry it over from a different service or environment group. |
| `error:1E08010C:DECODER routines::unsupported` | The private key's newlines were mangled on paste. Base64-encode it. |
| CORS error in the browser console, nothing in the server log | Step 4. The bucket has no CORS rule for your origin. |
| 403 from GCS when the app writes | The service account has no role **on the bucket**. A project-level grant is not inherited by a bucket with uniform access in every configuration. |
| Signing fails, mentioning `signBlob` or `iam` | Application-default credentials have no private key to sign with. Use a service-account key, or grant `roles/iam.serviceAccountTokenCreator`. |
| Uploads work, images 404 on read | The ACL policy wasn't written. Check `setMetadata` permission — `objectViewer` can read but not annotate. |
| Everything works, old images 404 | Objects written to the previous container's disk are gone. They cannot be recovered; the records pointing at them need clearing. |

## What this does not cover

- **A CDN in front of the bucket.** Signed URLs expire, so they do not cache
  well. `GET /objects/...?w=` already serves resized derivatives through the
  app; put a CDN in front of the app rather than the bucket.
- **Lifecycle rules.** Nothing deletes orphaned objects when a project or post
  is deleted, so the bucket grows forever. Worth a lifecycle rule or a sweeper
  before it is a bill.
- **Migrating what is already there.** Anything uploaded while the local-disk
  fallback was in use lives in `local_objects/` on whatever machine wrote it,
  and the database has `/objects/uploads/...` paths pointing at it. Those files
  have to be copied into the bucket under the same names, or the records
  cleared, or they will 404 forever.
