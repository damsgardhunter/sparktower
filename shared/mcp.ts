/**
 * The tools Nova exposes to an editor-side agent, and the HTTP call behind each.
 *
 * The division of labour this encodes is the whole point of the bridge:
 *
 *  - **Nova owns the plan, the path, the artifacts and the verification.** It
 *    knows which milestone is next, what "done" means for it, what evidence
 *    that tier demands, and whether the evidence it was handed is good enough.
 *  - **The editor-side agent owns the reading and the editing.** It has the
 *    working tree, the language server, the test runner and the user's
 *    approval prompts. It is the only thing here that touches a file.
 *
 * So no tool returns file contents to be written verbatim, and no tool accepts
 * a diff to apply. Nova hands back specifications and verdicts; the agent hands
 * back evidence. Making the server do the editing would be the weak version —
 * it would be working from a stale, partial copy of a tree the agent is
 * already sitting in, and it would have to reimplement everything an editor
 * agent already does well.
 *
 * The catalogue lives here, shared, for the same reason `nova-surfaces.ts`
 * does: the description an editor agent reads and the endpoint that answers it
 * cannot drift apart. It is also served over HTTP (`GET /api/mcp/manifest`),
 * so the npm shim is a transport and a new Nova tool ships with a deploy
 * rather than a release.
 */

/** A JSON Schema object, as MCP wants it. Loose on purpose — this is a wire format. */
export interface JsonSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface NovaMcpTool {
  /** The name the editor agent calls. Stable: renaming one breaks saved prompts. */
  name: string;
  title: string;
  /**
   * Written for the agent, not the user. It says what the tool answers, and
   * where the boundary is — several of these exist mainly to stop an agent
   * inventing a plan Nova already has.
   */
  description: string;
  /** Writes nothing on the Nova side. Surfaced as an MCP annotation. */
  readOnly: boolean;
  /** Spends credits, so the agent shouldn't call it speculatively. */
  costly?: boolean;
  inputSchema: JsonSchema;
  /**
   * The `files` argument is filled by the shim from the local working tree,
   * not by the model. A repository cannot travel through a tool call an agent
   * writes by hand, and it shouldn't: reading the disk is the editor side's
   * job. The shim hides `files` from the schema it advertises and offers
   * `root` instead.
   */
  collectsFiles?: boolean;
  call: {
    method: "GET" | "POST" | "DELETE";
    /** `:name` segments are filled from the arguments; the rest become query or body. */
    path: string;
  };
}

const projectId = {
  projectId: { type: "string", description: "The SparkTower project id. Call nova_projects if you don't have one." },
} as const;

/**
 * A file as the editor-side agent reports it.
 *
 * Content is optional: for `nova_submit` the path and the summary are usually
 * enough, and shipping the whole tree to describe three edits is waste. For
 * `nova_verify` and `nova_audit` content is what the digest reads, and its
 * absence is why a verifier can't see something.
 */
const FILE_ITEM = {
  type: "object",
  properties: {
    path: { type: "string", description: "Repository-relative path, forward slashes." },
    content: { type: "string", description: "The file's text. Omit for binaries, generated output, and anything outside the change." },
  },
  required: ["path"],
} as const;

/** Ceilings the shim applies before it sends, so a repo push fails locally rather than at the edge. */
export const MCP_SNAPSHOT_LIMITS = {
  /** Files in one snapshot. Matches the audit ingest's own ceiling. */
  maxFiles: 4000,
  maxFileBytes: 512 * 1024,
  /** Total characters of content in one request body. */
  maxTotalBytes: 12 * 1024 * 1024,
} as const;

export const NOVA_MCP_TOOLS: NovaMcpTool[] = [
  {
    name: "nova_projects",
    title: "List projects",
    description:
      "The projects this token can see, with the path each one is on and how far along it is. " +
      "Call this once at the start of a session to resolve a project id, then keep it.",
    readOnly: true,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    call: { method: "GET", path: "/api/mcp/projects" },
  },

  {
    name: "nova_status",
    title: "Where the project is",
    description:
      "Nova's answer to 'where am I': the current phase, the next milestone, who acts on it, what counts as done, " +
      "the projected date, and the id of the task to work on. " +
      "Read this before proposing any plan of your own — Nova already has the plan, and a second one competing with it is worse than none. " +
      "If `actor` is `user-does`, the step is human-only: say so and stop, don't do it for them.",
    readOnly: true,
    inputSchema: { type: "object", properties: { ...projectId }, required: ["projectId"], additionalProperties: false },
    call: { method: "GET", path: "/api/mcp/projects/:projectId/status" },
  },

  {
    name: "nova_phases",
    title: "The whole path",
    description:
      "Every phase and every milestone, with the state of each. Bigger than nova_status and rarely what you want — " +
      "use nova_status for the next step, and this only when someone asks to see the whole plan.",
    readOnly: true,
    inputSchema: { type: "object", properties: { ...projectId }, required: ["projectId"], additionalProperties: false },
    call: { method: "GET", path: "/api/mcp/projects/:projectId/phases" },
  },

  {
    name: "nova_milestone",
    title: "One milestone in full",
    description:
      "A single milestone: its authored description, its actor, its verification tier, the answer written under it so far, " +
      "and its steps. Use it when nova_status names a milestone you need the detail of.",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: { ...projectId, backboneId: { type: "string", description: 'A backbone id such as "SHIP.M2.4", from nova_status.' } },
      required: ["projectId", "backboneId"],
      additionalProperties: false,
    },
    call: { method: "GET", path: "/api/mcp/projects/:projectId/milestones/:backboneId" },
  },

  {
    name: "nova_loops",
    title: "The product's loops",
    description:
      "The loops this product runs on — the sequences someone actually repeats — and how far each has got. " +
      "`state` says which: `unwritten` (a name and nothing else), `written` (the sequence is described), then `planned`, `building`, `built` once it has steps. " +
      "Also returns `rejected`: titles the builder has already said aren't loops. Never propose one of those again, in any wording. " +
      "Read this before doing anything with the core-loop milestone — those loops are what it's asking for.",
    readOnly: true,
    inputSchema: { type: "object", properties: { ...projectId }, required: ["projectId"], additionalProperties: false },
    call: { method: "GET", path: "/api/mcp/projects/:projectId/loops" },
  },

  {
    name: "nova_add_loop",
    title: "Add a loop",
    description:
      "Record another loop under the core-loop milestone. Six is the cap — a month's work doesn't hold more. " +
      "A loop is a sequence the same person repeats and gets something from each time, not a feature and not a one-off. " +
      "Propose it to the builder in their own product's words and let them confirm; a path full of loops nobody chose is worse than an empty one.",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        ...projectId,
        title: { type: "string", description: "Short name, in the product's own words — \"Explore\", \"Weekly check-in\"." },
        description: { type: "string", description: "The 3–5 step sequence, written out: open X → see Y → do Z → come back." },
        sourceId: { type: "string", description: "The milestone the loops hang off. Defaults to this path's core-loop milestone." },
      },
      required: ["projectId", "title"],
      additionalProperties: false,
    },
    call: { method: "POST", path: "/api/mcp/projects/:projectId/loops" },
  },

  {
    name: "nova_drop_loop",
    title: "Not a loop",
    description:
      "Remove a loop the builder says isn't one. The title is remembered, so nothing proposes it again under different words. " +
      "Unfinished steps under it go too; finished ones stay on the board as work that happened. " +
      "Only when the person says so — this is their judgement about their own product, not yours.",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: { ...projectId, taskId: { type: "string", description: "The loop's task id, from nova_loops." } },
      required: ["projectId", "taskId"],
      additionalProperties: false,
    },
    call: { method: "DELETE", path: "/api/mcp/projects/:projectId/loops/:taskId" },
  },

  {
    name: "nova_loop_steps",
    title: "Break a loop into steps",
    description:
      "Turn one loop into the ordered steps that build it. Costs credits. " +
      "A loop with nothing written under it has nothing to expand from: the call comes back `artifact_missing`, and `draft: true` has Nova write the sequence from the project and hand it back — a draft, not a decision. " +
      "Show that draft to the person, then send their edited version as `artifact` to make the steps. " +
      "Each step then works like any other task: nova_work for the packet, then build it.",
    readOnly: false,
    costly: true,
    inputSchema: {
      type: "object",
      properties: {
        ...projectId,
        taskId: { type: "string", description: "The loop's task id, from nova_loops." },
        artifact: { type: "string", description: "The loop's sequence, as the builder confirmed it. Lands on the loop and becomes what the steps are built from." },
        draft: { type: "boolean", description: "With nothing written yet: have Nova draft the sequence instead of refusing." },
      },
      required: ["projectId", "taskId"],
      additionalProperties: false,
    },
    call: { method: "POST", path: "/api/mcp/projects/:projectId/loops/:taskId/steps" },
  },

  {
    name: "nova_work",
    title: "Get the build packet",
    description:
      "Nova works the next task and hands back a packet: what to build, the constraints, and the evidence it will want back. " +
      "This is the specification you implement — you write the code, Nova never does. " +
      "Costs credits and calls a model, so call it for the task you're about to do, not to browse. " +
      "If the task already has a packet, nova_status returns it and you don't need this.",
    readOnly: false,
    costly: true,
    inputSchema: {
      type: "object",
      properties: {
        ...projectId,
        taskId: { type: "string", description: "The task to work. Defaults to the next one on the path (`workTaskId` from nova_status)." },
      },
      required: ["projectId"],
      additionalProperties: false,
    },
    call: { method: "POST", path: "/api/mcp/projects/:projectId/work" },
  },

  {
    name: "nova_read_work",
    title: "Read the packet on a task",
    description:
      "The packet already produced for a task, if there is one, plus the task's actor and tier. Free — it pays for nothing and produces nothing. " +
      "Use it to re-read a packet rather than calling nova_work again, which would charge for a second one.",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: { ...projectId, taskId: { type: "string", description: "The task, from nova_status." } },
      required: ["projectId", "taskId"],
      additionalProperties: false,
    },
    call: { method: "GET", path: "/api/mcp/projects/:projectId/work/:taskId" },
  },

  {
    name: "nova_choose",
    title: "Record the answer to a packet",
    description:
      "Save the builder's answer to a packet — an option they picked, or their own text — onto the task. That answer is the artifact the rest of the path reads. " +
      "Only call this once the person has actually chosen. Picking on their behalf is how a path ends up recording decisions nobody made. " +
      "For a build packet it records what was built; whether the code works is a separate question, and nova_verify is what answers it.",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        ...projectId,
        workId: { type: "string", description: "The packet id, from nova_work or nova_read_work." },
        index: { type: "number", description: "Which option they picked, zero-based. Omit when they wrote their own." },
        text: { type: "string", description: "Their own words, which replace the option's body." },
        done: { type: "boolean", description: "Whether this closes the task. Defaults to true, as it does in the app." },
      },
      required: ["projectId", "workId"],
      additionalProperties: false,
    },
    call: { method: "POST", path: "/api/mcp/projects/:projectId/work/:workId/choose" },
  },

  {
    name: "nova_submit",
    title: "Report what you changed",
    description:
      "Hand Nova the record of an edit you made: a summary in your own words, the files you touched, and a commit if there is one. " +
      "It lands on the task as the written answer, which is what later Nova steps read. " +
      "It does NOT mark anything done — completion is Nova's call, from evidence. Call nova_verify for that. " +
      "Submit after the change works locally, not while you're still trying things.",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        ...projectId,
        taskId: { type: "string", description: "The task this work belongs to." },
        summary: { type: "string", description: "What you actually changed and why, in two or three sentences. Plain language — a person reads this." },
        files: { type: "array", items: FILE_ITEM, description: "The files you touched. Content is optional here." },
        commit: { type: "string", description: "Commit SHA, if you committed." },
        notes: { type: "string", description: "Anything Nova should know: what you deliberately left out, what you weren't sure about." },
      },
      required: ["projectId", "taskId", "summary"],
      additionalProperties: false,
    },
    call: { method: "POST", path: "/api/mcp/projects/:projectId/submit" },
  },

  {
    name: "nova_verify",
    title: "Ask Nova to verify",
    description:
      "Send the current state of the working tree and ask Nova whether it proves any milestone done. " +
      "Deterministic and free: Nova reads the code for the things it can see for itself — the scaffold, a live URL that answers, " +
      "persistence and auth, analytics wiring — and marks those with the evidence as the reason. " +
      "Milestones it can't see from the code are reported as unproven, with what's missing. It never marks something done on your say-so, " +
      "and it never un-marks anything: not seeing something is not proof it isn't there.",
    collectsFiles: true,
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        ...projectId,
        files: { type: "array", items: FILE_ITEM, description: "The source tree, with content. Skip node_modules, build output and binaries — Nova ignores them anyway." },
      },
      required: ["projectId", "files"],
      additionalProperties: false,
    },
    call: { method: "POST", path: "/api/mcp/projects/:projectId/verify" },
  },

  {
    name: "nova_audit",
    title: "Full codebase audit",
    description:
      "The full audit: Nova reads the whole tree and reconciles it against the plan — what stage this really is, which capabilities " +
      "exist, what's missing, and which milestones the board claims but the code doesn't support. " +
      "Expensive and slow (a model reads the repository), so run it at a checkpoint, not per edit. nova_verify is the per-change tool.",
    collectsFiles: true,
    readOnly: false,
    costly: true,
    inputSchema: {
      type: "object",
      properties: {
        ...projectId,
        files: { type: "array", items: FILE_ITEM, description: "The source tree, with content." },
        label: { type: "string", description: 'Where this came from, for the audit record. Defaults to "working tree".' },
      },
      required: ["projectId", "files"],
      additionalProperties: false,
    },
    call: { method: "POST", path: "/api/mcp/projects/:projectId/audit" },
  },

  {
    name: "nova_ask",
    title: "Ask Nova about one surface",
    description:
      "Nova's help on one area of the project — milestones, roadmap, research, strategy, pricing, measurement, tasks. " +
      "Returns a summary, the changes it proposes in words, and the operations that would make them. It writes nothing. " +
      "Show the user the summary and the items, and only call nova_apply if they agree. " +
      "Use this for planning questions; use nova_work for the task in front of you.",
    readOnly: false,
    costly: true,
    inputSchema: {
      type: "object",
      properties: {
        ...projectId,
        surface: { type: "string", description: "One of: milestones, roadmap, research, strategy, pricing, analytics, tasks." },
        ask: { type: "string", description: "What you want, phrased as the outcome. Max 2000 characters." },
        entityId: { type: "string", description: "The id of the thing selected, when the ask is about one item." },
      },
      required: ["projectId", "surface", "ask"],
      additionalProperties: false,
    },
    call: { method: "POST", path: "/api/mcp/projects/:projectId/ask" },
  },

  {
    name: "nova_apply",
    title: "Apply a reviewed suggestion",
    description:
      "Commits the operations from a nova_ask reply. No model call and no second charge. " +
      "Only call this once the person has actually seen what it would change.",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        ...projectId,
        operations: { type: "array", items: { type: "object" }, description: "The `operations` array from nova_ask, unmodified." },
      },
      required: ["projectId", "operations"],
      additionalProperties: false,
    },
    call: { method: "POST", path: "/api/mcp/projects/:projectId/apply" },
  },

  {
    name: "nova_mark",
    title: "Mark milestones done by hand",
    description:
      "The human's override: mark milestones done with a reason, for work that predates the path or that no audit could see. " +
      "This is the builder's word, and Nova records it as such — distinct from what it verified itself. " +
      "Only call this when the person has explicitly said the thing is done. Never infer it.",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        ...projectId,
        ids: { type: "array", items: { type: "string" }, description: "Backbone ids." },
        evidence: { type: "string", description: "Why it's done, in the person's terms." },
      },
      required: ["projectId", "ids"],
      additionalProperties: false,
    },
    call: { method: "POST", path: "/api/mcp/projects/:projectId/mark" },
  },
];

export const novaMcpTool = (name: string): NovaMcpTool | undefined =>
  NOVA_MCP_TOOLS.find((t) => t.name === name);

/**
 * The guidance the shim advertises as the server's instructions, and the
 * reason an agent doesn't go off and build its own roadmap.
 */
export const NOVA_MCP_INSTRUCTIONS = `Nova holds this project's plan: the path it's on, the milestone that's next, what counts as done, and the record of what's been built.

You hold the working tree. You read and edit files; Nova never does.

Work in this order:
1. nova_status — get the next task and its actor. Don't invent a plan; Nova has one.
2. If the actor is user-does, stop and tell the person. That step is theirs.
3. nova_work — get the build packet for the task.
4. Implement it yourself, in the editor, with the user's normal approval flow.
5. nova_submit — report what you changed.
6. nova_verify — send the tree and let Nova decide whether the milestone is proven.

Nova decides what is done. You never mark a milestone complete because the code looks right to you.`;
