/**
 * The block test as a SQL fragment, in a module of its own.
 *
 * It lives apart from server/blocks.ts — which holds the routes, and therefore
 * pulls in the auth middleware, which pulls in storage — because the read
 * paths that need this fragment are *inside* storage. Importing the routes
 * module from storage would close that loop, and a cycle whose modules
 * evaluate in the wrong order fails as an undefined import at startup rather
 * than as a type error. This file imports nothing but the schema, so nothing
 * can be caught in a cycle through it.
 */
import { sql } from "drizzle-orm";
import { userBlocks } from "@shared/schema";

/**
 * "This column is not somebody the viewer is cut off from" — a block made by
 * the viewer or against them. Written as `not exists` so it stays sargable
 * against `user_blocks (blocker_id, blocked_id)` and its mirror index, and so
 * it composes into an existing `where` without a join that would multiply rows.
 */
export function notBlockedSql(viewerId: string, column: any) {
  return sql`not exists (
    select 1 from ${userBlocks} ub
    where (ub.blocker_id = ${viewerId} and ub.blocked_id = ${column})
       or (ub.blocked_id = ${viewerId} and ub.blocker_id = ${column})
  )`;
}
