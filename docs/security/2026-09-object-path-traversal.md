# Object paths could climb out of their folder (September 2026)

**What was wrong.** `getObjectEntityFile` in `server/replit_integrations/object_storage/objectStorage.ts` took the request path, stripped the leading `/objects/` segment, and joined the rest onto the storage root. The router hands that path over undecoded and unnormalised, so `..` segments were the caller's to send: `GET /objects/../<name>` resolved to a file beside the uploads folder, and was then served. Locally that is another user's uploads or anything next to `LOCAL_OBJECT_ROOT`; in production the same value was concatenated onto the bucket prefix, reaching objects outside it.

**Who could do it.** Anyone who could reach the route. Objects with no ACL policy are served to anyone, signed in or not, so no account was needed.

**What changed.**
- The path is rejected where it is built: any empty, `.` or `..` segment is refused before either backend sees it.
- For local storage the path is resolved and refused unless `path.relative(root, resolved)` stays inside the root — so however the segments are spelled, the file has to be under the root.
- `test/integration/uploads.test.ts` walks out of the root four ways, through the service and through the route, and checks the contents of a file placed beside the root are never returned. It fails against the old code (it resolved to that file) and passes against the new.

**The check that would have caught it.** `path-traversal` in `shared/security-checks.ts`: a file path built from a non-literal value in a file that reads request values, with no containment (a resolve-and-compare, a `basename`, or a strict id shape) in the same file. It is judged per file on purpose — a guard somewhere else in the repository does not protect this path. The first version of the check missed this hole twice: it only looked for `req.` inside the same call (the value arrived through a parameter), and it accepted any `.startsWith(` on something whose name merely contained "base". Both were tightened, with tests.

**Standing rule.** Where a path is built from anything a caller supplies, contain it in that same function — resolve and compare against the root, or accept only `^[A-Za-z0-9_-]+$` and build the path yourself.
