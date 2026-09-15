/** Reading a company's public pages: its logo, its YouTube channel, and which video to show. */
import { describe, it, expect } from "vitest";
import {
  findLogoCandidates, findYouTubeChannelLinks, channelIdFrom, guessYouTubeHandles, channelVouchesFor,
  parseYouTubeFeed, rankChannelVideos, isPrivateAddress,
} from "@shared/promotion-sources";

describe("logos", () => {
  it("prefers the largest touch icon, skips SVG, resolves relative links, and falls back to /favicon.ico", () => {
    const html = `<head>
      <link rel="icon" href="/favicon-32x32.png" sizes="32x32" type="image/png">
      <link rel="icon" href="/favicon.svg" type="image/svg+xml">
      <link rel="apple-touch-icon" href="https://cdn.example.com/touch-57.png" sizes="57x57">
      <link rel='apple-touch-icon' href='/touch-180.png' sizes='180x180'>
      <link rel="stylesheet" href="/app.css"></head>`;
    expect(findLogoCandidates(html, "https://example.com/")).toEqual([
      "https://example.com/touch-180.png", "https://cdn.example.com/touch-57.png", "https://example.com/favicon-32x32.png", "https://example.com/favicon.ico",
    ]);
    expect(findLogoCandidates("<html></html>", "https://example.com/pricing")).toEqual(["https://example.com/favicon.ico"]);
  });
});

describe("YouTube", () => {
  it("finds channel links on a site, channel ids first", () => {
    const html = `<a href="https://youtube.com/c/supabase">YT</a> <a href="https://www.youtube.com/@VercelHQ">x</a> <a href="https://www.youtube.com/channel/UCgoJjdR6-7AMu9fDitb6nVw">y</a> <a href="https://www.youtube.com/watch?v=abc">video</a>`;
    expect(findYouTubeChannelLinks(html)).toEqual(["https://www.youtube.com/channel/UCgoJjdR6-7AMu9fDitb6nVw", "https://www.youtube.com/c/supabase", "https://www.youtube.com/@VercelHQ"]);
    expect(channelIdFrom('<script>{"externalId":"UCgoJjdR6-7AMu9fDitb6nVw"}</script>')).toBe("UCgoJjdR6-7AMu9fDitb6nVw");
    expect(channelIdFrom("https://www.youtube.com/@replit")).toBeNull();
  });

  it("guesses handles, and only trusts a guess whose page links the company's own domain", () => {
    expect(guessYouTubeHandles({ name: "PostHog", url: "https://posthog.com" })).toEqual(
      ["https://www.youtube.com/@posthog", "https://www.youtube.com/@posthoghq", "https://www.youtube.com/@posthogapp", "https://www.youtube.com/@posthogdev"]);
    expect(guessYouTubeHandles({ name: "v0 by Vercel", url: "https://v0.dev" })[0]).toBe("https://www.youtube.com/@v0");
    expect(channelVouchesFor('links: "posthog.com" … visit posthog.com/docs', "https://posthog.com")).toBe(true);
    expect(channelVouchesFor("a look-alike channel that mentions posthog.com once", "https://posthog.com")).toBe(false);
  });

  it("reads a channel's feed, and ranks recent launch videos first, talks last, without Shorts or old videos", () => {
    const entry = (id: string, title: string, published: string, short = false) => `<entry><yt:videoId>${id}</yt:videoId><title>${title}</title><link rel="alternate" href="https://www.youtube.com/${short ? "shorts/" : "watch?v="}${id}"/><published>${published}</published></entry>`;
    const xml = `<feed><title>Channel</title>${[
      entry("aaaaaaaaaa1", "Weekly AMA &amp; office hours", "2026-09-14T00:00:00Z"),
      entry("aaaaaaaaaa2", "Quick tip", "2026-09-13T00:00:00Z", true),
      entry("aaaaaaaaaa3", "How we debug production", "2026-09-12T00:00:00Z"),
      entry("aaaaaaaaaa4", "Introducing Agents", "2026-09-01T00:00:00Z"),
      entry("aaaaaaaaaa5", "Our launch from 2024", "2024-01-01T00:00:00Z"),
      entry("aaaaaaaaaa6", "Cool thing #shorts", "2026-09-10T00:00:00Z"),
    ].join("")}</feed>`;
    const videos = parseYouTubeFeed(xml);
    expect(videos).toHaveLength(6);
    expect(videos[0]).toEqual({ videoId: "aaaaaaaaaa1", title: "Weekly AMA & office hours", publishedAt: "2026-09-14T00:00:00Z" });
    expect(videos[1].short).toBe(true);
    expect(rankChannelVideos(videos, new Date("2026-09-15T00:00:00Z")).map((v) => v.videoId)).toEqual(["aaaaaaaaaa4", "aaaaaaaaaa3", "aaaaaaaaaa1"]);
  });
});

describe("fetch safety", () => {
  it("refuses loopback, private, link-local and unspecified addresses", () => {
    for (const ip of ["127.0.0.1", "10.2.3.4", "172.20.0.1", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["104.18.1.1", "142.250.1.1", "2606:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
});
