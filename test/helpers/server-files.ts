/**
 * The server's source files, as they are on disk right now.
 *
 * Several tests read the server's source to check a property of every route —
 * that each write is rate-limited, that each one reaching another person is
 * behind email verification, that each free AI route is held to the burst
 * limit. They used `git ls-files server` to find the files, which gets two
 * things wrong at once:
 *
 *   - it lists files that have been deleted but not yet committed, so a test
 *     crashed with ENOENT on a file that no longer exists; and
 *   - it leaves out files that are new and not yet added — which meant a new
 *     route file was checked by none of these tests until somebody committed
 *     it. The half-hour game's routes went unchecked for exactly that reason:
 *     every one of these tests passed without ever reading them.
 *
 * A test about what the server does has to read what the server is, so this
 * walks the directory instead. (A test about what is *committed* — the secret
 * scan — is the opposite case, and rightly still asks git.)
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : path.endsWith(".ts") ? [path] : [];
  });
}

/** Every `.ts` file under `server/`. */
export const serverSourcePaths = (): string[] => walk("server");

/** The same, with each file's contents. */
export const serverSourceFiles = (): { path: string; content: string }[] =>
  serverSourcePaths().map((path) => ({ path, content: readFileSync(path, "utf8") }));
