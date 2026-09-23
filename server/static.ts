import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { injectPageMeta, type PageMeta } from "@shared/path-artifacts";
import { pageStatus } from "./page-status";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath, { index: false }));

  // fall through to index.html if the file doesn't exist — with the page's own
  // title and preview tags when a route set them (a published artifact, say).
  const indexHtml = fs.readFileSync(path.resolve(distPath, "index.html"), "utf-8");
  app.use("/{*path}", (_req, res) => {
    const meta = res.locals.pageMeta as PageMeta | undefined;
    // See the note in server/vite.ts: a route can ask for a 404 and still get the shell.
    res.status(pageStatus(res)).set({ "Content-Type": "text/html" }).end(meta ? injectPageMeta(indexHtml, meta) : indexHtml);
  });
}
