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
      return state.state === "controlling" && state.attempts >= 1;
    },
    null,
    { timeout: 22000 },
  );
  const state = await page.evaluate(() => window.__clawDebug.getState());
  if (!["抓到了", "差一点"].includes(state.result)) {
    throw new Error(`Unexpected result: ${state.result}`);
  }
  if (state.attempts !== 1 || state.latestAttempt?.success !== (state.result === "抓到了")) {
    throw new Error("Scoreboard attempt was not recorded correctly");
  }

  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");
  await page.evaluate(() => window.__clawDebug.advance(1200));
  const keyboardState = await page.evaluate(() => window.__clawDebug.getState());
  if (keyboardState.round !== state.round || keyboardState.attempts !== state.attempts) {
    throw new Error("Keyboard input should not control the game");
  }

  await page.evaluate(() => window.__clawDebug.startDemo());
  await page.evaluate(() => window.__clawDebug.advance(18000, 80));
  await page.waitForFunction(
    () => {
      const nextState = window.__clawDebug.getState();
      return nextState.state === "controlling" && nextState.attempts >= 2;
    },
    null,
    { timeout: 22000 },
  );
  const secondAttemptState = await page.evaluate(() => window.__clawDebug.getState());
  if (secondAttemptState.round !== state.round || secondAttemptState.attempts !== 2) {
    throw new Error("Second attempt should be recorded in the same session");
  }

  const painted = await page.evaluate(() => {
    const canvas = document.getElementById("game-canvas");
    return canvas.toDataURL("image/png").length > 10000;
  });
  if (!painted || state.renderer !== "three") throw new Error("3D canvas is blank or renderer mismatch");

  console.log(`flow-smoke passed: ${secondAttemptState.state}, attempts=${secondAttemptState.attempts}`);
} finally {
  await browser.close();
}
