# What the team owes its backers

A tier promises things. Most of them are the platform's job and are true the moment
the pledge lands — the name on the wall, the believer number, the badge, the
printable certificate. Two are not. **Early access** and a **personal video
thank-you** carry `fulfilledBy: "creator"` in [shared/backing.ts](../shared/backing.ts),
which means a person has to go and do something.

Nothing used to record whether they had. The owner's list in Settings showed what
each backer was *owed* and never what was *done*, so running a campaign properly
meant keeping a spreadsheet beside it — and the backer who paid for a video had no
way to know whether it was coming.

## Where it is

**Project → More → Backers.** Open to any member of the project, not only the owner.

That is wider than the owner-only list in Settings, and the difference is the point
rather than an oversight: recording thank-you videos is exactly the work a team
splits up. So the route behind this tab **sends no email address and no postal
address.** Nobody needs to read an address by hand — Printful is handed it
directly — and the owner's list still has both, behind its own owner-only route.

What this page does say about shipping is whether an address is *on file*, which is
the one thing somebody might have to chase.

## What it shows

Outstanding work first, then everyone else. The question the page answers is "what
do I have to do today", and a list sorted by who paid most buries the person still
waiting three weeks later behind thirty people who are owed nothing.

Per backer:

- their name, believer number, tier and what they paid, and their message
- each **creator-owed** reward: still owed, or done — with when, by which teammate,
  and whatever note went with it
- **merch**: what the tier promises, and for each order the status, the date it went
  to the printer, a tracking link, and the printer's own error if it failed
- a flag when a shipping reward has **no address on file**

A backer who is anonymous on the public wall is **named here, and marked as such**.
Anonymity governs the public listing, not whether the person recording a personal
video knows who it is for; the owner's existing list makes the same call.

## Which pledges count

`held`, `released` and `converted` — the three [server/platform-revenue.ts](../server/platform-revenue.ts)
uses for "the money was actually taken". A refunded backer is owed nothing, and a
pending or failed one never paid. Showing them would have a team recording videos
for people who did not back them.

## Sending a video

Upload the file; a line of text can go with it. An upload rather than an in-browser
recorder, because the camera API is a different feature with its own permissions and
failure modes, and somebody recording a thank-you will do it on their phone and
have a file.

**Marking it done with no file is allowed on purpose.** Plenty of people will send
the video another way and still want the list to be true.

The backer is told either way, and that is the point: nothing else in the product
changes visibly when a creator does the thing they promised, so a delivery nobody
is notified about is a file in a bucket. The notification is `reward_delivered`, and
it pushes to a phone — they paid for this and have no other way to find out.

The video is served through a route that checks who is asking: the backer it was
made for, or the team. A link that works for anybody holding it is not a personal
thank-you, it is a file.

## What the backer sees

On their own profile, under "Believed in": each delivered reward, the creator's
note, and the video playing in place with a way to keep a copy. Only on their own
profile — somebody else's personal video is nobody else's business.

## The guards, each of which is a way this goes wrong

| Refused | Because |
|---|---|
| A reward the tier never promised | A mis-click would notify somebody about a reward they did not buy |
| A platform-fulfilled reward | It would be an item on a to-do list that can never be ticked |
| A pledge that is not standing | Recording a video for somebody who got their money back |
| A second press of the same button | One promise, one row, one notification |
| An `assetPath` that is not an uploaded file | The only place a caller names a file |
| A stranger, with a 404 | So a project id is not confirmable |

Undo exists because somebody will tick the wrong person. The notification already
sent is left alone: it said something true at the time, and silently unsaying it is
worse than a note about a video being re-recorded.

## Still to do

**The phone has none of this.** The tab is in the web manager; the phone's manage
surface would need the same list and the same upload, and video upload from a phone
is the half that most wants to be there — that is where the video will be recorded.

Held by [backer-fulfilment.test.ts](../test/integration/backer-fulfilment.test.ts)
(22) and [backers-tab-wiring.test.ts](../test/unit/backers-tab-wiring.test.ts) (13).
Fourteen deliberate breakages were tried across the two.
