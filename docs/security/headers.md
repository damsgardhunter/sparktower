# Security headers and the Content Security Policy

`server/security-headers.ts`, mounted first in `server/app.ts`, so every response carries them — pages, the API, health checks, errors.

| Header | Value | Why |
|---|---|---|
| `Content-Security-Policy` | see below; **enforced in production**, report-only in development (enforced with `CSP_ENFORCE=1`, which the browser tests set) | limits what an injected script could load or do |
| `X-Frame-Options` | `DENY` | clickjacking, for browsers that predate `frame-ancestors` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` — **production only**, no `preload` | https only after the first visit; `preload` is a one-way decision to make on purpose |
| `X-Content-Type-Options` | `nosniff` | a served file is only ever what its type says |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | not `no-referrer`: YouTube refuses to play embeds that send no referrer |
| `Cross-Origin-Opener-Policy` | `same-origin` | OAuth and Stripe checkout are redirects, not popups, so nothing needs the opener |
| `Cross-Origin-Resource-Policy` | `same-site` | our images stay usable by the mobile app and link previews |
| `X-Powered-By` | removed | |

## The policy

| Directive | Allows | For |
|---|---|---|
| `default-src` | `'self'` | |
| `script-src` | `'self'`, `https://www.youtube.com` | YouTube's IFrame Player API (promotion videos). **No inline or eval'd script in production** — the built `index.html` loads one external module |
| `style-src` | `'self'`, `'unsafe-inline'`, Google Fonts CSS | the UI library sets style attributes; the chart writes a `<style>` |
| `font-src` | `'self'`, `data:`, `fonts.gstatic.com` | |
| `img-src` | `'self'`, `data:`, `blob:`, `https:` | avatars, project logos, video thumbnails, admin-set promotion logos |
| `media-src` | `'self'`, `blob:`, `https:` | uploaded promotion videos |
| `connect-src` | `'self'`, `storage.googleapis.com` | direct uploads to presigned URLs |
| `frame-src` | `youtube-nocookie.com`, `youtube.com`, `player.vimeo.com` | promotion videos |
| `frame-ancestors` | `'none'` | no site can frame SparkTower |
| `object-src` | `'none'` | |
| `base-uri`, `form-action` | `'self'` | |
| `upgrade-insecure-requests` | production | |

Development adds `'unsafe-inline' 'unsafe-eval'` to scripts and `ws: wss:` to connections, for Vite's refresh preamble and hot reload.

A served promotion logo (`/api/promotions/:id/logo`) overrides this with its own `default-src 'none'; sandbox`.

## Adding a third party

Add its host to `CSP_SOURCES` in `server/security-headers.ts`, with a comment saying what uses it. The browser tests run with the policy enforced, and `e2e/security-headers.spec.ts` fails on any violation while loading the home feed (with a YouTube promotion playing), the project manager, a public artifact page, an invite screen and the admin console — so a new host that isn't listed breaks a test before it breaks production.

## Tests

- `test/unit/security-headers.test.ts` — the production and development policies, and the headers each sends
- `test/integration/auth-hardening.test.ts` — every response of the real app carries them
- `e2e/security-headers.spec.ts` — the real pages under the enforced policy, no violations; framing refused
