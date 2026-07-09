import { chromium } from "playwright";

const baseUrl = process.env.TEST_URL || "http://127.0.0.1:4173";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__clawDebug);
  await page.evaluate(() => window.__clawDebug.startDemo());
  await page.waitForFunction(
    () => {
      const state = window.__clawDebug.getState();
      return state.state === "result";
    },
    null,
    { timeout: 9000 },
  );
  const state = await page.evaluate(() => window.__clawDebug.getState());
  if (!["抓到了", "差一点"].includes(state.result)) {
    throw new Error(`Unexpected result: ${state.result}`);
  }

  const painted = await page.evaluate(() => {
    const canvas = document.getElementById("game-canvas");
    const ctx = canvas.getContext("2d");
    const sample = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < sample.length; i += 4) {
      if (sample[i] !== 0) return true;
    }
    return false;
  });
  if (!painted) throw new Error("Canvas is blank");

  console.log(`flow-smoke passed: ${state.state}, ${state.result}, ${state.inputMode}`);
} finally {
  await browser.close();
}
