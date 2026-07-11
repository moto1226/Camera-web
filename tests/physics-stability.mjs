import { chromium } from "playwright";

const baseUrl = process.env.TEST_URL || "http://127.0.0.1:4173";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
const consoleErrors = [];

page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => {
  consoleErrors.push(error.message);
});

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__clawDebug);

  const initRuns = [];
  for (let i = 0; i < 20; i += 1) {
    const state = await page.evaluate(() => {
      window.__clawDebug.reset();
      window.__clawDebug.advance(1200, 16);
      return window.__clawDebug.getState();
    });
    const physics = state.prizePhysics;
    const prewarm = state.lastPrewarmStats;
    if (state.prizeCount < 12 || physics.overlapCount !== 0 || prewarm?.overlapCount !== 0) {
      throw new Error(`Initialization ${i + 1} unstable ${JSON.stringify({
        prizeCount: state.prizeCount,
        physics,
        prewarm,
      })}`);
    }
    if (physics.maxLinearSpeed > 0.12 || physics.maxAngularSpeed > 0.24) {
      throw new Error(`Initialization ${i + 1} did not settle ${JSON.stringify(physics)}`);
    }
    initRuns.push({
      run: i + 1,
      prizeCount: state.prizeCount,
      maxLinearSpeed: physics.maxLinearSpeed,
      maxAngularSpeed: physics.maxAngularSpeed,
      awakeCount: physics.awakeCount,
      prewarm,
    });
  }

  const contactProbe = await page.evaluate(() => {
    window.__clawDebug.reset();
    window.__clawDebug.startDemo();
    window.__clawDebug.advance(5600, 16);
    return window.__clawDebug.getState();
  });
  if (contactProbe.prizePhysics.maxLinearSpeed > 0.55 || contactProbe.prizePhysics.maxAngularSpeed > 1.1) {
    throw new Error(`Claw contact created excessive toy motion ${JSON.stringify(contactProbe.prizePhysics)}`);
  }

  const demoRuns = [];
  for (let i = 0; i < 10; i += 1) {
    const state = await page.evaluate(() => {
      window.__clawDebug.reset();
      window.__clawDebug.startDemo();
      window.__clawDebug.advance(18000, 16);
      return window.__clawDebug.getState();
    });
    if (state.state !== "controlling" || state.attempts !== 1 || state.latestAttempt?.success !== true) {
      throw new Error(`Demo ${i + 1} did not finish as a successful grab ${JSON.stringify({
        state: state.state,
        attempts: state.attempts,
        result: state.result,
        latestAttempt: state.latestAttempt,
      })}`);
    }
    if (state.prizePhysics.overlapCount !== 0) {
      throw new Error(`Demo ${i + 1} left overlapping prizes ${JSON.stringify(state.prizePhysics)}`);
    }
    demoRuns.push({
      run: i + 1,
      result: state.result,
      release: state.lastReleaseStats,
      maxLinearSpeed: state.prizePhysics.maxLinearSpeed,
      maxAngularSpeed: state.prizePhysics.maxAngularSpeed,
    });
  }

  if (consoleErrors.length) {
    throw new Error(`Console errors: ${consoleErrors.join(" | ")}`);
  }

  console.log(JSON.stringify({
    engine: "cannon-es",
    initRuns,
    contactProbe: contactProbe.prizePhysics,
    demoRuns,
  }));
} finally {
  await browser.close();
}
