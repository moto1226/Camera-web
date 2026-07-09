import { chromium } from "playwright";

const baseUrl = process.env.TEST_URL || "http://127.0.0.1:4173";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__clawDebug);
  await page.evaluate(() => window.__clawDebug.startDemo());
  await page.evaluate(() => window.__clawDebug.advance(14000));
  await page.waitForFunction(
    () => {
      const state = window.__clawDebug.getState();
      return state.state === "result";
    },
    null,
    { timeout: 22000 },
  );
  const state = await page.evaluate(() => window.__clawDebug.getState());
  if (!["抓到了", "差一点"].includes(state.result)) {
    throw new Error(`Unexpected result: ${state.result}`);
  }

  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");
  await page.evaluate(() => window.__clawDebug.advance(1200));
  const keyboardState = await page.evaluate(() => window.__clawDebug.getState());
  if (keyboardState.round !== state.round || keyboardState.state !== "result") {
    throw new Error("Keyboard input should not control the game");
  }

  const painted = await page.evaluate(() => {
    const canvas = document.getElementById("game-canvas");
    return canvas.toDataURL("image/png").length > 10000;
  });
  if (!painted || state.renderer !== "three") throw new Error("3D canvas is blank or renderer mismatch");

  console.log(`flow-smoke passed: ${state.state}, ${state.result}, ${state.inputMode}`);
} finally {
  await browser.close();
}
