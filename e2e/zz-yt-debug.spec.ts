import { test, chromium } from "@playwright/test";
test("yt variants", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const chrome = await chromium.launch({ channel: "chrome" });
  for (const [name, b] of [["chrome", chrome], ["bundled", browser]] as const) {
    const page = await b.newPage();
    await page.goto(baseURL + "/");
    await page.evaluate(() => {
      document.body.innerHTML = `<div id="a"></div><iframe id="b" width="640" height="360" allow="autoplay; encrypted-media" src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?enablejsapi=1&autoplay=1&mute=1&controls=0&playsinline=1&cc_load_policy=1&origin=${encodeURIComponent(location.origin)}"></iframe><iframe id="c" width="640" height="360" allow="autoplay; encrypted-media" src="https://www.youtube.com/embed/dQw4w9WgXcQ?enablejsapi=1&autoplay=1&mute=1&controls=0&playsinline=1&origin=${encodeURIComponent(location.origin)}"></iframe>`;
      (window as any).log = [];
      const s = document.createElement("script"); s.src = "https://www.youtube.com/iframe_api"; document.head.appendChild(s);
      (window as any).onYouTubeIframeAPIReady = () => {
        const Y = (window as any).YT; const log = (window as any).log;
        new Y.Player("a", { host: "https://www.youtube-nocookie.com", videoId: "dQw4w9WgXcQ", width: 640, height: 360, playerVars: { mute: 1, controls: 0, playsinline: 1, origin: location.origin },
          events: { onReady: (e: any) => { log.push("A ready"); e.target.mute(); e.target.playVideo(); }, onStateChange: (e: any) => log.push("A " + e.data), onError: (e: any) => log.push("A err " + e.data) } });
        new Y.Player("b", { events: { onReady: () => log.push("B ready"), onStateChange: (e: any) => log.push("B " + e.data), onError: (e: any) => log.push("B err " + e.data) } });
        new Y.Player("c", { events: { onReady: () => log.push("C ready"), onStateChange: (e: any) => log.push("C " + e.data), onError: (e: any) => log.push("C err " + e.data) } });
      };
    });
    await page.waitForTimeout(15000);
    console.log(`LOG ${name}`, JSON.stringify(await page.evaluate(() => (window as any).log)));
    await page.close();
  }
  await chrome.close();
});
