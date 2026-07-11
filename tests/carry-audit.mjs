import { chromium } from "playwright";

const baseUrl = process.env.TEST_URL || "http://127.0.0.1:4173";
const CARRY_SAMPLE_FRAMES = 120;
const MAX_RELATIVE_DELTA = 0.001;
const DEMO_STEP_MS = 16;

let browser = await chromium.launch({ headless: true });
let page = await browser.newPage({ viewport: { width: 1366, height: 900 } });

function assertCarryAudit(audit, label) {
  if (audit.samples < CARRY_SAMPLE_FRAMES) {
    throw new Error(`${label}: expected ${CARRY_SAMPLE_FRAMES} carry samples, got ${audit.samples}`);
  }
  if (audit.maxRelativeDelta > MAX_RELATIVE_DELTA) {
    throw new Error(`${label}: relative drift ${audit.maxRelativeDelta} exceeded ${MAX_RELATIVE_DELTA}`);
  }
  if (audit.stateSwitches !== 0 || audit.invalidOwnerCount !== 0) {
    throw new Error(`${label}: invalid carry state ${JSON.stringify({
      stateSwitches: audit.stateSwitches,
      invalidOwnerCount: audit.invalidOwnerCount,
    })}`);
  }
  if (audit.maxSourcesPerFrame !== 1 || audit.multiSourceFrames.length) {
    throw new Error(`${label}: multiple position sources ${JSON.stringify({
      maxSourcesPerFrame: audit.maxSourcesPerFrame,
      multiSourceFrames: audit.multiSourceFrames.slice(0, 3),
    })}`);
  }
}

async function runCompleteDemo(label) {
  const state = await page.evaluate((step) => {
    window.__clawDebug.reset();
    window.__clawDebug.startDemo();
    window.__clawDebug.advance(18000, step);
    return window.__clawDebug.getState();
  }, DEMO_STEP_MS);
  if (state.state !== "controlling" || state.attempts !== 1 || !["抓到了", "差一点"].includes(state.result)) {
    throw new Error(`${label}: demo did not finish cleanly ${JSON.stringify(state)}`);
  }
  if (state.result === "抓到了" && state.carryMaxRelativeDelta > MAX_RELATIVE_DELTA) {
    throw new Error(`${label}: carried prize was unstable ${JSON.stringify({
      carryMaxRelativeDelta: state.carryMaxRelativeDelta,
    })}`);
  }
  if (state.gripConstraintCount !== 0) {
    throw new Error(`${label}: stale grip constraints remained ${state.gripConstraintCount}`);
  }
  return state;
}

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__clawDebug);

  await page.evaluate(() => window.__clawDebug.reset());
  const audit = await page.evaluate((targetSamples) => {
    window.__clawDebug.startDemo();
    window.__clawDebug.startPositionAudit();
    for (let i = 0; i < 1800; i += 1) {
      window.__clawDebug.advance(16, 16);
      if (window.__clawDebug.getPositionAudit().samples >= targetSamples) break;
    }
    const audit = window.__clawDebug.getPositionAudit();
    return audit;
  }, CARRY_SAMPLE_FRAMES);
  assertCarryAudit(audit, "120-frame carry audit");

  await browser.close();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__clawDebug);

  const tenRuns = [];
  for (let i = 0; i < 10; i += 1) {
    const state = await runCompleteDemo(`10-run demo ${i + 1}`);
    tenRuns.push({
      run: i + 1,
      result: state.result,
      carryMaxRelativeDelta: state.carryMaxRelativeDelta,
      gripConstraintCount: state.gripConstraintCount,
    });
  }

  const repeatedClickState = await page.evaluate((step) => {
    window.__clawDebug.reset();
    for (let i = 0; i < 5; i += 1) window.__clawDebug.startDemo();
    window.__clawDebug.advance(18000, step);
    return window.__clawDebug.getState();
  }, DEMO_STEP_MS);
  if (repeatedClickState.attempts !== 1 || repeatedClickState.state !== "controlling") {
    throw new Error(`Repeated demo start created invalid state ${JSON.stringify(repeatedClickState)}`);
  }

  const resetStages = [900, 4300, 5600, 7600, 10000, 11800];
  const resetResults = [];
  for (const resetAtMs of resetStages) {
    const resetState = await page.evaluate((duration) => {
      window.__clawDebug.reset();
      window.__clawDebug.startDemo();
      window.__clawDebug.advance(duration, 16);
      window.__clawDebug.reset();
      return window.__clawDebug.getState();
    }, resetAtMs);
    if (resetState.state !== "idle" || resetState.attempts !== 0 || resetState.grabbedPositionOwner !== null) {
      throw new Error(`Reset failed at ${resetAtMs}ms ${JSON.stringify(resetState)}`);
    }
    const replay = await runCompleteDemo(`replay after reset ${resetAtMs}ms`);
    resetResults.push({
      resetAtMs,
      replayResult: replay.result,
      carryMaxRelativeDelta: replay.carryMaxRelativeDelta,
    });
  }

  const backgroundRecovery = await page.evaluate((step) => {
    window.__clawDebug.reset();
    window.__clawDebug.startDemo();
    window.__clawDebug.advance(6500, step);
    window.__clawDebug.advance(5000, 5000);
    window.__clawDebug.advance(12000, step);
    return window.__clawDebug.getState();
  }, DEMO_STEP_MS);
  if (backgroundRecovery.state !== "controlling" || backgroundRecovery.attempts !== 1) {
    throw new Error(`Background recovery failed ${JSON.stringify(backgroundRecovery)}`);
  }

  console.log(JSON.stringify({
    audit: {
      samples: audit.samples,
      minRelativeX: audit.minRelativeX,
      maxRelativeX: audit.maxRelativeX,
      minRelativeY: audit.minRelativeY,
      maxRelativeY: audit.maxRelativeY,
      maxRelativeDelta: audit.maxRelativeDelta,
      stateSwitches: audit.stateSwitches,
      maxSourcesPerFrame: audit.maxSourcesPerFrame,
      invalidOwnerCount: audit.invalidOwnerCount,
    },
    tenRuns,
    repeatedClick: {
      attempts: repeatedClickState.attempts,
      result: repeatedClickState.result,
      carryMaxRelativeDelta: repeatedClickState.carryMaxRelativeDelta,
    },
    resetResults,
    backgroundRecovery: {
      state: backgroundRecovery.state,
      attempts: backgroundRecovery.attempts,
      carryMaxRelativeDelta: backgroundRecovery.carryMaxRelativeDelta,
    },
  }));
} finally {
  await browser.close();
}
