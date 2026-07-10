import { chromium } from "playwright";

const baseUrl = process.env.TEST_URL || "http://127.0.0.1:4173";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const page = await context.newPage();
const pageErrors = [];
const consoleErrors = [];

page.on("pageerror", (error) => pageErrors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});

async function advanceDemo(duration = 19000, step = 80) {
  await page.evaluate(
    ({ duration, step }) => {
      window.__clawDebug.startDemo();
      window.__clawDebug.advance(duration, step);
      return window.__clawDebug.getState();
    },
    { duration, step },
  );
}

async function waitForControllingAttempt(attempts) {
  await page.waitForFunction(
    (attempts) => {
      const state = window.__clawDebug.getState();
      return state.state === "controlling" && state.attempts >= attempts;
    },
    attempts,
    { timeout: 24000 },
  );
}

async function waitForInitialState(expectedCelebrations) {
  await page.waitForFunction(
    (expectedCelebrations) => {
      const state = window.__clawDebug.getState();
      return state.state === "idle"
        && state.collectedCount === 0
        && state.visiblePrizeCount === state.prizeCount
        && state.celebrationCount >= expectedCelebrations
        && !state.celebrationVisible;
    },
    expectedCelebrations,
    { timeout: 10000 },
  );
}

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__clawDebug);

  const buttons = await page.evaluate(() => ({
    demoButtonCount: document.querySelectorAll("#demo-button").length,
    primaryText: document.getElementById("primary-button")?.textContent?.trim(),
  }));
  if (buttons.demoButtonCount !== 0) throw new Error("Duplicate demo button still exists");
  if (!["开始演示", "模型加载中"].includes(buttons.primaryText)) {
    throw new Error(`Unexpected primary button label: ${buttons.primaryText}`);
  }

  await page.evaluate(() => window.__clawDebug.reset());
  await advanceDemo();
  await waitForControllingAttempt(1);
  const partial = await page.evaluate(() => window.__clawDebug.getState());
  if (partial.celebrationCount !== 0 || partial.celebrationVisible) {
    throw new Error(`Partial collection should not celebrate: ${JSON.stringify(partial)}`);
  }
  if (partial.collectedCount !== 1 || partial.visiblePrizeCount !== partial.prizeCount - 1) {
    throw new Error(`First demo should collect exactly one prize: ${JSON.stringify(partial)}`);
  }

  let state = partial;
  for (let i = 0; i < state.prizeCount + 2; i += 1) {
    if (state.state === "celebrating" || state.state === "resetting") break;
    await advanceDemo();
    state = await page.evaluate(() => window.__clawDebug.getState());
  }
  await page.waitForFunction(
    () => {
      const state = window.__clawDebug.getState();
      return state.state === "celebrating" && state.celebrationVisible && state.celebrationCount === 1;
    },
    null,
    { timeout: 6000 },
  );
  const duringCelebration = await page.evaluate(() => ({
    disabled: document.getElementById("primary-button").disabled,
    state: window.__clawDebug.getState(),
  }));
  if (!duringCelebration.disabled) throw new Error("Primary button should be disabled while celebrating");
  await waitForInitialState(1);

  await page.evaluate(() => window.__clawDebug.collectAllPrizesForTest());
  await page.waitForFunction(() => window.__clawDebug.getState().state === "celebrating", null, { timeout: 3000 });
  await page.evaluate(() => window.__clawDebug.reset());
  const resetDuringCelebration = await page.evaluate(() => window.__clawDebug.getState());
  if (resetDuringCelebration.state !== "idle" || resetDuringCelebration.celebrationVisible) {
    throw new Error("Reset during celebration did not return to idle cleanly");
  }

  await page.evaluate(() => {
    window.__clawDebug.setCelebrationSourceForTest("/animations/missing-celebration.json");
    window.__clawDebug.collectAllPrizesForTest();
  });
  await waitForInitialState(3);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => {
    window.__clawDebug.setCelebrationSourceForTest();
    window.__clawDebug.collectAllPrizesForTest();
  });
  await waitForInitialState(4);
  await page.emulateMedia({ reducedMotion: "no-preference" });

  if (pageErrors.length > 0) throw new Error(`Page errors: ${pageErrors.join(" | ")}`);
  const unexpectedConsoleErrors = consoleErrors.filter((text) => (
    !text.includes("Celebration Lottie failed to load")
    && !text.includes("Celebration Lottie could not start")
    && !text.includes("missing-celebration.json")
  ));
  if (unexpectedConsoleErrors.length > 0) {
    throw new Error(`Console errors: ${unexpectedConsoleErrors.join(" | ")}`);
  }

  const finalState = await page.evaluate(() => window.__clawDebug.getState());
  console.log(`celebration-flow passed: celebrations=${finalState.celebrationCount}, state=${finalState.state}`);
} finally {
  await context.close();
  await browser.close();
}
