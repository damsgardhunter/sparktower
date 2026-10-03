# Downloading what Nova draws

Everything the product generates is paid for — a logo, the cover built from it,
the five project-page visuals drawn from both, a storyboard frame, a backer badge
— and until 2026-10-02 none of it could be got off the screen. A logo you can
only look at inside the product is not much of a logo.

## How it works

One query parameter, on the URL the image is **already** served from:

```
GET /objects/uploads/<id>?download=1&as=Quill%20%26%20Co%20logo
→ Content-Disposition: attachment; filename="quill-co-logo.png"
```

Every picture in the product is a path through
[the objects route](../server/replit_integrations/object_storage/routes.ts), so
that one place covers all of them — rather than a download endpoint per surface,
each with its own auth to get wrong. A plain `GET` is untouched, which matters:
every `<img>` reads this route, and an attachment header on all of them would turn
every avatar into a save prompt.

Two details that are not obvious:

- **The extension is decided from the file, not from its name.** The content type
  is sometimes read from the first bytes rather than from metadata, so the header
  can only be set once the stream opens. A WebP saved as `.png` opens to "this
  file is corrupt", which reads as the product having sold somebody a broken file.
- **A download is always the original.** The same route resizes on `?w=`, and
  somebody saving a logo they paid for should get the file rather than a thumbnail
  that happened to be in the cache.

`as` is sanitised by `downloadName` ([server/download-name.ts](../server/download-name.ts))
down to lowercase word characters and hyphens. That is not tidiness twice over:
`Content-Disposition` is a latin-1 header and Node *refuses* to set one carrying
an em dash, answering 500 — which is how the path export's download broke on
"Quill & Co — Systemize a business". It is also the only thing between a query
parameter and a response header, so it is what stops header injection.

The storyboard route sets the header itself as well, because an early scene is
held inline as a data URL and never becomes an object at all.

## On the web

[`<DownloadImage>`](../client/src/components/download-image.tsx) is a link, not a
fetch. The browser then does the progress, the downloads shelf, the "keep" prompt
and the right-click "Save link as" — all of which are worse if reimplemented. No
`target="_blank"`: an attachment response does not navigate, so a tab would open
and sit blank for ever, which is what makes a download look broken.

## On a phone

A phone has no downloads folder, so "download" means the camera roll — that is
where people look for a picture afterwards.
[`saveImage`](../mobile/src/saveImage.ts) fetches the bytes with the session (most
of these objects are private, so the URL alone is a 404), then saves to the photo
library.

Three things it has to get right:

- **Permission is asked at the tap.** iOS allows the add-to-library dialog once.
  Asked when somebody presses "Save" it has obvious context; asked on launch it is
  dismissed and cannot be asked again.
- **A refusal still has a way out.** No to the photo library is not no to the
  file, so the share sheet is offered instead — Files, a message, a drive — and it
  needs no permission at all.
- **A failed fetch leaves nothing behind.** `downloadAsync` writes whatever came
  back, so a 404's JSON body is now a file called `logo.png` that the share sheet
  would happily offer. It is deleted when the status is not 200.

Only the *add* permission is requested (`savePhotosPermission`), and
`photosPermission` is explicitly false: nothing here reads somebody's library.

## Where the buttons are

| What | Web | Phone |
|---|---|---|
| Logo and cover | `brand-kit-card.tsx` — which now also *shows* them, having drawn them and never done so | `manage/Setup.tsx` |
| The five visuals | `profile-visuals-button.tsx`, in each tile's hover wash beside Redo, Upload and Hide | `manage/Setup.tsx`, in each tile's icon row |
| A storyboard frame | `storyboard-slideshow.tsx`, on the frame being viewed | `project/storyboards.tsx`, per scene |
| A backer badge | `badge-preview-card.tsx` | — backing setup is a desk job |
| Anything opened full screen | — | `ProjectPageTabs.tsx` lightbox |

That table is also a test: `nova-images-downloadable.test.ts` holds the list, so a
new generator has to be added to it, which is the moment to notice it needs a
download too.

## Adding one

Nothing server-side. On the web, `<DownloadImage src={path} name={...} />`, or
`downloadUrl(path, name)` when the surface wants its own control. On the phone,
`<SaveImage path={path} name={...} />`, with `iconOnly` for a row of icon actions.
Name it after the project — a file called `badge.png` is unfindable a week later.

Held by [image-download.test.ts](../test/integration/image-download.test.ts) (11),
[nova-images-downloadable.test.ts](../test/unit/nova-images-downloadable.test.ts)
(14) and [saveImage.test.ts](../mobile/src/saveImage.test.ts) (11). Fifteen
deliberate breakages were tried across the three.
