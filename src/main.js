import "./styles.css";
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

const canvas = document.getElementById("game-canvas");
const ctx = canvas.getContext("2d");
const video = document.getElementById("camera-video");
const handOverlay = document.getElementById("hand-overlay");
const handCtx = handOverlay.getContext("2d");

const ui = {
  state: document.getElementById("state-label"),
  input: document.getElementById("input-label"),
  gesture: document.getElementById("gesture-label"),
  result: document.getElementById("result-label"),
  cameraMessage: document.getElementById("camera-message"),
  meterX: document.getElementById("meter-x"),
  meterY: document.getElementById("meter-y"),
  demo: document.getElementById("demo-button"),
  reset: document.getElementById("reset-button"),
};

const STATES = {
  IDLE: "idle",
  CONTROLLING: "controlling",
  DROPPING: "dropping",
  GRABBING: "grabbing",
  LIFTING: "lifting",
  RETURNING: "returning",
  RELEASING: "releasing",
  RESULT: "result",
};

const STATE_LABELS = {
  [STATES.IDLE]: "等待开始",
  [STATES.CONTROLLING]: "控制抓手",
  [STATES.DROPPING]: "下放抓取",
  [STATES.GRABBING]: "闭合抓手",
  [STATES.LIFTING]: "自动上升",
  [STATES.RETURNING]: "回到出口",
  [STATES.RELEASING]: "放手结算",
  [STATES.RESULT]: "本轮结束",
};

const machine = {
  left: 110,
  top: 80,
  width: 920,
  height: 650,
  playTop: 190,
  floor: 650,
  exit: { x: 185, y: 622, w: 150, h: 72 },
};

const claw = {
  x: 550,
  y: 230,
  targetX: 550,
  targetY: 230,
  homeY: 230,
  minX: machine.left + 120,
  maxX: machine.left + machine.width - 120,
  minY: 230,
  maxY: 480,
  arm: 60,
  closed: 0,
};

const game = {
  state: STATES.IDLE,
  stateTime: 0,
  lastTime: performance.now(),
  inputMode: "loading",
  handPresent: false,
  palmOpenMs: 0,
  fistMs: 0,
  calibration: null,
  result: "未开始",
  grabbedToy: null,
  demoActive: false,
  demoTime: 0,
  keys: new Set(),
};

const input = {
  rawX: 0.5,
  rawY: 0.5,
  x: 0.5,
  y: 0.5,
  openPalm: false,
  fist: false,
};

const toys = createToys();
let handLandmarker = null;
let cameraStarted = false;

function createToys() {
  const palette = [
    ["#ffcf5d", "#f07f35"],
    ["#8cf6c8", "#1e9d78"],
    ["#9dd2ff", "#3464d8"],
    ["#ff8aa1", "#cc3856"],
    ["#d5a7ff", "#7649bd"],
    ["#fff0a3", "#c18d24"],
    ["#72f0ff", "#257e96"],
    ["#ffb06f", "#b14e28"],
  ];
  const list = [];
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      const idx = row * 4 + col;
      const x = machine.left + 210 + col * 155 + (row % 2) * 28;
      const y = machine.floor - 54 - row * 58;
      const [a, b] = palette[idx % palette.length];
      list.push({
        id: `toy-${idx}`,
        x,
        y,
        homeX: x,
        homeY: y,
        r: 28 + (idx % 3) * 4,
        colors: [a, b],
        grabbed: false,
        collected: false,
        wobble: Math.random() * Math.PI * 2,
      });
    }
  }
  return list;
}

function setState(next) {
  if (game.state === next) return;
  game.state = next;
  game.stateTime = 0;
  ui.state.textContent = STATE_LABELS[next];
  window.__clawGameState = game.state;
}

function resetGame() {
  setState(STATES.IDLE);
  game.result = "未开始";
  game.grabbedToy = null;
  game.palmOpenMs = 0;
  game.fistMs = 0;
  game.calibration = null;
  game.demoActive = false;
  game.demoTime = 0;
  input.rawX = 0.5;
  input.rawY = 0.5;
  input.x = 0.5;
  input.y = 0.5;
  input.openPalm = false;
  input.fist = false;
  claw.x = 550;
  claw.y = claw.homeY;
  claw.targetX = claw.x;
  claw.targetY = claw.y;
  claw.closed = 0;
  claw.arm = 60;
  toys.forEach((toy) => {
    toy.x = toy.homeX;
    toy.y = toy.homeY;
    toy.grabbed = false;
    toy.collected = false;
  });
  updateUi();
}

function updateUi() {
  ui.state.textContent = STATE_LABELS[game.state];
  ui.input.textContent = game.demoActive
    ? "自动演示"
    : game.inputMode === "camera"
      ? "摄像头"
      : "键盘调试";
  ui.gesture.textContent = input.fist ? "攥拳" : input.openPalm ? "张开手掌" : game.handPresent ? "手已入镜" : "未检测";
  ui.result.textContent = game.result;
  ui.meterX.value = input.x;
  ui.meterY.value = input.y;
}

async function initCameraAndModel() {
  const secure = window.isSecureContext || location.hostname === "localhost" || location.hostname === "127.0.0.1";
  if (!secure) throw new Error("摄像头需要 HTTPS 或 localhost 环境。");
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("当前浏览器不支持摄像头 API。");

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, facingMode: "user" },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  cameraStarted = true;

  const resolver = await FilesetResolver.forVisionTasks("/assets/mediapipe/wasm");
  handLandmarker = await HandLandmarker.createFromOptions(resolver, {
    baseOptions: {
      modelAssetPath: "/assets/models/hand_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: 1,
    minHandDetectionConfidence: 0.55,
    minHandPresenceConfidence: 0.55,
    minTrackingConfidence: 0.5,
  });

  game.inputMode = "camera";
  ui.cameraMessage.textContent = "摄像头已启用：张开手掌开始。";
}

function enableDebugMode(reason) {
  game.inputMode = "debug";
  ui.cameraMessage.textContent = `调试模式：${reason} 用键盘或自动演示验证流程。`;
}

function fingerExtended(lm, tip, pip, mcp) {
  const vertical = lm[tip].y < lm[pip].y && lm[pip].y < lm[mcp].y;
  const distance = Math.hypot(lm[tip].x - lm[mcp].x, lm[tip].y - lm[mcp].y);
  return vertical || distance > 0.13;
}

function classifyHand(lm) {
  const fingers = [
    fingerExtended(lm, 8, 6, 5),
    fingerExtended(lm, 12, 10, 9),
    fingerExtended(lm, 16, 14, 13),
    fingerExtended(lm, 20, 18, 17),
  ];
  const openCount = fingers.filter(Boolean).length;
  const palmCenter = {
    x: (lm[0].x + lm[5].x + lm[9].x + lm[13].x + lm[17].x) / 5,
    y: (lm[0].y + lm[5].y + lm[9].y + lm[13].y + lm[17].y) / 5,
  };
  const palmScale = Math.hypot(lm[5].x - lm[17].x, lm[5].y - lm[17].y);
  return {
    palmCenter,
    palmScale,
    openPalm: openCount >= 3,
    fist: openCount <= 1,
  };
}

function readCameraInput() {
  if (!handLandmarker || !cameraStarted || video.readyState < 2) return;
  const result = handLandmarker.detectForVideo(video, performance.now());
  handCtx.clearRect(0, 0, handOverlay.width, handOverlay.height);

  if (!result.landmarks?.length) {
    game.handPresent = false;
    input.openPalm = false;
    input.fist = false;
    return;
  }

  const lm = result.landmarks[0];
  const hand = classifyHand(lm);
  game.handPresent = true;
  input.openPalm = hand.openPalm;
  input.fist = hand.fist;

  if (!game.calibration && game.state === STATES.CONTROLLING) {
    game.calibration = {
      x: hand.palmCenter.x,
      y: hand.palmCenter.y,
      scale: hand.palmScale || 0.16,
    };
  }

  if (game.calibration) {
    const dx = (hand.palmCenter.x - game.calibration.x) * 2.4;
    const dy = (hand.palmCenter.y - game.calibration.y) * 2.2;
    const scaleDelta = ((game.calibration.scale || 0.16) - hand.palmScale) * 2.4;
    input.rawX = clamp(0.5 + dx, 0, 1);
    input.rawY = clamp(0.5 + dy + scaleDelta, 0, 1);
  }

  drawHandOverlay(lm);
}

function drawHandOverlay(lm) {
  handCtx.save();
  handCtx.scale(-1, 1);
  handCtx.translate(-handOverlay.width, 0);
  handCtx.fillStyle = "rgba(88, 242, 184, 0.9)";
  lm.forEach((p) => {
    handCtx.beginPath();
    handCtx.arc(p.x * handOverlay.width, p.y * handOverlay.height, 3, 0, Math.PI * 2);
    handCtx.fill();
  });
  handCtx.restore();
}

function readDebugInput(dt) {
  const speed = dt * 0.0012;
  if (game.keys.has("ArrowLeft") || game.keys.has("KeyA")) input.rawX -= speed;
  if (game.keys.has("ArrowRight") || game.keys.has("KeyD")) input.rawX += speed;
  if (game.keys.has("ArrowUp") || game.keys.has("KeyW")) input.rawY -= speed;
  if (game.keys.has("ArrowDown") || game.keys.has("KeyS")) input.rawY += speed;
  input.rawX = clamp(input.rawX, 0, 1);
  input.rawY = clamp(input.rawY, 0, 1);
  input.openPalm = game.state === STATES.IDLE && game.keys.has("Enter");
  input.fist = game.keys.has("Space");
}

function readDemoInput(dt) {
  game.demoTime += dt;
  const t = game.demoTime;
  input.openPalm = t < 1250;
  input.fist = t > 3100 && t < 3800;

  if (t < 1250) {
    input.rawX = 0.5;
    input.rawY = 0.5;
  } else if (t < 3100) {
    const u = (t - 1250) / 1850;
    input.rawX = lerp(0.5, 0.43, easeInOut(u));
    input.rawY = lerp(0.5, 0.77, easeInOut(u));
  }
}

function updateState(dt) {
  game.stateTime += dt;

  if (game.state === STATES.IDLE) {
    game.palmOpenMs = input.openPalm ? game.palmOpenMs + dt : 0;
    if (game.palmOpenMs >= 900) {
      game.result = "游戏中";
      game.calibration = null;
      setState(STATES.CONTROLLING);
    }
  } else if (game.state === STATES.CONTROLLING) {
    game.fistMs = input.fist ? game.fistMs + dt : 0;
    if (game.fistMs >= 280) {
      game.fistMs = 0;
      setState(STATES.DROPPING);
    }
  } else if (game.state === STATES.DROPPING) {
    claw.targetY = claw.maxY;
    claw.closed = approach(claw.closed, 0.2, dt * 0.006);
    if (Math.abs(claw.y - claw.maxY) < 4) setState(STATES.GRABBING);
  } else if (game.state === STATES.GRABBING) {
    claw.closed = approach(claw.closed, 1, dt * 0.004);
    if (game.stateTime > 520) {
      game.grabbedToy = pickToy();
      if (game.grabbedToy) game.grabbedToy.grabbed = true;
      setState(STATES.LIFTING);
    }
  } else if (game.state === STATES.LIFTING) {
    claw.targetY = claw.homeY;
    if (game.grabbedToy) {
      game.grabbedToy.x = claw.x;
      game.grabbedToy.y = claw.y + 74;
    }
    if (Math.abs(claw.y - claw.homeY) < 4) setState(STATES.RETURNING);
  } else if (game.state === STATES.RETURNING) {
    claw.targetX = machine.exit.x + machine.exit.w / 2;
    claw.targetY = claw.homeY;
    if (game.grabbedToy) {
      game.grabbedToy.x = claw.x;
      game.grabbedToy.y = claw.y + 74;
    }
    if (Math.abs(claw.x - claw.targetX) < 5) setState(STATES.RELEASING);
  } else if (game.state === STATES.RELEASING) {
    claw.closed = approach(claw.closed, 0, dt * 0.0045);
    if (game.grabbedToy) {
      game.grabbedToy.x = lerp(game.grabbedToy.x, machine.exit.x + machine.exit.w / 2, 0.18);
      game.grabbedToy.y = lerp(game.grabbedToy.y, machine.exit.y + 18, 0.18);
    }
    if (game.stateTime > 720) {
      if (game.grabbedToy) {
        game.grabbedToy.collected = true;
        game.result = "抓到了";
      } else {
        game.result = "差一点";
      }
      setState(STATES.RESULT);
    }
  } else if (game.state === STATES.RESULT) {
    claw.targetX = 550;
    claw.targetY = claw.homeY;
  }
}

function updateClaw(dt) {
  if (game.state === STATES.CONTROLLING) {
    claw.targetX = map(input.x, 0, 1, claw.minX, claw.maxX);
    claw.targetY = map(input.y, 0, 1, claw.minY, claw.maxY - 85);
    claw.closed = approach(claw.closed, 0, dt * 0.004);
  }

  claw.x = lerp(claw.x, claw.targetX, 1 - Math.pow(0.0015, dt / 1000));
  claw.y = lerp(claw.y, claw.targetY, 1 - Math.pow(0.002, dt / 1000));
  claw.arm = Math.max(60, claw.y - machine.top - 25);
}

function pickToy() {
  let best = null;
  let bestDist = Infinity;
  toys.forEach((toy) => {
    if (toy.collected) return;
    const dx = toy.x - claw.x;
    const dy = toy.y - (claw.y + 88);
    const dist = Math.hypot(dx, dy);
    if (dist < toy.r + 34 && dist < bestDist) {
      best = toy;
      bestDist = dist;
    }
  });
  return best;
}

function tick(now) {
  const dt = Math.min(40, now - game.lastTime);
  game.lastTime = now;

  if (game.inputMode === "camera") readCameraInput();
  if (game.demoActive) readDemoInput(dt);
  else if (game.inputMode !== "camera") readDebugInput(dt);

  input.x = lerp(input.x, input.rawX, 0.18);
  input.y = lerp(input.y, input.rawY, 0.18);

  updateState(dt);
  updateClaw(dt);
  draw(now);
  updateUi();
  requestAnimationFrame(tick);
}

function draw(now) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBackground();
  drawMachine();
  drawToys(now);
  drawClaw();
  drawOverlayText();
}

function drawBackground() {
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, "#19120e");
  grad.addColorStop(0.45, "#2d1a12");
  grad.addColorStop(1, "#08090c");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "rgba(255, 196, 77, 0.08)";
  for (let i = 0; i < 18; i += 1) {
    ctx.fillRect(64 + i * 70, 34 + (i % 3) * 8, 34, 6);
  }
}

function drawMachine() {
  ctx.save();
  roundedRect(machine.left, machine.top, machine.width, machine.height, 18, "#f0b641", "#4a2818", 8);
  roundedRect(machine.left + 42, machine.top + 86, machine.width - 84, machine.height - 182, 12, "#111820", "#ffe2a3", 5);

  const glass = ctx.createLinearGradient(0, machine.top + 90, 0, machine.floor);
  glass.addColorStop(0, "rgba(81, 212, 255, 0.17)");
  glass.addColorStop(1, "rgba(255, 255, 255, 0.03)");
  ctx.fillStyle = glass;
  ctx.fillRect(machine.left + 48, machine.top + 92, machine.width - 96, machine.height - 194);

  ctx.fillStyle = "#28150d";
  ctx.fillRect(machine.left + 58, machine.floor, machine.width - 116, 46);

  roundedRect(machine.exit.x, machine.exit.y, machine.exit.w, machine.exit.h, 8, "#111114", "#58f2b8", 4);
  ctx.fillStyle = "#58f2b8";
  ctx.font = "bold 22px Trebuchet MS";
  ctx.fillText("出口", machine.exit.x + 54, machine.exit.y + 46);

  ctx.fillStyle = "#2b180e";
  ctx.fillRect(machine.left + 82, machine.top + 42, machine.width - 164, 34);
  ctx.fillStyle = "#fff4d6";
  ctx.font = "900 34px Trebuchet MS";
  ctx.fillText("HAND CLAW", machine.left + 335, machine.top + 69);
  ctx.restore();
}

function drawToys(now) {
  toys.forEach((toy) => {
    if (toy.collected) return;
    const y = toy.grabbed ? toy.y : toy.y + Math.sin(now / 500 + toy.wobble) * 2;
    drawToy(toy.x, y, toy.r, toy.colors);
  });
}

function drawToy(x, y, r, colors) {
  const grad = ctx.createRadialGradient(x - r * 0.35, y - r * 0.45, r * 0.2, x, y, r * 1.2);
  grad.addColorStop(0, colors[0]);
  grad.addColorStop(1, colors[1]);
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.beginPath();
  ctx.ellipse(x, y + r + 11, r * 0.85, r * 0.24, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x - r * 0.55, y - r * 0.7, r * 0.34, 0, Math.PI * 2);
  ctx.arc(x + r * 0.55, y - r * 0.7, r * 0.34, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#171311";
  ctx.beginPath();
  ctx.arc(x - r * 0.32, y - r * 0.08, r * 0.09, 0, Math.PI * 2);
  ctx.arc(x + r * 0.32, y - r * 0.08, r * 0.09, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#171311";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y + r * 0.1, r * 0.24, 0.2, Math.PI - 0.2);
  ctx.stroke();
}

function drawClaw() {
  ctx.save();
  ctx.strokeStyle = "#ffe4a6";
  ctx.lineWidth = 9;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(claw.x, machine.top + 78);
  ctx.lineTo(claw.x, claw.y);
  ctx.stroke();

  roundedRect(claw.x - 42, claw.y - 24, 84, 40, 8, "#3b2a1b", "#ffc44d", 4);

  const spread = lerp(42, 18, claw.closed);
  ctx.strokeStyle = "#e9edf0";
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(claw.x - 18, claw.y + 10);
  ctx.quadraticCurveTo(claw.x - spread, claw.y + 54, claw.x - spread * 0.82, claw.y + 94);
  ctx.moveTo(claw.x + 18, claw.y + 10);
  ctx.quadraticCurveTo(claw.x + spread, claw.y + 54, claw.x + spread * 0.82, claw.y + 94);
  ctx.moveTo(claw.x, claw.y + 14);
  ctx.quadraticCurveTo(claw.x, claw.y + 62, claw.x, claw.y + 98);
  ctx.stroke();

  ctx.strokeStyle = "#ff5b3f";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(claw.x, claw.y + 92, 32, 0.1, Math.PI - 0.1);
  ctx.stroke();
  ctx.restore();
}

function drawOverlayText() {
  if (game.state !== STATES.IDLE && game.state !== STATES.RESULT) return;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.56)";
  ctx.fillRect(machine.left + 110, machine.top + 210, machine.width - 220, 146);
  ctx.textAlign = "center";
  ctx.fillStyle = "#fff4d6";
  ctx.font = "900 46px Trebuchet MS";
  ctx.fillText(game.state === STATES.IDLE ? "张开手掌或按 Enter 开始" : game.result, machine.left + machine.width / 2, machine.top + 272);
  ctx.fillStyle = "#ffc44d";
  ctx.font = "bold 22px Trebuchet MS";
  ctx.fillText(game.state === STATES.IDLE ? "无摄像头也可以用调试键盘完成验证" : "按重置或自动演示再来一局", machine.left + machine.width / 2, machine.top + 318);
  ctx.restore();
}

function roundedRect(x, y, w, h, r, fill, stroke, lineWidth = 1) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function map(value, inMin, inMax, outMin, outMax) {
  return outMin + ((value - inMin) / (inMax - inMin)) * (outMax - outMin);
}

function approach(current, target, step) {
  if (current < target) return Math.min(target, current + step);
  return Math.max(target, current - step);
}

function easeInOut(t) {
  const n = clamp(t, 0, 1);
  return n < 0.5 ? 2 * n * n : 1 - Math.pow(-2 * n + 2, 2) / 2;
}

window.__clawDebug = {
  startDemo() {
    resetGame();
    game.demoActive = true;
    game.inputMode = game.inputMode === "camera" ? "camera" : "debug";
    game.demoTime = 0;
    ui.cameraMessage.textContent = "自动演示正在生成模拟手势轨迹。";
  },
  getState() {
    return {
      state: game.state,
      result: game.result,
      inputMode: game.inputMode,
      canvasPainted: true,
    };
  },
};

document.addEventListener("keydown", (event) => {
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) {
    event.preventDefault();
  }
  game.keys.add(event.code);
});

document.addEventListener("keyup", (event) => {
  game.keys.delete(event.code);
});

ui.demo.addEventListener("click", () => window.__clawDebug.startDemo());
ui.reset.addEventListener("click", resetGame);

resetGame();
initCameraAndModel().catch((error) => {
  enableDebugMode(error.message || "摄像头不可用。");
});
requestAnimationFrame(tick);
