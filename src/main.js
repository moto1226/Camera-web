import "./styles.css";
import lottie from "lottie-web";
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import * as CANNON from "cannon-es";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { COLOR_VARIANTS } from "./game/prizes/prizeManifest.js";
import { createPrizeRound } from "./game/prizes/prizeLayout.js";
import { normalizeSeed } from "./game/prizes/seededRandom.js";

const canvas = document.getElementById("game-canvas");
const video = document.getElementById("camera-video");
const handOverlay = document.getElementById("hand-overlay");
const handCtx = handOverlay.getContext("2d");

const ui = {
  state: document.getElementById("state-label"),
  input: document.getElementById("input-label"),
  gesture: document.getElementById("gesture-label"),
  gestureIcon: document.getElementById("gesture-icon"),
  gestureSubtext: document.getElementById("gesture-subtext"),
  holdRing: document.getElementById("hold-ring"),
  result: document.getElementById("result-label"),
  resultOverlay: document.getElementById("result-overlay"),
  resultBadge: document.getElementById("result-badge"),
  resultTitle: document.getElementById("result-title"),
  resultText: document.getElementById("result-text"),
  resultAction: document.getElementById("result-action-button"),
  currentInstruction: document.getElementById("current-instruction"),
  targetReticle: document.getElementById("target-reticle"),
  cameraCard: document.getElementById("camera-card"),
  cameraMessage: document.getElementById("camera-message"),
  cameraStatusDot: document.getElementById("camera-status-dot"),
  cameraStatusText: document.getElementById("camera-status-text"),
  cameraRetry: document.getElementById("camera-retry-button"),
  meterX: document.getElementById("meter-x"),
  meterY: document.getElementById("meter-y"),
  primary: document.getElementById("primary-button"),
  reset: document.getElementById("reset-button"),
  celebrationOverlay: document.getElementById("celebration-overlay"),
  celebrationPlayer: document.getElementById("celebration-player"),
  scoreSummary: document.getElementById("score-summary"),
  scoreElapsed: document.getElementById("score-elapsed"),
  scoreRate: document.getElementById("score-rate"),
  scoreLast: document.getElementById("score-last"),
  scoreLog: document.getElementById("score-log"),
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
  CELEBRATING: "celebrating",
  RESETTING: "resetting",
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
  [STATES.CELEBRATING]: "全部收集",
  [STATES.RESETTING]: "准备重置",
};

const FLOW_STEPS = ["wait", "calibrate", "control", "drop", "result"];
const STEP_BY_STATE = {
  [STATES.IDLE]: "wait",
  [STATES.CONTROLLING]: "control",
  [STATES.DROPPING]: "drop",
  [STATES.GRABBING]: "drop",
  [STATES.LIFTING]: "drop",
  [STATES.RETURNING]: "drop",
  [STATES.RELEASING]: "result",
  [STATES.RESULT]: "result",
  [STATES.CELEBRATING]: "result",
  [STATES.RESETTING]: "wait",
};

const WORLD = {
  xMin: -2.85,
  xMax: 2.85,
  zMin: -1.7,
  zMax: 1.75,
  floorY: 0,
  clawHomeY: 3.05,
  clawDropY: 0.92,
  railY: 4.02,
  exit: new THREE.Vector3(-2.9, 0.1, 2.02),
};

const OUTLET_BOUNDS = {
  centerX: WORLD.exit.x,
  centerZ: WORLD.exit.z,
  minX: WORLD.exit.x - 0.58,
  maxX: WORLD.exit.x + 0.58,
  minZ: WORLD.exit.z - 0.32,
  maxZ: WORLD.exit.z + 0.36,
  floorY: 0.18,
  releaseClawY: 1.68,
  releasePauseMs: 130,
};

const OUTLET_DROP = {
  gravity: 7.2,
  initialVelocityY: -0.08,
  lateralSpring: 13,
  lateralDamping: 0.72,
  nearFloorDamping: 0.42,
  restitution: 0.08,
  settleSpeed: 0.055,
  settleMs: 90,
  maxDt: 1 / 30,
};

const input = {
  rawX: 0.5,
  rawY: 0.5,
  x: 0.5,
  y: 0.5,
  openPalm: false,
  fist: false,
};

const game = {
  state: STATES.IDLE,
  stateTime: 0,
  lastTime: performance.now(),
  inputMode: "loading",
  handPresent: false,
  palmOpenMs: 0,
  fistMs: 0,
  clawContactMs: 0,
  calibration: null,
  result: "未开始",
  grabbedPrize: null,
  releaseStarted: false,
  releaseReadyMs: 0,
  demoActive: false,
  demoTime: 0,
  demoTarget: null,
  demoTargetPrizeId: null,
  round: 0,
  sessionActive: false,
  sessionElapsedMs: 0,
  currentAttemptStartedMs: 0,
  attempts: [],
  collectedPrizeIds: new Set(),
  hasCelebratedCollection: false,
  celebrationCount: 0,
  roundSeed: 0,
  roundSignature: "",
  generatedRoundIndex: 0,
  debugPrizes: false,
  awaitFistRelease: false,
  cameraStatus: "loading",
  cameraProblem: "",
  lastHandSeenAt: 0,
  resultFlashMs: 0,
  lastCarryMaxRelativeDelta: 0,
  lastReleaseStats: null,
  lastPrewarmStats: null,
};

const claw = {
  x: 0,
  y: WORLD.clawHomeY,
  z: 0,
  targetX: 0,
  targetY: WORLD.clawHomeY,
  targetZ: 0,
  closed: 0,
};

const PRIZE_BODY_OFFSET_Y = 0.42;
const PRIZE_BODY_HALF = { x: 0.28, y: 0.36, z: 0.26 };
const CLAW_CONTACT_SKIN = 0.025;
const CLAW_SIDE_GRIP_Y = 0.13;
const CLAW_GRIP_CLOSED = 0.48;
const HELD_CLAW_LIFT_SPEED = 0.00105;
const HELD_CLAW_TRAVEL_SPEED = 0.00145;
const CARRY_RELATIVE_WARN_THRESHOLD = 0.035;
const DEMO_TARGET = { x: 0.18, z: 1.05 };
const CELEBRATION_SRC_DEFAULT = "/animations/celebration-confetti.json";
const URL_PARAMS = new URLSearchParams(window.location.search);
const DEBUG_SEED = URL_PARAMS.has("seed") ? normalizeSeed(URL_PARAMS.get("seed")) : null;
const PHYSICS_TUNING = {
  toy: {
    massDensity: 3.4,
    minMass: 1.5,
    maxMass: 4,
    linearDamping: 0.72,
    angularDamping: 0.88,
    sleepSpeedLimit: 0.035,
    sleepTimeLimit: 0.35,
    colliderScale: { x: 0.86, y: 0.88, z: 0.86 },
    settleLinearThreshold: 0.08,
    settleAngularThreshold: 0.14,
  },
  contact: {
    prizePrizeFriction: 0.9,
    prizeWallFriction: 1,
    prizeClawFriction: 0.25,
    restitution: 0,
  },
  claw: {
    maxSensorSpeed: 8,
    closeApproachSpeed: 0.0036,
    gripCloseSpeed: 0.00155,
    releaseHoldCloseSpeed: 0.0012,
  },
  simulation: {
    fixedTimeStep: 1 / 60,
    maxSubSteps: 4,
    maxFrameDt: 1 / 30,
    prewarmSteps: 90,
  },
};
const physics = {
  world: null,
  prizeMaterial: null,
  wallMaterial: null,
  clawMaterial: null,
  clawBody: null,
  clawBodies: [],
  fixedTimeStep: PHYSICS_TUNING.simulation.fixedTimeStep,
  maxSubSteps: PHYSICS_TUNING.simulation.maxSubSteps,
};

const positionAudit = {
  active: false,
  frame: 0,
  frames: [],
  samples: 0,
  stateSwitches: 0,
  lastToyState: null,
  minRelativeX: Infinity,
  maxRelativeX: -Infinity,
  minRelativeY: Infinity,
  maxRelativeY: -Infinity,
  maxRelativeDelta: 0,
  maxSourcesPerFrame: 0,
  invalidOwnerCount: 0,
};

let celebrationPlayer = null;
let celebrationSource = CELEBRATION_SRC_DEFAULT;
let celebrationLoadedSource = "";
let celebrationRunId = 0;
let celebrationPendingResolve = null;
const celebrationTimers = new Set();
const prizeTemplateCache = new Map();

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f16);
scene.fog = new THREE.Fog(0x0b0f16, 8, 17);

const camera = new THREE.PerspectiveCamera(37, 1, 0.1, 60);
camera.position.set(0, 3.35, 8.9);

const loader = new GLTFLoader();
const sceneObjects = {
  root: new THREE.Group(),
  machine: new THREE.Group(),
  claw: new THREE.Group(),
  cable: null,
  fingers: [],
  prizes: [],
  prizeModels: [],
  effects: [],
  titleSprite: null,
  messageSprite: null,
  exitGlow: null,
};

const mats = {
  shell: new THREE.MeshStandardMaterial({ color: 0xf8b637, roughness: 0.42, metalness: 0.08 }),
  shellDark: new THREE.MeshStandardMaterial({ color: 0x32170e, roughness: 0.55, metalness: 0.1 }),
  trim: new THREE.MeshStandardMaterial({ color: 0xffd776, roughness: 0.35, metalness: 0.18 }),
  glass: new THREE.MeshPhysicalMaterial({
    color: 0xb9e8ff,
    transparent: true,
    opacity: 0.09,
    roughness: 0.08,
    metalness: 0,
    transmission: 0.28,
    depthWrite: false,
  }),
  floor: new THREE.MeshStandardMaterial({ color: 0x111820, roughness: 0.78, metalness: 0.05 }),
  rail: new THREE.MeshStandardMaterial({ color: 0xffe3a4, roughness: 0.28, metalness: 0.32 }),
  clawBody: new THREE.MeshStandardMaterial({ color: 0x3b2416, roughness: 0.45, metalness: 0.18 }),
  clawMetal: new THREE.MeshStandardMaterial({ color: 0xe9edf0, roughness: 0.24, metalness: 0.42 }),
  mint: new THREE.MeshStandardMaterial({ color: 0x55efc4, roughness: 0.35, metalness: 0.08, emissive: 0x0b5a46 }),
  outletRim: new THREE.MeshStandardMaterial({ color: 0xe7c781, roughness: 0.44, metalness: 0.16 }),
  outletInside: new THREE.MeshStandardMaterial({ color: 0x0b0a08, roughness: 0.86, metalness: 0.02 }),
  outletLip: new THREE.MeshStandardMaterial({ color: 0x1f1610, roughness: 0.68, metalness: 0.06 }),
  red: new THREE.MeshStandardMaterial({ color: 0xff5f7e, roughness: 0.5, metalness: 0.05, emissive: 0x45111c }),
  shadow: new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.34 }),
};

let handLandmarker = null;
let cameraStarted = false;
let animationFrameId = 0;

scene.add(sceneObjects.root);
sceneObjects.root.add(sceneObjects.machine);
buildLights();
buildMachine();
buildClaw();
initPhysics();
game.debugPrizes = URL_PARAMS.get("debugPrizes") === "1";
resizeRenderer();
window.addEventListener("resize", resizeRenderer);

function buildLights() {
  scene.add(new THREE.HemisphereLight(0xb7e6ff, 0x1b120d, 1.6));

  const key = new THREE.DirectionalLight(0xffffff, 2.3);
  key.position.set(2.8, 6.2, 4.6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 16;
  key.shadow.camera.left = -6;
  key.shadow.camera.right = 6;
  key.shadow.camera.top = 6;
  key.shadow.camera.bottom = -6;
  scene.add(key);

  const warm = new THREE.PointLight(0xffc857, 2.4, 8);
  warm.position.set(-3.2, 2.6, 2.4);
  scene.add(warm);

  const cyan = new THREE.PointLight(0x55efc4, 1.8, 7);
  cyan.position.set(3.2, 2.3, 1.2);
  scene.add(cyan);
}

function buildMachine() {
  const m = sceneObjects.machine;

  addBox(m, [7.2, 0.28, 5.0], [0, -0.15, 0.2], mats.shellDark, true);
  addBox(m, [7.7, 0.42, 0.42], [0, 4.18, -1.98], mats.shell, true);
  addBox(m, [0.42, 4.35, 0.42], [-3.75, 1.92, -1.98], mats.shell, true);
  addBox(m, [0.42, 4.35, 0.42], [3.75, 1.92, -1.98], mats.shell, true);
  addBox(m, [7.7, 0.42, 0.42], [0, -0.05, -1.98], mats.shell, true);
  addBox(m, [7.7, 4.65, 0.18], [0, 2.0, -2.2], mats.shellDark, true);

  addBox(m, [7.55, 0.24, 0.32], [0, 3.66, 2.08], mats.shell, true);
  addBox(m, [0.24, 3.7, 0.32], [-3.62, 1.82, 2.08], mats.shell, true);
  addBox(m, [0.24, 3.7, 0.32], [3.62, 1.82, 2.08], mats.shell, true);

  addBox(m, [6.8, 0.08, 4.1], [0, WORLD.floorY, 0], mats.floor, true);
  addBox(m, [5.5, 0.16, 0.76], [0, 0.06, -1.05], mats.floor, true);
  addBox(m, [5.3, 0.07, 0.68], [0, 0.02, -0.24], mats.floor, true);
  addBox(m, [6.2, 0.12, 0.12], [0, WORLD.railY, 0.05], mats.rail, true);
  addBox(m, [0.16, 0.16, 3.8], [-3.08, WORLD.railY - 0.04, 0], mats.rail, true);
  addBox(m, [0.16, 0.16, 3.8], [3.08, WORLD.railY - 0.04, 0], mats.rail, true);

  addGlassPanel([0, 2.0, 2.0], [6.85, 3.35, 0.03]);
  addGlassPanel([-3.45, 2.0, 0], [0.025, 3.25, 3.84]);
  addGlassPanel([3.45, 2.0, 0], [0.025, 3.25, 3.84]);

  addBox(m, [5.0, 0.38, 0.22], [0, 4.5, 2.12], mats.shellDark, false);
  sceneObjects.titleSprite = makeTextSprite("LUCKY HAND CLAW", {
    fontSize: 64,
    color: "#fff7e6",
    bg: "rgba(20, 10, 8, 0)",
    width: 760,
    height: 130,
  });
  sceneObjects.titleSprite.position.set(0, 4.51, 2.0);
  sceneObjects.titleSprite.scale.set(3.7, 0.62, 1);
  m.add(sceneObjects.titleSprite);

  for (let i = 0; i < 14; i += 1) {
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 14, 14),
      i % 2 ? mats.red : mats.mint,
    );
    bulb.position.set(-2.85 + i * 0.44, 4.52, 2.23);
    m.add(bulb);
  }

  const exit = new THREE.Group();
  exit.position.copy(WORLD.exit);
  addBox(exit, [1.58, 0.2, 0.88], [0, 0.0, 0], mats.outletLip, true);
  const outletFloor = addBox(exit, [1.22, 0.08, 0.64], [0, 0.13, 0.01], mats.outletInside, true);
  outletFloor.rotation.x = -0.08;
  addBox(exit, [1.66, 0.13, 0.12], [0, 0.35, 0.37], mats.outletRim, true);
  addBox(exit, [1.66, 0.13, 0.12], [0, 0.35, -0.37], mats.outletRim, true);
  addBox(exit, [0.13, 0.38, 0.78], [-0.84, 0.2, 0], mats.outletRim, true);
  addBox(exit, [0.13, 0.38, 0.78], [0.84, 0.2, 0], mats.outletRim, true);
  addBox(exit, [1.28, 0.18, 0.08], [0, 0.25, 0.43], mats.outletLip, true);
  addBox(exit, [1.04, 0.05, 0.42], [0, 0.3, 0.03], mats.shellDark, false);
  sceneObjects.exitGlow = new THREE.PointLight(0xffd58a, 0.52, 1.8);
  sceneObjects.exitGlow.position.set(0, 0.34, 0.18);
  exit.add(sceneObjects.exitGlow);
  m.add(exit);

  const groundShadow = new THREE.Mesh(new THREE.CircleGeometry(4.6, 48), mats.shadow);
  groundShadow.rotation.x = -Math.PI / 2;
  groundShadow.position.set(0, -0.13, 0.15);
  m.add(groundShadow);
}

function addGlassPanel(position, size) {
  const glass = addBox(sceneObjects.machine, size, position, mats.glass, false);
  glass.renderOrder = 2;
  return glass;
}

function buildClaw() {
  const group = sceneObjects.claw;
  sceneObjects.machine.add(group);

  const hub = addBox(group, [0.46, 0.28, 0.46], [0, 0, 0], mats.clawBody, true);
  hub.name = "claw-hub";
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.18, 24), mats.rail);
  collar.position.y = 0.22;
  collar.castShadow = true;
  group.add(collar);

  sceneObjects.cable = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.035, 1, 12),
    mats.rail,
  );
  sceneObjects.cable.castShadow = true;
  sceneObjects.machine.add(sceneObjects.cable);

  for (let i = 0; i < 3; i += 1) {
    const finger = new THREE.Group();
    const angle = i * (Math.PI * 2 / 3) + Math.PI / 6;
    finger.userData.baseAngle = angle;

    addRod(finger, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.22, -0.38, 0), 0.034, mats.clawMetal);
    addRod(finger, new THREE.Vector3(0.22, -0.38, 0), new THREE.Vector3(0.1, -0.7, 0), 0.034, mats.clawMetal);
    addRod(finger, new THREE.Vector3(0.1, -0.7, 0), new THREE.Vector3(-0.05, -0.77, 0), 0.03, mats.clawMetal);
    addJoint(finger, 0, 0, 0, 0.052);
    addJoint(finger, 0.22, -0.38, 0, 0.05);

    finger.rotation.y = angle;
    finger.position.set(Math.cos(angle) * 0.16, -0.12, Math.sin(angle) * 0.16);
    group.add(finger);
    sceneObjects.fingers.push(finger);
  }
}

function addRod(parent, start, end, radius, material) {
  const direction = new THREE.Vector3().subVectors(end, start);
  const length = direction.length();
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 14), material);
  mesh.position.copy(start).addScaledVector(direction, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addJoint(parent, x, y, z, radius) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12), mats.rail);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

function buildPrizeRound({ resetProgress = true } = {}) {
  clearCurrentPrizes();
  if (resetProgress) {
    game.collectedPrizeIds.clear();
    game.hasCelebratedCollection = false;
    game.grabbedPrize = null;
    game.demoTarget = null;
    game.demoTargetPrizeId = null;
  }

  const seed = getNextRoundSeed();
  const round = createPrizeRound({
    seed,
    previousSignature: game.roundSignature,
  });
  game.roundSeed = round.seed;
  game.roundSignature = round.signature;
  if (import.meta.env.DEV) console.info("Prize round seed:", round.seed);

  round.prizes.forEach((roundPrize, index) => {
    const definition = roundPrize.definition;
    const mesh = createPlushPlaceholder(index, roundPrize.colorVariant);
    applyRoundTransform(mesh, roundPrize.transform);
    sceneObjects.machine.add(mesh);

    const bodyHalf = getPrizeBodyHalf(definition, roundPrize.transform.scale);
    const prize = {
      id: roundPrize.instanceId,
      instanceId: roundPrize.instanceId,
      definitionId: definition.id,
      definition,
      object: mesh,
      visual: mesh,
      state: "available",
      home: mesh.position.clone(),
      spawnTransform: roundPrize.transform,
      colorVariant: roundPrize.colorVariant,
      radius: definition.grabRadius * roundPrize.transform.scale,
      grabRadius: definition.grabRadius * roundPrize.transform.scale,
      grabOffset: new CANNON.Vec3(
        definition.grabOffset[0] * roundPrize.transform.scale,
        definition.grabOffset[1] * roundPrize.transform.scale,
        definition.grabOffset[2] * roundPrize.transform.scale,
      ),
      mass: getPrizeMass(bodyHalf),
      bodyHalf,
      grabbed: false,
      collected: false,
      positionOwner: "layout",
      wobble: 0,
      body: null,
      bodyOffsetY: bodyHalf.y,
      holdSpin: 0,
      holdOffset: null,
      holdBlend: 0,
      holdQuaternion: null,
      carryVelocity: new CANNON.Vec3(0, 0, 0),
      carryStartOffset: null,
      carryMaxRelativeDelta: 0,
      gripConstraints: [],
      debugHelpers: [],
    };
    createPrizeBody(prize);
    if (game.debugPrizes) addPrizeDebugHelpers(prize);
    sceneObjects.prizes.push(prize);
  });

  prewarmPrizePhysics();
  loadPrizeModelsForRound(round.seed);
  preloadPrizeTemplates();
  ui.cameraMessage.textContent = "正在准备奖品，新一轮布局已生成。";
}

function createPlushPlaceholder(index, colorVariant = null) {
  const fallbackColors = [0xff9f43, 0x55efc4, 0x73d2ff, 0xff5f7e, 0xd5a7ff, 0xffd776];
  const color = colorVariant && COLOR_VARIANTS[colorVariant]
    ? new THREE.Color(COLOR_VARIANTS[colorVariant]).getHex()
    : fallbackColors[index % fallbackColors.length];
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.02 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.7 });
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.48, 0.38), material);
  body.position.y = 0.38;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.38, 0.38), material);
  head.position.y = 0.76;
  const earA = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.12), material);
  earA.position.set(-0.18, 1.02, 0);
  const earB = earA.clone();
  earB.position.x = 0.18;
  const eyeA = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.04, 0.02), dark);
  eyeA.position.set(-0.09, 0.8, 0.2);
  const eyeB = eyeA.clone();
  eyeB.position.x = 0.09;
  const footA = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.1, 0.22), material);
  footA.position.set(-0.14, 0.08, 0.08);
  const footB = footA.clone();
  footB.position.x = 0.14;
  [body, head, earA, earB, eyeA, eyeB, footA, footB].forEach((part) => {
    part.castShadow = true;
    part.receiveShadow = true;
    group.add(part);
  });
  return group;
}

async function loadPrizeModelsForRound(seed) {
  const prizes = [...sceneObjects.prizes];
  const results = await Promise.allSettled(prizes.map(async (prize) => {
    const template = await loadPrizeTemplate(prize.definition);
    if (game.roundSeed !== seed || !sceneObjects.prizes.includes(prize) || prize.collected) return;
    const model = template.clone(true);
    preparePrizeInstanceMaterials(model, prize);
    applyRoundTransform(model, prize.spawnTransform);
    sceneObjects.machine.add(model);
    sceneObjects.machine.remove(prize.object);
    disposeObject(prize.object, { disposeShared: true });
    prize.object = model;
    prize.visual = model;
    syncPrizeVisual(prize, "model-load");
  }));

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.warn("Prize model failed, using placeholder fallback", {
        definitionId: prizes[index]?.definitionId,
        error: result.reason?.message || result.reason,
      });
    }
  });
}

async function loadPrizeTemplate(definition) {
  if (!prizeTemplateCache.has(definition.id)) {
    const promise = loader.loadAsync(definition.url).then((gltf) => {
      const wrapper = new THREE.Group();
      const model = gltf.scene;
      wrapper.add(model);
      normalizeModel(model, definition);
      model.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          if (child.material) {
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach((material) => {
              if ("metalness" in material) material.metalness = Math.min(material.metalness || 0, 0.05);
              if ("roughness" in material) material.roughness = Math.max(material.roughness || 0.7, 0.82);
              if ("envMapIntensity" in material) material.envMapIntensity = Math.min(material.envMapIntensity || 1, 0.55);
            });
          }
        }
      });
      return wrapper;
    }).catch((error) => {
      prizeTemplateCache.delete(definition.id);
      throw error;
    });
    prizeTemplateCache.set(definition.id, promise);
  }
  return prizeTemplateCache.get(definition.id);
}

function normalizeModel(model, definition) {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const scale = (definition.baseScale || 1) * definition.targetHeight / Math.max(size.y, 0.001);
  model.scale.multiplyScalar(scale);
  model.updateMatrixWorld(true);

  const nextBox = new THREE.Box3().setFromObject(model);
  const center = nextBox.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= nextBox.min.y;
  model.position.y += definition.groundOffset || 0;

  if (definition.rotationOffset) {
    model.rotation.x += definition.rotationOffset[0];
    model.rotation.y += definition.rotationOffset[1];
    model.rotation.z += definition.rotationOffset[2];
  }
}

function preparePrizeInstanceMaterials(model, prize) {
  if (!prize.colorVariant || !COLOR_VARIANTS[prize.colorVariant]) return;
  const color = new THREE.Color(COLOR_VARIANTS[prize.colorVariant]);
  model.traverse((child) => {
    if (!child.isMesh || !child.material || !canRecolorMaterial(child)) return;
    if (Array.isArray(child.material)) {
      child.material = child.material.map((material) => recolorMaterial(material, color));
    } else {
      child.material = recolorMaterial(child.material, color);
    }
  });
}

function canRecolorMaterial(mesh) {
  const name = `${mesh.name || ""} ${mesh.material?.name || ""}`.toLowerCase();
  if (/eye|mouth|nose|wheel|black|glass|metal/.test(name)) return false;
  return /body|fur|main|box|gift|material/.test(name);
}

function recolorMaterial(material, color) {
  const cloned = material.clone();
  if (cloned.color) cloned.color.copy(color);
  if ("metalness" in cloned) cloned.metalness = 0;
  if ("roughness" in cloned) cloned.roughness = Math.max(cloned.roughness || 0.7, 0.86);
  cloned.userData = { ...(cloned.userData || {}), instanceMaterial: true };
  return cloned;
}

function applyRoundTransform(object, transform) {
  object.position.set(transform.position.x, transform.position.y, transform.position.z);
  object.rotation.set(transform.rotation.x, transform.rotation.y, transform.rotation.z);
  object.scale.setScalar(transform.scale);
}

function getPrizeBodyHalf(definition, scale) {
  const size = definition.collider.size;
  const colliderScale = PHYSICS_TUNING.toy.colliderScale;
  return new CANNON.Vec3(
    Math.max(0.12, size[0] * scale * colliderScale.x * 0.5),
    Math.max(0.12, size[1] * scale * colliderScale.y * 0.5),
    Math.max(0.12, size[2] * scale * colliderScale.z * 0.5),
  );
}

function getPrizeMass(bodyHalf) {
  const volume = Math.max(0.001, bodyHalf.x * 2 * bodyHalf.y * 2 * bodyHalf.z * 2);
  return clamp(
    volume * PHYSICS_TUNING.toy.massDensity,
    PHYSICS_TUNING.toy.minMass,
    PHYSICS_TUNING.toy.maxMass,
  );
}

function getNextRoundSeed() {
  if (DEBUG_SEED !== null) {
    const seed = (DEBUG_SEED + game.generatedRoundIndex) >>> 0;
    game.generatedRoundIndex += 1;
    return seed;
  }
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] >>> 0;
}

function clearCurrentPrizes() {
  sceneObjects.prizes.forEach((prize) => {
    clearPrizeGrip(prize);
    if (prize.body && physics.world) physics.world.removeBody(prize.body);
    prize.debugHelpers?.forEach((helper) => sceneObjects.machine.remove(helper));
    sceneObjects.machine.remove(prize.object);
    disposeObject(prize.object, { disposeShared: false });
  });
  sceneObjects.prizes = [];
}

function disposeObject(object, { disposeShared = false } = {}) {
  object?.traverse?.((child) => {
    if (!child.isMesh) return;
    if (disposeShared) child.geometry?.dispose?.();
    if (!child.material) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    if (disposeShared || materials.some((material) => material.userData?.instanceMaterial)) {
      materials.forEach((material) => material.dispose?.());
    }
  });
}

function preloadPrizeTemplates() {
  const schedule = window.requestIdleCallback || ((callback) => window.setTimeout(callback, 600));
  schedule(() => {
    sceneObjects.prizes.slice(0, 4).forEach((prize) => {
      loadPrizeTemplate(prize.definition).catch(() => {});
    });
  });
}

function addBox(parent, size, position, material, castShadow) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
  mesh.position.set(position[0], position[1], position[2]);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function initPhysics() {
  physics.world = new CANNON.World({
    gravity: new CANNON.Vec3(0, -9.82, 0),
  });
  physics.world.allowSleep = true;
  physics.world.broadphase = new CANNON.SAPBroadphase(physics.world);
  physics.world.solver.iterations = 9;
  physics.world.solver.tolerance = 0.001;

  physics.prizeMaterial = new CANNON.Material("soft-prize");
  physics.wallMaterial = new CANNON.Material("cabinet");
  physics.clawMaterial = new CANNON.Material("claw");

  physics.world.addContactMaterial(new CANNON.ContactMaterial(
    physics.prizeMaterial,
    physics.prizeMaterial,
    {
      friction: PHYSICS_TUNING.contact.prizePrizeFriction,
      restitution: PHYSICS_TUNING.contact.restitution,
      contactEquationStiffness: 7e6,
    },
  ));
  physics.world.addContactMaterial(new CANNON.ContactMaterial(
    physics.prizeMaterial,
    physics.wallMaterial,
    {
      friction: PHYSICS_TUNING.contact.prizeWallFriction,
      restitution: PHYSICS_TUNING.contact.restitution,
    },
  ));
  physics.world.addContactMaterial(new CANNON.ContactMaterial(
    physics.prizeMaterial,
    physics.clawMaterial,
    {
      friction: PHYSICS_TUNING.contact.prizeClawFriction,
      restitution: PHYSICS_TUNING.contact.restitution,
    },
  ));

  addStaticBody([0, -0.08, 0.05], [3.45, 0.08, 2.2]);
  addStaticBody([0, 0.08, -1.05], [2.75, 0.08, 0.38]);
  addStaticBody([0, 0.035, -0.24], [2.65, 0.035, 0.34]);
  addStaticBody([WORLD.xMin - 0.28, 0.72, 0.05], [0.1, 0.72, 2.1]);
  addStaticBody([WORLD.xMax + 0.28, 0.72, 0.05], [0.1, 0.72, 2.1]);
  addStaticBody([0, 0.72, WORLD.zMin - 0.26], [3.35, 0.72, 0.1]);
  addStaticBody([0, 0.72, WORLD.zMax + 0.22], [3.35, 0.72, 0.1]);
  addStaticBody([OUTLET_BOUNDS.centerX, OUTLET_BOUNDS.floorY - 0.04, OUTLET_BOUNDS.centerZ], [0.72, 0.04, 0.48]);
  addStaticBody([OUTLET_BOUNDS.minX - 0.06, OUTLET_BOUNDS.floorY + 0.22, OUTLET_BOUNDS.centerZ], [0.06, 0.24, 0.5]);
  addStaticBody([OUTLET_BOUNDS.maxX + 0.06, OUTLET_BOUNDS.floorY + 0.22, OUTLET_BOUNDS.centerZ], [0.06, 0.24, 0.5]);
  addStaticBody([OUTLET_BOUNDS.centerX, OUTLET_BOUNDS.floorY + 0.24, OUTLET_BOUNDS.minZ - 0.06], [0.72, 0.24, 0.06]);

  physics.clawBody = createClawCollider(0.15, "hub");
  for (let i = 0; i < 3; i += 1) {
    createClawCollider(0.16, `knuckle-${i}`);
    createClawCollider(0.16, `tip-${i}`);
  }
  syncClawCollider(16, true);
}

function addStaticBody(center, halfExtents) {
  const body = new CANNON.Body({ mass: 0, material: physics.wallMaterial });
  body.addShape(new CANNON.Box(new CANNON.Vec3(halfExtents[0], halfExtents[1], halfExtents[2])));
  body.position.set(center[0], center[1], center[2]);
  physics.world.addBody(body);
  return body;
}

function createClawCollider(radius, role) {
  const body = new CANNON.Body({
    mass: 0,
    type: CANNON.Body.KINEMATIC,
    material: physics.clawMaterial,
  });
  body.addShape(new CANNON.Sphere(radius));
  body.collisionResponse = false;
  body.userData = { role, radius, sensor: true, initialized: false };
  physics.world.addBody(body);
  physics.clawBodies.push(body);
  return body;
}

function createPrizeBody(prize) {
  if (!physics.world) return null;
  const bodyHalf = prize.bodyHalf || new CANNON.Vec3(PRIZE_BODY_HALF.x, PRIZE_BODY_HALF.y, PRIZE_BODY_HALF.z);
  const mass = prize.mass || getPrizeMass(bodyHalf);

  const body = new CANNON.Body({
    mass,
    material: physics.prizeMaterial,
    linearDamping: PHYSICS_TUNING.toy.linearDamping,
    angularDamping: PHYSICS_TUNING.toy.angularDamping,
    allowSleep: true,
    sleepSpeedLimit: PHYSICS_TUNING.toy.sleepSpeedLimit,
    sleepTimeLimit: PHYSICS_TUNING.toy.sleepTimeLimit,
  });
  body.addShape(new CANNON.Box(bodyHalf));
  body.position.set(prize.home.x, prize.home.y + bodyHalf.y, prize.home.z);
  body.quaternion.setFromEuler(
    prize.spawnTransform?.rotation?.x || 0,
    prize.spawnTransform?.rotation?.y || 0,
    prize.spawnTransform?.rotation?.z || 0,
  );
  physics.world.addBody(body);

  prize.body = body;
  prize.mass = mass;
  prize.bodyOffsetY = bodyHalf.y;
  prize.bodyHalf = bodyHalf;
  prize.holdSpin = 0;
  prize.positionOwner = "layout";
  syncPrizeVisual(prize);
  return body;
}

function syncPrizeVisual(prize, source = prize.positionOwner === "claw" ? "claw-carry" : "physics-sync") {
  if (!prize.body) return;
  prize.object.position.set(
    prize.body.position.x,
    prize.body.position.y - (prize.bodyOffsetY || 0),
    prize.body.position.z,
  );
  prize.object.quaternion.set(
    prize.body.quaternion.x,
    prize.body.quaternion.y,
    prize.body.quaternion.z,
    prize.body.quaternion.w,
  );
  updatePrizeDebugHelpers(prize);
  recordPrizePositionWrite(source, prize);
}

function addPrizeDebugHelpers(prize) {
  const radius = new THREE.Mesh(
    new THREE.SphereGeometry(prize.grabRadius, 18, 12),
    new THREE.MeshBasicMaterial({ color: 0x55efc4, wireframe: true, transparent: true, opacity: 0.38 }),
  );
  const anchor = new THREE.Mesh(
    new THREE.SphereGeometry(0.055, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xffc857 }),
  );
  radius.userData.debugRole = "grab-radius";
  anchor.userData.debugRole = "grab-anchor";
  sceneObjects.machine.add(radius);
  sceneObjects.machine.add(anchor);
  prize.debugHelpers.push(radius, anchor);
  updatePrizeDebugHelpers(prize);
}

function updatePrizeDebugHelpers(prize) {
  if (!prize.debugHelpers?.length || !prize.body) return;
  prize.debugHelpers.forEach((helper) => {
    if (helper.userData.debugRole === "grab-radius") {
      helper.position.set(prize.body.position.x, prize.body.position.y, prize.body.position.z);
    } else if (helper.userData.debugRole === "grab-anchor") {
      helper.position.set(
        prize.body.position.x + prize.grabOffset.x,
        prize.body.position.y + prize.grabOffset.y,
        prize.body.position.z + prize.grabOffset.z,
      );
    }
  });
}

function resetPositionAudit() {
  positionAudit.frame = 0;
  positionAudit.frames = [];
  positionAudit.samples = 0;
  positionAudit.stateSwitches = 0;
  positionAudit.lastToyState = null;
  positionAudit.minRelativeX = Infinity;
  positionAudit.maxRelativeX = -Infinity;
  positionAudit.minRelativeY = Infinity;
  positionAudit.maxRelativeY = -Infinity;
  positionAudit.maxRelativeDelta = 0;
  positionAudit.maxSourcesPerFrame = 0;
  positionAudit.invalidOwnerCount = 0;
}

function beginAuditFrame() {
  positionAudit.frame += 1;
}

function recordPrizePositionWrite(source, prize) {
  if (!positionAudit.active || !game.grabbedPrize || prize !== game.grabbedPrize) return;
  const carryingStage = [STATES.LIFTING, STATES.RETURNING].includes(game.state) || prize.positionOwner === "claw";
  if (!carryingStage) return;

  let frame = positionAudit.frames.at(-1);
  if (!frame || frame.frame !== positionAudit.frame) {
    frame = {
      frame: positionAudit.frame,
      sources: [],
      writeCount: 0,
      toyState: prize.positionOwner,
      gameStage: game.state,
      x: 0,
      y: 0,
      z: 0,
      relativeX: 0,
      relativeY: 0,
      relativeZ: 0,
      relativeDelta: 0,
      sampled: false,
    };
    positionAudit.frames.push(frame);
  }

  frame.writeCount += 1;
  if (!frame.sources.includes(source)) frame.sources.push(source);
  positionAudit.maxSourcesPerFrame = Math.max(positionAudit.maxSourcesPerFrame, frame.sources.length);
  if (prize.positionOwner !== "claw") positionAudit.invalidOwnerCount += 1;

  const relativeX = prize.body.position.x - claw.x;
  const relativeY = prize.body.position.y - claw.y;
  const relativeZ = prize.body.position.z - claw.z;
  const start = prize.carryStartOffset || new CANNON.Vec3(relativeX, relativeY, relativeZ);
  const relativeDelta = Math.hypot(relativeX - start.x, relativeY - start.y, relativeZ - start.z);

  frame.toyState = prize.positionOwner;
  frame.gameStage = game.state;
  frame.x = prize.body.position.x;
  frame.y = prize.body.position.y;
  frame.z = prize.body.position.z;
  frame.relativeX = relativeX;
  frame.relativeY = relativeY;
  frame.relativeZ = relativeZ;
  frame.relativeDelta = relativeDelta;

  if (!frame.sampled) {
    frame.sampled = true;
    positionAudit.samples += 1;
    if (positionAudit.lastToyState && positionAudit.lastToyState !== prize.positionOwner) {
      positionAudit.stateSwitches += 1;
    }
    positionAudit.lastToyState = prize.positionOwner;
  }
  positionAudit.minRelativeX = Math.min(positionAudit.minRelativeX, relativeX);
  positionAudit.maxRelativeX = Math.max(positionAudit.maxRelativeX, relativeX);
  positionAudit.minRelativeY = Math.min(positionAudit.minRelativeY, relativeY);
  positionAudit.maxRelativeY = Math.max(positionAudit.maxRelativeY, relativeY);
  positionAudit.maxRelativeDelta = Math.max(positionAudit.maxRelativeDelta, relativeDelta);
}

function formatAuditFrame(frame) {
  return {
    frame: frame.frame,
    sources: [...frame.sources],
    sourceCount: frame.sources.length,
    writeCount: frame.writeCount,
    toyState: frame.toyState,
    gameStage: frame.gameStage,
    x: Number(frame.x.toFixed(6)),
    y: Number(frame.y.toFixed(6)),
    z: Number(frame.z.toFixed(6)),
    relativeX: Number(frame.relativeX.toFixed(6)),
    relativeY: Number(frame.relativeY.toFixed(6)),
    relativeZ: Number(frame.relativeZ.toFixed(6)),
    relativeDelta: Number(frame.relativeDelta.toFixed(6)),
  };
}

function getPositionAuditSnapshot({ includeFrames = false } = {}) {
  const multiSourceFrames = positionAudit.frames
    .filter((frame) => frame.sources.length > 1)
    .slice(0, 12)
    .map(formatAuditFrame);

  const snapshot = {
    active: positionAudit.active,
    samples: positionAudit.samples,
    minRelativeX: Number((Number.isFinite(positionAudit.minRelativeX) ? positionAudit.minRelativeX : 0).toFixed(6)),
    maxRelativeX: Number((Number.isFinite(positionAudit.maxRelativeX) ? positionAudit.maxRelativeX : 0).toFixed(6)),
    minRelativeY: Number((Number.isFinite(positionAudit.minRelativeY) ? positionAudit.minRelativeY : 0).toFixed(6)),
    maxRelativeY: Number((Number.isFinite(positionAudit.maxRelativeY) ? positionAudit.maxRelativeY : 0).toFixed(6)),
    maxRelativeDelta: Number(positionAudit.maxRelativeDelta.toFixed(6)),
    stateSwitches: positionAudit.stateSwitches,
    maxSourcesPerFrame: positionAudit.maxSourcesPerFrame,
    invalidOwnerCount: positionAudit.invalidOwnerCount,
    multiSourceFrames,
  };

  if (includeFrames) {
    snapshot.frames = positionAudit.frames.map(formatAuditFrame);
  }

  return snapshot;
}

function resetPrizePhysics(prize, rotate = true) {
  if (!prize.body) return;
  prize.body.type = CANNON.Body.DYNAMIC;
  prize.body.mass = prize.mass || getPrizeMass(prize.bodyHalf || new CANNON.Vec3(PRIZE_BODY_HALF.x, PRIZE_BODY_HALF.y, PRIZE_BODY_HALF.z));
  prize.body.collisionResponse = true;
  prize.body.updateMassProperties();
  prize.body.position.set(prize.home.x, prize.home.y + (prize.bodyOffsetY || PRIZE_BODY_OFFSET_Y), prize.home.z);
  prize.body.velocity.set(0, 0, 0);
  prize.body.angularVelocity.set(0, 0, 0);
  prize.body.force.set(0, 0, 0);
  prize.body.torque.set(0, 0, 0);
  prize.body.quaternion.setFromEuler(
    rotate ? prize.spawnTransform?.rotation?.x || 0 : 0,
    rotate ? prize.spawnTransform?.rotation?.y || 0 : 0,
    rotate ? prize.spawnTransform?.rotation?.z || 0 : 0,
  );
  prize.body.wakeUp();
  prize.holdSpin = 0;
  prize.holdOffset = null;
  prize.holdBlend = 0;
  prize.holdQuaternion = null;
  prize.positionOwner = "layout";
  prize.state = "available";
  prize.carryVelocity = prize.carryVelocity || new CANNON.Vec3(0, 0, 0);
  prize.carryVelocity.set(0, 0, 0);
  prize.carryStartOffset = null;
  prize.carryMaxRelativeDelta = 0;
  prize.carryRelativeWarningShown = false;
  clearPrizeGrip(prize);
  syncPrizeVisual(prize, "reset");
}

function capturePrize(prize) {
  prize.grabbed = true;
  prize.state = "carrying";
  if (!prize.body) return;

  clearPrizeGrip(prize);
  prize.positionOwner = "claw";
  prize.body.type = CANNON.Body.KINEMATIC;
  prize.body.mass = 0;
  prize.body.collisionResponse = false;
  prize.body.updateMassProperties();
  prize.body.velocity.set(0, 0, 0);
  prize.body.angularVelocity.set(0, 0, 0);
  prize.body.force.set(0, 0, 0);
  prize.body.torque.set(0, 0, 0);
  prize.body.wakeUp();

  prize.holdOffset = new CANNON.Vec3(
    prize.body.position.x - claw.x,
    prize.body.position.y - claw.y,
    prize.body.position.z - claw.z,
  );
  prize.holdQuaternion = new CANNON.Quaternion(
    prize.body.quaternion.x,
    prize.body.quaternion.y,
    prize.body.quaternion.z,
    prize.body.quaternion.w,
  );
  prize.carryVelocity = prize.carryVelocity || new CANNON.Vec3(0, 0, 0);
  prize.carryVelocity.set(0, 0, 0);
  prize.carryStartOffset = new CANNON.Vec3(prize.holdOffset.x, prize.holdOffset.y, prize.holdOffset.z);
  prize.carryMaxRelativeDelta = 0;
  prize.carryRelativeWarningShown = false;
  game.lastCarryMaxRelativeDelta = 0;
  syncHeldPrize(prize, 16);
}

function syncHeldPrize(prize, dt) {
  if (!prize.body || prize.positionOwner !== "claw") return;

  if (!prize.holdOffset) {
    prize.holdOffset = new CANNON.Vec3(
      prize.body.position.x - claw.x,
      prize.body.position.y - claw.y,
      prize.body.position.z - claw.z,
    );
  }
  if (!prize.holdQuaternion) {
    prize.holdQuaternion = new CANNON.Quaternion(
      prize.body.quaternion.x,
      prize.body.quaternion.y,
      prize.body.quaternion.z,
      prize.body.quaternion.w,
    );
  }

  const seconds = Math.max(dt / 1000, 1 / 120);
  const nextX = claw.x + prize.holdOffset.x;
  const nextY = claw.y + prize.holdOffset.y;
  const nextZ = claw.z + prize.holdOffset.z;
  prize.carryVelocity = prize.carryVelocity || new CANNON.Vec3(0, 0, 0);
  prize.carryVelocity.set(
    (nextX - prize.body.position.x) / seconds,
    (nextY - prize.body.position.y) / seconds,
    (nextZ - prize.body.position.z) / seconds,
  );

  // In carrying state the claw is the only owner allowed to write prize position.
  prize.body.type = CANNON.Body.KINEMATIC;
  prize.body.mass = 0;
  prize.body.collisionResponse = false;
  prize.body.position.set(nextX, nextY, nextZ);
  prize.body.previousPosition.copy(prize.body.position);
  if (prize.body.interpolatedPosition) prize.body.interpolatedPosition.copy(prize.body.position);
  prize.body.quaternion.set(
    prize.holdQuaternion.x,
    prize.holdQuaternion.y,
    prize.holdQuaternion.z,
    prize.holdQuaternion.w,
  );
  if (prize.body.previousQuaternion) prize.body.previousQuaternion.copy(prize.body.quaternion);
  if (prize.body.interpolatedQuaternion) prize.body.interpolatedQuaternion.copy(prize.body.quaternion);
  prize.body.velocity.set(0, 0, 0);
  prize.body.angularVelocity.set(0, 0, 0);
  prize.body.force.set(0, 0, 0);
  prize.body.torque.set(0, 0, 0);
  prize.body.aabbNeedsUpdate = true;
  prize.body.wakeUp();
  recordPrizePositionWrite("claw-carry", prize);
  assertCarryOffsetStable(prize);
  syncPrizeVisual(prize, "claw-carry");
}

function assertCarryOffsetStable(prize) {
  if (!prize.holdOffset || !prize.carryStartOffset) return;
  const relativeX = prize.body.position.x - claw.x;
  const relativeY = prize.body.position.y - claw.y;
  const relativeZ = prize.body.position.z - claw.z;
  const dx = relativeX - prize.carryStartOffset.x;
  const dy = relativeY - prize.carryStartOffset.y;
  const dz = relativeZ - prize.carryStartOffset.z;
  const relativeDelta = Math.hypot(dx, dy, dz);
  prize.carryMaxRelativeDelta = Math.max(prize.carryMaxRelativeDelta || 0, relativeDelta);
  game.lastCarryMaxRelativeDelta = Math.max(game.lastCarryMaxRelativeDelta || 0, prize.carryMaxRelativeDelta);

  if (
    import.meta.env.DEV &&
    relativeDelta > CARRY_RELATIVE_WARN_THRESHOLD &&
    !prize.carryRelativeWarningShown
  ) {
    prize.carryRelativeWarningShown = true;
    console.warn("Carried prize relative offset changed", {
      relativeDelta,
      prizeId: prize.id,
      gameStage: game.state,
      positionOwner: prize.positionOwner,
    });
  }
}

function releaseGrabbedPrize() {
  const prize = game.grabbedPrize;
  if (!prize) return;

  syncHeldPrize(prize, 16);
  prize.grabbed = false;
  if (!prize.body) return;
  prize.state = "releasing";
  prize.positionOwner = "outlet-drop";
  clearPrizeGrip(prize);
  prize.body.type = CANNON.Body.KINEMATIC;
  prize.body.mass = 0;
  prize.body.collisionResponse = false;
  prize.body.updateMassProperties();
  const bodyHalf = prize.bodyHalf || PRIZE_BODY_HALF;
  const minReleaseY = OUTLET_BOUNDS.floorY + bodyHalf.y + 0.34;
  const maxReleaseY = OUTLET_BOUNDS.floorY + bodyHalf.y + 1.18;
  prize.body.position.x = clamp(prize.body.position.x, OUTLET_BOUNDS.minX, OUTLET_BOUNDS.maxX);
  prize.body.position.z = clamp(prize.body.position.z, OUTLET_BOUNDS.minZ, OUTLET_BOUNDS.maxZ);
  prize.body.position.y = clamp(prize.body.position.y, minReleaseY, maxReleaseY);
  prize.body.velocity.set(0, 0, 0);
  prize.body.angularVelocity.set(0, 0, 0);
  prize.body.force.set(0, 0, 0);
  prize.body.torque.set(0, 0, 0);
  prize.releaseMotion = {
    vx: 0,
    vy: OUTLET_DROP.initialVelocityY,
    vz: 0,
    bounced: false,
    settledMs: 0,
    startedAt: performance.now(),
    startY: prize.body.position.y,
    minY: prize.body.position.y,
    maxLateralDrift: 0,
    done: false,
  };
  prize.holdOffset = null;
  prize.holdBlend = 0;
  prize.holdQuaternion = null;
  prize.carryStartOffset = null;
  prize.body.aabbNeedsUpdate = true;
  prize.body.wakeUp();
}

function updateOutletDrop(prize, dt) {
  if (!prize?.body || prize.positionOwner !== "outlet-drop") return false;
  const motion = prize.releaseMotion;
  if (!motion || motion.done) return Boolean(motion?.done);

  const seconds = Math.min(Math.max(dt / 1000, 0), OUTLET_DROP.maxDt);
  const bodyHalf = prize.bodyHalf || PRIZE_BODY_HALF;
  const floorCenterY = OUTLET_BOUNDS.floorY + bodyHalf.y;
  const nearFloor = prize.body.position.y - floorCenterY < 0.24;
  const lateralDamping = nearFloor ? OUTLET_DROP.nearFloorDamping : OUTLET_DROP.lateralDamping;

  motion.vx = (motion.vx + (OUTLET_BOUNDS.centerX - prize.body.position.x) * OUTLET_DROP.lateralSpring * seconds) * lateralDamping;
  motion.vz = (motion.vz + (OUTLET_BOUNDS.centerZ - prize.body.position.z) * OUTLET_DROP.lateralSpring * seconds) * lateralDamping;
  motion.vy -= OUTLET_DROP.gravity * seconds;

  prize.body.position.x = clamp(
    prize.body.position.x + motion.vx * seconds,
    OUTLET_BOUNDS.minX + bodyHalf.x * 0.72,
    OUTLET_BOUNDS.maxX - bodyHalf.x * 0.72,
  );
  prize.body.position.z = clamp(
    prize.body.position.z + motion.vz * seconds,
    OUTLET_BOUNDS.minZ + bodyHalf.z * 0.72,
    OUTLET_BOUNDS.maxZ - bodyHalf.z * 0.72,
  );
  prize.body.position.y += motion.vy * seconds;

  if (prize.body.position.y <= floorCenterY) {
    prize.body.position.y = floorCenterY;
    if (!motion.bounced) {
      motion.vy = Math.min(Math.abs(motion.vy) * OUTLET_DROP.restitution, 0.08);
      motion.bounced = true;
    } else {
      motion.vy = 0;
    }
  }

  const lateralDrift = Math.hypot(prize.body.position.x - OUTLET_BOUNDS.centerX, prize.body.position.z - OUTLET_BOUNDS.centerZ);
  motion.maxLateralDrift = Math.max(motion.maxLateralDrift, lateralDrift);
  motion.minY = Math.min(motion.minY, prize.body.position.y);

  if (Math.abs(motion.vy) < OUTLET_DROP.settleSpeed && Math.abs(prize.body.position.y - floorCenterY) < 0.01) {
    motion.settledMs += dt;
  } else {
    motion.settledMs = 0;
  }

  prize.body.velocity.set(0, 0, 0);
  prize.body.angularVelocity.set(0, 0, 0);
  prize.body.force.set(0, 0, 0);
  prize.body.torque.set(0, 0, 0);
  prize.body.aabbNeedsUpdate = true;
  syncPrizeVisual(prize, "outlet-drop");

  if (motion.settledMs >= OUTLET_DROP.settleMs || game.stateTime > 1800) {
    motion.done = true;
    prize.body.position.x = clamp(prize.body.position.x, OUTLET_BOUNDS.minX, OUTLET_BOUNDS.maxX);
    prize.body.position.z = clamp(prize.body.position.z, OUTLET_BOUNDS.minZ, OUTLET_BOUNDS.maxZ);
    prize.body.position.y = floorCenterY;
    syncPrizeVisual(prize, "outlet-settle");
  }
  return motion.done;
}

function clearPrizeGrip(prize) {
  if (!prize.gripConstraints?.length || !physics.world) {
    prize.gripConstraints = [];
    return;
  }

  prize.gripConstraints.forEach((constraint) => {
    physics.world.removeConstraint(constraint);
  });
  prize.gripConstraints = [];
}

function syncClawCollider(dt) {
  if (!physics.clawBodies.length) return;
  const seconds = Math.max(dt / 1000, 1 / 120);
  const targets = getClawColliderTargets(claw.y);
  targets.forEach((target, index) => {
    const body = physics.clawBodies[index];
    if (!body) return;

    const dx = target.x - body.position.x;
    const dy = target.y - body.position.y;
    const dz = target.z - body.position.z;
    const distance = Math.hypot(dx, dy, dz);
    if (!body.userData.initialized || distance > 2.6) {
      body.position.set(target.x, target.y, target.z);
      body.previousPosition.copy(body.position);
      body.velocity.set(0, 0, 0);
      body.userData.initialized = true;
    } else {
      const speed = Math.min(PHYSICS_TUNING.claw.maxSensorSpeed, distance / seconds);
      const scale = distance > 0.0001 ? speed / distance : 0;
      body.velocity.set(dx * scale, dy * scale, dz * scale);
    }
    body.aabbNeedsUpdate = true;
  });
  wakePrizesNearClaw(targets);
}

function getClawColliderTargets(clawY = claw.y) {
  const targets = [{
    x: claw.x,
    y: clawY - 0.02,
    z: claw.z,
    radius: physics.clawBodies[0]?.userData?.radius || 0.15,
    role: "hub",
  }];
  const knuckleRadius = lerp(0.52, 0.26, claw.closed);
  const tipRadius = lerp(0.38, 0.08, claw.closed);
  const knuckleY = clawY - 0.56;
  const tipY = clawY - 0.72;

  for (let i = 0; i < 3; i += 1) {
    const angle = i * (Math.PI * 2 / 3) + Math.PI / 6;
    const knuckleBody = physics.clawBodies[i * 2 + 1];
    const tipBody = physics.clawBodies[i * 2 + 2];
    targets.push({
      x: claw.x + Math.cos(angle) * knuckleRadius,
      y: knuckleY,
      z: claw.z + Math.sin(angle) * knuckleRadius,
      radius: knuckleBody?.userData?.radius || 0.16,
      role: `knuckle-${i}`,
    });
    targets.push({
      x: claw.x + Math.cos(angle) * tipRadius,
      y: tipY,
      z: claw.z + Math.sin(angle) * tipRadius,
      radius: tipBody?.userData?.radius || 0.16,
      role: `tip-${i}`,
    });
  }
  return targets;
}

function constrainClawAgainstPrizes(dt) {
  if (![STATES.DROPPING, STATES.GRABBING].includes(game.state) || game.grabbedPrize) {
    game.clawContactMs = 0;
    return false;
  }

  const targets = getClawColliderTargets(claw.y);
  let lift = 0;
  let touching = false;

  targets.forEach((target) => {
    sceneObjects.prizes.forEach((prize) => {
      if (!prize.body || prize.grabbed || prize.collected || !prize.object.visible) return;

      const dx = target.x - prize.body.position.x;
      const dz = target.z - prize.body.position.z;
      const bodyHalf = prize.bodyHalf || PRIZE_BODY_HALF;
      const prizeTop = prize.body.position.y + bodyHalf.y;
      const topContact = getTopContactDepth(target, prize, dx, dz);
      const sideContact = getSideContactStrength(target, prize, dx, dz);

      if (topContact > 0) {
        const minTargetY = prizeTop + target.radius + CLAW_CONTACT_SKIN;
        lift = Math.max(lift, minTargetY - target.y);
        touching = true;
      } else if (sideContact > 0) {
        touching = true;
      }
    });
  });

  if (lift > 0) {
    claw.y += lift;
    claw.targetY = Math.max(claw.targetY, claw.y);
    game.clawContactMs += dt;
    return true;
  }

  game.clawContactMs = Math.max(0, game.clawContactMs - dt * 0.65);
  return touching;
}

function getTopContactDepth(target, prize, dx, dz) {
  if (!target.role.startsWith("hub") && !target.role.startsWith("tip")) return 0;

  const bodyHalf = prize.bodyHalf || PRIZE_BODY_HALF;
  const topBlockX = bodyHalf.x * 0.55 + target.radius * 0.35;
  const topBlockZ = bodyHalf.z * 0.55 + target.radius * 0.35;
  const normalized = (dx * dx) / (topBlockX * topBlockX) + (dz * dz) / (topBlockZ * topBlockZ);
  if (normalized > 1) return 0;

  const prizeTop = prize.body.position.y + bodyHalf.y;
  const minTargetY = prizeTop + target.radius + CLAW_CONTACT_SKIN;
  return Math.max(0, minTargetY - target.y);
}

function getSideContactStrength(target, prize, dx, dz) {
  if (target.role === "hub") return 0;

  const bodyHalf = prize.bodyHalf || PRIZE_BODY_HALF;
  const prizeTop = prize.body.position.y + bodyHalf.y;
  const sideBandTop = prizeTop - CLAW_SIDE_GRIP_Y;
  const sideBandBottom = prize.body.position.y - bodyHalf.y * 0.72;
  if (target.y > sideBandTop || target.y < sideBandBottom) return 0;

  const sideX = bodyHalf.x + target.radius * 0.85;
  const sideZ = bodyHalf.z + target.radius * 0.85;
  const normalized = (dx * dx) / (sideX * sideX) + (dz * dz) / (sideZ * sideZ);
  if (normalized > 1) return 0;
  return Math.max(0.18, 1 - Math.sqrt(normalized));
}

function measureClawPrizePenetration(prize) {
  if (!prize?.body) return 0;
  let maxPenetration = 0;
  getClawColliderTargets(claw.y).forEach((target) => {
    const dx = target.x - prize.body.position.x;
    const dz = target.z - prize.body.position.z;
    maxPenetration = Math.max(maxPenetration, getTopContactDepth(target, prize, dx, dz));
  });
  return maxPenetration;
}

function wakePrizesNearClaw(targets) {
  if (![STATES.CONTROLLING, STATES.DROPPING, STATES.GRABBING].includes(game.state)) return;
  sceneObjects.prizes.forEach((prize) => {
    if (!prize.body || prize.grabbed || prize.collected) return;
    const near = targets.some((target) => {
      const dx = target.x - prize.body.position.x;
      const dy = target.y - prize.body.position.y;
      const dz = target.z - prize.body.position.z;
      return Math.hypot(dx, dy, dz) < 0.78;
    });
    if (near) prize.body.wakeUp();
  });
}

function getPrizePhysicsSummary() {
  let maxLinearSpeed = 0;
  let maxAngularSpeed = 0;
  let awakeCount = 0;

  sceneObjects.prizes.forEach((prize) => {
    if (!prize.body || prize.collected) return;
    maxLinearSpeed = Math.max(maxLinearSpeed, prize.body.velocity.length());
    maxAngularSpeed = Math.max(maxAngularSpeed, prize.body.angularVelocity.length());
    if (prize.body.sleepState !== CANNON.Body.SLEEPING) awakeCount += 1;
  });

  return {
    maxLinearSpeed,
    maxAngularSpeed,
    awakeCount,
    overlapCount: measurePrizeOverlapCount(),
  };
}

function measurePrizeOverlapCount() {
  let count = 0;
  for (let i = 0; i < sceneObjects.prizes.length; i += 1) {
    const a = sceneObjects.prizes[i];
    if (!a.body || a.collected) continue;
    for (let j = i + 1; j < sceneObjects.prizes.length; j += 1) {
      const b = sceneObjects.prizes[j];
      if (!b.body || b.collected) continue;
      const ax = a.bodyHalf?.x || PRIZE_BODY_HALF.x;
      const az = a.bodyHalf?.z || PRIZE_BODY_HALF.z;
      const bx = b.bodyHalf?.x || PRIZE_BODY_HALF.x;
      const bz = b.bodyHalf?.z || PRIZE_BODY_HALF.z;
      const overlapX = Math.abs(a.body.position.x - b.body.position.x) < (ax + bx) * 0.98;
      const overlapZ = Math.abs(a.body.position.z - b.body.position.z) < (az + bz) * 0.98;
      if (overlapX && overlapZ) count += 1;
    }
  }
  return count;
}

function prewarmPrizePhysics() {
  if (!physics.world || !sceneObjects.prizes.length) return;
  const steps = PHYSICS_TUNING.simulation.prewarmSteps;
  for (let i = 0; i < steps; i += 1) {
    physics.world.step(physics.fixedTimeStep);
  }

  sceneObjects.prizes.forEach((prize) => {
    if (!prize.body || prize.collected) return;
    if (
      prize.body.velocity.length() < PHYSICS_TUNING.toy.settleLinearThreshold
      && prize.body.angularVelocity.length() < PHYSICS_TUNING.toy.settleAngularThreshold
    ) {
      prize.body.velocity.set(0, 0, 0);
      prize.body.angularVelocity.set(0, 0, 0);
      prize.body.sleep();
    }
    syncPrizeVisual(prize, "prewarm");
  });

  const summary = getPrizePhysicsSummary();
  game.lastPrewarmStats = {
    steps,
    maxLinearSpeed: Number(summary.maxLinearSpeed.toFixed(4)),
    maxAngularSpeed: Number(summary.maxAngularSpeed.toFixed(4)),
    awakeCount: summary.awakeCount,
    overlapCount: summary.overlapCount,
  };
}

function stepPhysics(dt) {
  if (!physics.world) return;
  physics.world.step(
    physics.fixedTimeStep,
    Math.min(dt / 1000, PHYSICS_TUNING.simulation.maxFrameDt),
    physics.maxSubSteps,
  );
}

function makeTextSprite(text, options = {}) {
  const width = options.width || 640;
  const height = options.height || 180;
  const cnv = document.createElement("canvas");
  cnv.width = width;
  cnv.height = height;
  const c = cnv.getContext("2d");
  c.clearRect(0, 0, width, height);
  if (options.bg) {
    c.fillStyle = options.bg;
    c.fillRect(0, 0, width, height);
  }
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillStyle = options.color || "#fff7e6";
  c.font = `900 ${options.fontSize || 76}px Trebuchet MS, Microsoft YaHei, sans-serif`;
  c.fillText(text, width / 2, height / 2);

  const texture = new THREE.CanvasTexture(cnv);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.userData.texture = texture;
  return sprite;
}

function setMessage(text, subtext) {
  if (sceneObjects.messageSprite) {
    sceneObjects.machine.remove(sceneObjects.messageSprite);
    sceneObjects.messageSprite.material.map.dispose();
    sceneObjects.messageSprite.material.dispose();
    sceneObjects.messageSprite = null;
  }
}

function roundedCanvasRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

async function initCameraAndModel() {
  setCameraStatus("loading", "正在请求摄像头权限...");
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

  setCameraStatus("loading", "摄像头已连接，正在加载手势模型...");
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
  setCameraStatus("ready", "摄像头已连接");
  ui.cameraMessage.textContent = "摄像头已启用：张开手掌开始。";
}

function enableDemoMode(reason) {
  game.inputMode = "demo";
  const friendly = formatCameraProblem(reason);
  setCameraStatus("demo", "已切换自动演示", friendly);
  ui.cameraMessage.textContent = `演示模式：${friendly} 可点击开始演示验证流程。`;
}

function setCameraStatus(status, message, problem = "") {
  game.cameraStatus = status;
  game.cameraProblem = problem;
  if (ui.cameraStatusText) ui.cameraStatusText.textContent = message;
  if (ui.cameraStatusText?.parentElement) ui.cameraStatusText.parentElement.dataset.tone = status;
  if (ui.cameraCard) {
    ui.cameraCard.classList.toggle("camera-card--loading", status === "loading");
    ui.cameraCard.classList.toggle("camera-card--error", status === "error");
    ui.cameraCard.classList.toggle("camera-card--demo", status === "demo");
    ui.cameraCard.dataset.live = status === "ready" ? "true" : "false";
  }
}

function formatCameraProblem(reason = "") {
  if (/denied|permission|权限|notallowed/i.test(reason)) {
    return "摄像头权限被拒绝，请在浏览器地址栏重新允许访问。";
  }
  if (/notfound|device not found|找不到|no camera|未找到/i.test(reason)) {
    return "没有检测到可用摄像头。";
  }
  if (/notreadable|track|占用|busy/i.test(reason)) {
    return "摄像头可能被其他程序占用，请关闭占用后重试。";
  }
  if (/https|secure/i.test(reason)) {
    return "摄像头需要 HTTPS 或 localhost 环境。";
  }
  if (/model|landmarker|wasm|模型/i.test(reason)) {
    return "手势模型加载失败，请刷新页面或检查静态资源。";
  }
  return reason || "摄像头读取失败。";
}

function stopCameraStream() {
  if (!video.srcObject) return;
  video.srcObject.getTracks().forEach((track) => track.stop());
  video.srcObject = null;
  cameraStarted = false;
}

async function retryCamera() {
  stopCameraStream();
  game.inputMode = "loading";
  try {
    await initCameraAndModel();
  } catch (error) {
    console.error(error);
    setCameraStatus("error", "摄像头不可用", formatCameraProblem(error.message));
    enableDemoMode(error.message || "摄像头不可用。");
  }
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

function toMirroredPalmCenter(palmCenter) {
  return { x: 1 - palmCenter.x, y: palmCenter.y };
}

function readCameraInput() {
  if (!handLandmarker || !cameraStarted || video.readyState < 2) return;
  let result;
  try {
    result = handLandmarker.detectForVideo(video, performance.now());
  } catch (error) {
    console.error(error);
    game.handPresent = false;
    setCameraStatus("error", "摄像头读取失败", "摄像头画面读取失败，请重试。");
    return;
  }
  handCtx.clearRect(0, 0, handOverlay.width, handOverlay.height);

  if (!result.landmarks?.length) {
    game.handPresent = false;
    input.openPalm = false;
    input.fist = false;
    return;
  }

  const lm = result.landmarks[0];
  const hand = classifyHand(lm);
  const mirroredPalmCenter = toMirroredPalmCenter(hand.palmCenter);
  game.handPresent = true;
  game.lastHandSeenAt = performance.now();
  input.openPalm = hand.openPalm;
  input.fist = hand.fist;

  if (!game.calibration && game.state === STATES.CONTROLLING) {
    game.calibration = {
      x: mirroredPalmCenter.x,
      y: mirroredPalmCenter.y,
      scale: hand.palmScale || 0.16,
    };
  }

  if (game.calibration) {
    const dx = (mirroredPalmCenter.x - game.calibration.x) * 2.4;
    const dz = (mirroredPalmCenter.y - game.calibration.y) * 2.2;
    const scaleDelta = ((game.calibration.scale || 0.16) - hand.palmScale) * 2.4;
    input.rawX = clamp(0.5 + dx, 0, 1);
    input.rawY = clamp(0.5 + dz + scaleDelta, 0, 1);
  }

  drawHandOverlay(lm);
}

function drawHandOverlay(lm) {
  handCtx.clearRect(0, 0, handOverlay.width, handOverlay.height);
  handCtx.fillStyle = "rgba(88, 242, 184, 0.9)";
  lm.forEach((p) => {
    handCtx.beginPath();
    handCtx.arc(p.x * handOverlay.width, p.y * handOverlay.height, 3, 0, Math.PI * 2);
    handCtx.fill();
  });
}

function readDemoInput(dt) {
  game.demoTime += dt;
  const t = game.demoTime;
  const target = getLiveDemoTarget();
  const targetX = worldXToInput(target.x);
  const targetY = worldZToInput(target.z);
  input.openPalm = t < 1250;
  input.fist = t > 4200 && t < 5100;

  if (t < 1250) {
    input.rawX = 0.5;
    input.rawY = 0.5;
  } else if (t < 3600) {
    const u = (t - 1250) / 2350;
    input.rawX = lerp(0.5, targetX, easeInOut(u));
    input.rawY = lerp(0.5, targetY, easeInOut(u));
  } else {
    input.rawX = targetX;
    input.rawY = targetY;
    if (t > 3600) {
      input.x = targetX;
      input.y = targetY;
    }
  }
}

function chooseDemoTarget() {
  const visible = sceneObjects.prizes.filter((item) => !item.collected && item.object.visible);
  const candidates = visible
    .map((item) => {
      const position = item.body?.position || item.object.position || item.home;
      const nearestNeighbor = visible
        .filter((other) => other !== item)
        .reduce((nearest, other) => {
          const otherPosition = other.body?.position || other.object.position || other.home;
          return Math.min(nearest, Math.hypot(position.x - otherPosition.x, position.z - otherPosition.z));
        }, Infinity);
      const crowdPenalty = Math.max(0, 0.92 - nearestNeighbor) * 2.4;
      const edgePenalty = Math.max(0, Math.abs(position.x) - 1.95) * 0.65;
      const outletPenalty = Math.hypot(position.x - OUTLET_BOUNDS.centerX, position.z - OUTLET_BOUNDS.centerZ) < 1.1 ? 3 : 0;
      return {
        prize: item,
        position,
        score: Math.hypot(position.x - DEMO_TARGET.x, (position.z - DEMO_TARGET.z) * 0.75)
          + crowdPenalty
          + edgePenalty
          + outletPenalty,
      };
    })
    .sort((a, b) => a.score - b.score);
  const prize = candidates[0]?.prize;
  game.demoTargetPrizeId = prize?.id || null;
  return getPrizeDemoTarget(prize);
}

function getLiveDemoTarget() {
  const prize = sceneObjects.prizes.find((item) => item.id === game.demoTargetPrizeId && !item.collected && item.object.visible);
  if (!prize) return game.demoTarget || { ...DEMO_TARGET };
  return getPrizeDemoTarget(prize);
}

function getPrizeDemoTarget(prize) {
  if (!prize) return { ...DEMO_TARGET };
  const position = prize.body?.position || prize.object.position || prize.home;
  return {
    x: clamp(position.x, WORLD.xMin + 0.16, WORLD.xMax - 0.16),
    z: clamp(position.z, WORLD.zMin + 0.16, WORLD.zMax - 0.16),
  };
}

function setState(next) {
  if (game.state === next) return;
  game.state = next;
  game.stateTime = 0;
  ui.state.textContent = STATE_LABELS[next];
  window.__clawGameState = game.state;
  updateMessage();
}

function startSession() {
  if (game.sessionActive) return;
  game.sessionActive = true;
  game.sessionElapsedMs = 0;
  game.currentAttemptStartedMs = 0;
  game.attempts = [];
  game.awaitFistRelease = false;
}

function startAttempt() {
  game.currentAttemptStartedMs = game.sessionElapsedMs;
}

function recordAttempt(success) {
  const durationMs = Math.max(0, game.sessionElapsedMs - (game.currentAttemptStartedMs || game.sessionElapsedMs));
  const attempt = {
    index: game.attempts.length + 1,
    success,
    elapsedMs: game.sessionElapsedMs,
    durationMs,
  };
  game.attempts.push(attempt);
  game.result = success ? "抓到了" : "差一点";
  game.currentAttemptStartedMs = 0;
  game.resultFlashMs = 3600;
  return attempt;
}

function markPrizeCollected(prize) {
  if (!prize || game.collectedPrizeIds.has(prize.id)) return false;
  game.collectedPrizeIds.add(prize.id);
  return maybeStartCollectionCelebration();
}

function maybeStartCollectionCelebration() {
  const allCollected = sceneObjects.prizes.length > 0
    && sceneObjects.prizes.every((prize) => prize.state === "collected");
  if (!allCollected || game.hasCelebratedCollection) return false;
  game.hasCelebratedCollection = true;
  game.celebrationCount += 1;
  startCollectionCelebration();
  return true;
}

async function startCollectionCelebration() {
  const runId = ++celebrationRunId;
  game.demoActive = false;
  game.demoTime = 0;
  game.demoTarget = null;
  game.demoTargetPrizeId = null;
  input.fist = false;
  input.openPalm = false;
  setState(STATES.CELEBRATING);
  updateUi();

  const playResult = await playCelebrationAnimation(runId);
  if (runId !== celebrationRunId || playResult === "cancelled") return;

  const settleResult = await waitCelebrationDelay(650, runId);
  if (runId !== celebrationRunId || settleResult === "cancelled") return;

  setState(STATES.RESETTING);
  updateUi();
  const resetResult = await waitCelebrationDelay(360, runId);
  if (runId !== celebrationRunId || resetResult === "cancelled") return;
  resetGame();
}

async function playCelebrationAnimation(runId) {
  showCelebrationOverlay();
  game.resultFlashMs = 0;

  if (prefersReducedMotion()) {
    return waitCelebrationDelay(1200, runId);
  }

  try {
    const player = await getCelebrationPlayer();
    player.stop();
    player.goToAndStop(0, true);

    return new Promise((resolve) => {
      let fallbackTimer = 0;
      const settle = (result) => {
        if (fallbackTimer) {
          clearTimeout(fallbackTimer);
          celebrationTimers.delete(fallbackTimer);
        }
        player.removeEventListener("complete", handleComplete);
        player.removeEventListener("data_failed", handleLoadError);
        if (celebrationPendingResolve === settle) celebrationPendingResolve = null;
        resolve(result);
      };
      const handleComplete = () => settle("complete");
      const handleLoadError = (event) => {
        console.error("Celebration Lottie failed to load", event);
        settle("load-error");
      };

      celebrationPendingResolve = settle;
      player.addEventListener("complete", handleComplete);
      player.addEventListener("data_failed", handleLoadError);
      fallbackTimer = window.setTimeout(() => settle(runId === celebrationRunId ? "fallback" : "cancelled"), 4600);
      celebrationTimers.add(fallbackTimer);
      player.goToAndStop(0, true);
      player.play();
    });
  } catch (error) {
    console.error("Celebration Lottie could not start", error);
    return waitCelebrationDelay(1200, runId);
  }
}

async function getCelebrationPlayer() {
  if (!celebrationPlayer || celebrationLoadedSource !== celebrationSource) {
    if (celebrationPlayer) celebrationPlayer.destroy();
    const animationData = await loadCelebrationAnimationData();
    ui.celebrationPlayer.replaceChildren();
    celebrationPlayer = lottie.loadAnimation({
      container: ui.celebrationPlayer,
      renderer: "svg",
      animationData,
      autoplay: false,
      loop: false,
      rendererSettings: {
        preserveAspectRatio: "xMidYMid meet",
        progressiveLoad: true,
      },
    });
    celebrationLoadedSource = celebrationSource;
  }
  return celebrationPlayer;
}

async function loadCelebrationAnimationData() {
  const response = await fetch(celebrationSource, { cache: "force-cache" });
  if (!response.ok) throw new Error(`Celebration animation request failed: ${response.status} ${celebrationSource}`);
  return response.json();
}

function waitCelebrationDelay(ms, runId) {
  return new Promise((resolve) => {
    const timerId = window.setTimeout(() => {
      celebrationTimers.delete(timerId);
      if (celebrationPendingResolve === settle) celebrationPendingResolve = null;
      resolve(runId === celebrationRunId ? "done" : "cancelled");
    }, ms);
    const settle = (result) => {
      clearTimeout(timerId);
      celebrationTimers.delete(timerId);
      if (celebrationPendingResolve === settle) celebrationPendingResolve = null;
      resolve(result);
    };
    celebrationPendingResolve = settle;
    celebrationTimers.add(timerId);
  });
}

function showCelebrationOverlay() {
  ui.celebrationOverlay.classList.add("is-visible");
  ui.celebrationOverlay.setAttribute("aria-hidden", "false");
}

function hideCelebrationOverlay() {
  ui.celebrationOverlay.classList.remove("is-visible");
  ui.celebrationOverlay.setAttribute("aria-hidden", "true");
  try {
    celebrationPlayer?.stop();
    celebrationPlayer?.goToAndStop?.(0, true);
  } catch {
    // Best-effort cleanup; the visual fallback still resets the game.
  }
}

function cancelCelebrationFlow({ destroyPlayer = false } = {}) {
  celebrationRunId += 1;
  celebrationTimers.forEach((timerId) => clearTimeout(timerId));
  celebrationTimers.clear();
  if (celebrationPendingResolve) {
    const resolve = celebrationPendingResolve;
    celebrationPendingResolve = null;
    resolve("cancelled");
  }
  hideCelebrationOverlay();
  if (destroyPlayer && celebrationPlayer) {
    celebrationPlayer.destroy();
    celebrationPlayer = null;
    celebrationLoadedSource = "";
    ui.celebrationPlayer.replaceChildren();
  }
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches || false;
}

function resetGame() {
  cancelCelebrationFlow();
  setState(STATES.IDLE);
  clearEffects();
  game.result = "未开始";
  game.grabbedPrize = null;
  game.releaseStarted = false;
  game.clawContactMs = 0;
  game.palmOpenMs = 0;
  game.fistMs = 0;
  game.calibration = null;
  game.demoActive = false;
  game.demoTime = 0;
  game.demoTarget = null;
  game.demoTargetPrizeId = null;
  game.round += 1;
  game.sessionActive = false;
  game.sessionElapsedMs = 0;
  game.currentAttemptStartedMs = 0;
  game.attempts = [];
  game.collectedPrizeIds.clear();
  game.hasCelebratedCollection = false;
  game.awaitFistRelease = false;
  game.resultFlashMs = 0;
  game.lastCarryMaxRelativeDelta = 0;
  game.lastReleaseStats = null;
  game.releaseReadyMs = 0;
  input.rawX = 0.5;
  input.rawY = 0.5;
  input.x = 0.5;
  input.y = 0.5;
  input.openPalm = false;
  input.fist = false;
  claw.x = 0;
  claw.y = WORLD.clawHomeY;
  claw.z = 0;
  claw.targetX = 0;
  claw.targetY = WORLD.clawHomeY;
  claw.targetZ = 0;
  claw.closed = 0;
  buildPrizeRound({ resetProgress: true });
  ui.cameraMessage.textContent = game.inputMode === "camera"
    ? "摄像头已启用：张开手掌开始。"
    : "可点击开始演示验证完整流程。";
  updateMessage();
  updateUi();
}

function updateUi() {
  ui.state.textContent = STATE_LABELS[game.state];
  ui.input.textContent = game.demoActive
    ? "自动演示"
    : game.inputMode === "camera"
      ? "摄像头"
      : "演示模式";
  ui.result.textContent = game.result;
  ui.meterX.value = input.x;
  ui.meterY.value = input.y;
  updateScoreboard();
  updatePresentationUi();
}

function updateScoreboard() {
  const attempts = game.attempts.length;
  const successes = game.attempts.filter((attempt) => attempt.success).length;
  const latest = game.attempts.at(-1);
  const rate = attempts ? Math.round((successes / attempts) * 100) : 0;

  ui.scoreSummary.textContent = `${attempts} 次 / ${successes} 成功`;
  ui.scoreElapsed.textContent = formatClock(game.sessionElapsedMs);
  ui.scoreRate.textContent = `成功率 ${rate}%`;
  ui.scoreLast.textContent = latest
    ? `最近：${latest.success ? "成功" : "失败"}，${formatClock(latest.elapsedMs)}`
    : "暂无抓取记录";

  ui.scoreLog.replaceChildren(...game.attempts.slice(-6).reverse().map((attempt) => {
    const item = document.createElement("li");
    const index = document.createElement("span");
    const time = document.createElement("span");
    const result = document.createElement("strong");
    index.textContent = `#${attempt.index}`;
    time.textContent = `${formatClock(attempt.elapsedMs)} / ${formatDuration(attempt.durationMs)}`;
    result.textContent = attempt.success ? "成功" : "失败";
    result.className = attempt.success ? "success" : "miss";
    item.append(index, time, result);
    return item;
  }));
}

function updatePresentationUi() {
  const presentation = getPresentationState();
  ui.currentInstruction.textContent = presentation.instruction;
  ui.gesture.textContent = presentation.gestureTitle;
  ui.gestureSubtext.textContent = presentation.gestureSubtext;
  ui.gestureIcon.textContent = presentation.gestureIcon;
  ui.gestureIcon.dataset.tone = presentation.gestureTone;
  ui.holdRing.style.setProperty("--progress", `${presentation.holdProgress * 360}deg`);
  ui.primary.textContent = presentation.primaryLabel;
  ui.primary.disabled = presentation.primaryDisabled;
  ui.primary.setAttribute("aria-label", presentation.primaryLabel);
  ui.reset.disabled = false;

  ui.cameraCard.dataset.hand = presentation.handTone;
  if (game.cameraProblem && game.cameraStatus !== "ready") ui.cameraMessage.textContent = game.cameraProblem;

  const step = presentation.step;
  const activeIndex = FLOW_STEPS.indexOf(step);
  document.querySelectorAll(".progress-steps li").forEach((item, index) => {
    item.classList.toggle("is-active", item.dataset.step === step);
    item.classList.toggle("is-done", activeIndex > index);
  });

  const reticleVisible = [STATES.CONTROLLING, STATES.DROPPING, STATES.GRABBING].includes(game.state);
  const reticleX = 10 + input.x * 80;
  const reticleY = 24 + input.y * 56;
  ui.targetReticle.classList.toggle("is-visible", reticleVisible);
  ui.targetReticle.style.left = `${reticleX}%`;
  ui.targetReticle.style.top = `${reticleY}%`;

  const latest = game.attempts.at(-1);
  const showResult = game.resultFlashMs > 0 && latest;
  ui.resultOverlay.classList.toggle("is-visible", Boolean(showResult));
  ui.resultOverlay.setAttribute("aria-hidden", showResult ? "false" : "true");
  if (showResult) {
    ui.resultBadge.textContent = latest.success ? "SUCCESS" : "TRY AGAIN";
    ui.resultTitle.textContent = latest.success ? "抓取成功" : "差一点，再试一次";
    ui.resultText.textContent = latest.success
      ? `第 ${latest.index} 次抓取成功，继续移动手掌可以再抓一次。`
      : `第 ${latest.index} 次没有抓稳，调整位置后再握拳。`;
  }
}

function getPresentationState() {
  const recentlySeen = performance.now() - game.lastHandSeenAt < 850;
  const handVisible = game.handPresent || recentlySeen;
  const handStable = game.handPresent && (input.openPalm || input.fist);
  const calibrating = game.state === STATES.IDLE && input.openPalm;
  const fistHolding = game.state === STATES.CONTROLLING && input.fist && !game.awaitFistRelease;
  const busy = [STATES.DROPPING, STATES.GRABBING, STATES.LIFTING, STATES.RETURNING, STATES.RELEASING].includes(game.state);
  let instruction = "点击“开始演示”体验流程，或用张开手掌开始摄像头控制。";
  let step = STEP_BY_STATE[game.state] || "wait";

  if (game.cameraStatus === "loading") instruction = "正在加载摄像头和手势模型。";
  else if (game.inputMode === "demo" && !game.demoActive && game.state === STATES.IDLE) instruction = "摄像头不可用，可点击开始演示体验完整流程。";
  else if (game.demoActive) instruction = "自动演示运行中，正在模拟手掌轨迹";
  else if (game.state === STATES.CELEBRATING) instruction = "全部娃娃已收集，正在播放庆祝动画。";
  else if (game.state === STATES.RESETTING) instruction = "庆祝完成，正在恢复到初始状态。";
  else if (game.resultFlashMs > 0 && game.attempts.length) {
    instruction = game.result === "抓到了" ? "抓到了" : "差一点";
    step = "result";
  } else if (calibrating) {
    instruction = "张开手掌并保持，正在完成校准。";
    step = "calibrate";
  } else if (game.state === STATES.IDLE) instruction = "将手掌放入画面，张开手掌并保持 1 秒。";
  else if (fistHolding) instruction = "握拳并保持下爪";
  else if (game.awaitFistRelease) instruction = "请先张开手掌，再进行下一次抓取。";
  else if (game.state === STATES.CONTROLLING && !handVisible && game.inputMode === "camera") instruction = "请将手掌移回摄像头画面。";
  else if (game.state === STATES.CONTROLLING && game.inputMode === "camera" && !handStable) instruction = "请正对摄像头，让手掌清晰可见。";
  else if (game.state === STATES.CONTROLLING) instruction = "移动手掌控制抓手，握拳并保持下爪";
  else if (game.state === STATES.DROPPING || game.state === STATES.GRABBING) instruction = "抓手正在下降";
  else if (game.state === STATES.RETURNING || game.state === STATES.RELEASING) instruction = "正在将奖品送入出口";
  else if (game.state === STATES.LIFTING) instruction = "正在提起奖品";
  else if (busy) instruction = "抓手正在自动完成抓取流程";

  let gestureTitle = "未识别";
  let gestureSubtext = "将手掌放入摄像头画面";
  let gestureIcon = "○";
  let gestureTone = "idle";
  let handTone = "lost";
  let holdProgress = 0;

  if (game.demoActive) {
    gestureTitle = input.fist ? "模拟握拳" : input.openPalm ? "模拟张开" : "模拟移动";
    gestureSubtext = "自动演示正在控制抓手";
    gestureIcon = input.fist ? "●" : "◌";
    gestureTone = "ready";
    handTone = "stable";
  } else if (input.fist) {
    gestureTitle = game.awaitFistRelease ? "已锁定" : "握拳";
    gestureSubtext = game.awaitFistRelease ? "松开后可继续抓取" : "保持到 100% 触发下爪";
    gestureIcon = "●";
    gestureTone = game.awaitFistRelease ? "locked" : "ready";
    handTone = "stable";
  } else if (input.openPalm) {
    gestureTitle = game.state === STATES.IDLE ? "张开手掌" : "手掌已就绪";
    gestureSubtext = game.state === STATES.IDLE ? "保持完成校准" : "移动手掌控制抓手";
    gestureIcon = "◌";
    gestureTone = "ready";
    handTone = "stable";
  } else if (game.handPresent) {
    gestureTitle = "识别不稳定";
    gestureSubtext = "请让手掌完整入镜";
    gestureIcon = "◇";
    gestureTone = "warn";
    handTone = "unstable";
  } else if (recentlySeen) {
    gestureTitle = "短暂丢失";
    gestureSubtext = "请保持手掌在画面内";
    gestureIcon = "◇";
    gestureTone = "warn";
    handTone = "unstable";
  }

  if (game.state === STATES.IDLE) holdProgress = clamp(game.palmOpenMs / 900, 0, 1);
  if (game.state === STATES.CONTROLLING) holdProgress = clamp(game.fistMs / 280, 0, 1);

  let primaryLabel = "开始演示";
  let primaryDisabled = false;
  if (game.cameraStatus === "loading") {
    primaryLabel = "模型加载中";
    primaryDisabled = true;
  } else if (game.cameraStatus === "error") {
    primaryLabel = "重新授权摄像头";
  } else if (game.demoActive) {
    primaryLabel = "演示中";
    primaryDisabled = true;
  } else if (game.state === STATES.CELEBRATING) {
    primaryLabel = "庆祝中";
    primaryDisabled = true;
  } else if (game.state === STATES.RESETTING) {
    primaryLabel = "正在重置";
    primaryDisabled = true;
  } else if (busy) {
    primaryLabel = "抓取中";
    primaryDisabled = true;
  } else if (![STATES.IDLE, STATES.CONTROLLING].includes(game.state)) {
    primaryDisabled = true;
  }

  return {
    instruction,
    step,
    gestureTitle,
    gestureSubtext,
    gestureIcon,
    gestureTone,
    handTone,
    holdProgress,
    primaryLabel,
    primaryDisabled,
  };
}

function updateMessage() {
  if (game.state === STATES.IDLE) {
    setMessage("张开手掌开始", "也可点开始演示");
  } else if (game.state === STATES.RESULT) {
    setMessage(game.result, "张开手掌或点开始演示继续");
  } else if (game.state === STATES.CELEBRATING) {
    setMessage("全部收集", "庆祝完成后自动重置");
  } else if (sceneObjects.messageSprite) {
    sceneObjects.machine.remove(sceneObjects.messageSprite);
    sceneObjects.messageSprite.material.map.dispose();
    sceneObjects.messageSprite.material.dispose();
    sceneObjects.messageSprite = null;
  }
}

function updateState(dt) {
  game.stateTime += dt;
  if (game.sessionActive) game.sessionElapsedMs += dt;
  if (game.resultFlashMs > 0) game.resultFlashMs = Math.max(0, game.resultFlashMs - dt);

  if (game.state === STATES.IDLE) {
    updateStartGesture(dt, 900, false);
  } else if (game.state === STATES.CONTROLLING) {
    if (game.awaitFistRelease) {
      if (!input.fist) game.awaitFistRelease = false;
      game.fistMs = 0;
      return;
    }
    game.fistMs = input.fist ? game.fistMs + dt : 0;
    if (game.fistMs >= 280) {
      game.fistMs = 0;
      startAttempt();
      setState(STATES.DROPPING);
    }
  } else if (game.state === STATES.DROPPING) {
    claw.targetY = WORLD.clawDropY;
    claw.closed = approach(claw.closed, 0.2, dt * PHYSICS_TUNING.claw.closeApproachSpeed);
    if (Math.abs(claw.y - WORLD.clawDropY) < 0.05 || game.clawContactMs > 180 || game.stateTime > 1500) {
      setState(STATES.GRABBING);
    }
  } else if (game.state === STATES.GRABBING) {
    claw.targetY = WORLD.clawDropY;
    claw.closed = approach(claw.closed, CLAW_GRIP_CLOSED, dt * PHYSICS_TUNING.claw.gripCloseSpeed);
    if (!game.grabbedPrize && game.stateTime > 720 && Math.abs(claw.closed - CLAW_GRIP_CLOSED) < 0.03) {
      game.grabbedPrize = pickPrize();
      if (game.grabbedPrize) capturePrize(game.grabbedPrize);
    }
    if (game.stateTime > 1250) {
      setState(STATES.LIFTING);
    }
  } else if (game.state === STATES.LIFTING) {
    claw.targetY = WORLD.clawHomeY;
    if (Math.abs(claw.y - WORLD.clawHomeY) < 0.05) setState(STATES.RETURNING);
  } else if (game.state === STATES.RETURNING) {
    claw.targetX = OUTLET_BOUNDS.centerX;
    claw.targetZ = OUTLET_BOUNDS.centerZ;
    claw.targetY = WORLD.clawHomeY;
    if (Math.abs(claw.x - claw.targetX) < 0.07 && Math.abs(claw.z - claw.targetZ) < 0.07) {
      game.releaseStarted = false;
      game.releaseReadyMs = 0;
      setState(STATES.RELEASING);
    }
  } else if (game.state === STATES.RELEASING) {
    claw.targetX = OUTLET_BOUNDS.centerX;
    claw.targetZ = OUTLET_BOUNDS.centerZ;
    claw.targetY = game.grabbedPrize && !game.releaseStarted ? OUTLET_BOUNDS.releaseClawY : OUTLET_BOUNDS.releaseClawY;

    if (!game.grabbedPrize) {
      claw.closed = approach(claw.closed, 0, dt * 0.0045);
      if (game.stateTime > 520) finishReleaseAttempt(false);
      return;
    }

    if (!game.releaseStarted) {
      claw.closed = approach(claw.closed, CLAW_GRIP_CLOSED, dt * PHYSICS_TUNING.claw.releaseHoldCloseSpeed);
      const overOutlet = Math.abs(claw.x - OUTLET_BOUNDS.centerX) < 0.035
        && Math.abs(claw.z - OUTLET_BOUNDS.centerZ) < 0.035;
      const lowered = Math.abs(claw.y - OUTLET_BOUNDS.releaseClawY) < 0.045;
      game.releaseReadyMs = overOutlet && lowered ? game.releaseReadyMs + dt : 0;
      if (game.releaseReadyMs < OUTLET_BOUNDS.releasePauseMs) return;
      claw.x = OUTLET_BOUNDS.centerX;
      claw.z = OUTLET_BOUNDS.centerZ;
      claw.targetX = OUTLET_BOUNDS.centerX;
      claw.targetZ = OUTLET_BOUNDS.centerZ;
      game.grabbedPrize.body?.velocity.set(0, 0, 0);
      releaseGrabbedPrize();
      game.releaseStarted = true;
      return;
    }
    claw.closed = approach(claw.closed, 0, dt * 0.005);
    if (updateOutletDrop(game.grabbedPrize, dt)) finishReleaseAttempt(true);
  } else if (game.state === STATES.RESULT) {
    claw.targetX = 0;
    claw.targetY = WORLD.clawHomeY;
    claw.targetZ = 0;
    updateStartGesture(dt, 1000, true);
  } else if (game.state === STATES.CELEBRATING || game.state === STATES.RESETTING) {
    claw.targetX = 0;
    claw.targetY = WORLD.clawHomeY;
    claw.targetZ = 0;
    claw.closed = approach(claw.closed, 0, dt * 0.004);
  }
}

function finishReleaseAttempt(success) {
  let celebrationStarted = false;
  if (success && game.grabbedPrize) {
    const prize = game.grabbedPrize;
    game.lastReleaseStats = {
      startY: Number((prize.releaseMotion?.startY || 0).toFixed(3)),
      minY: Number((prize.releaseMotion?.minY || 0).toFixed(3)),
      maxLateralDrift: Number((prize.releaseMotion?.maxLateralDrift || 0).toFixed(3)),
      bounced: Boolean(prize.releaseMotion?.bounced),
      outletBounds: { ...OUTLET_BOUNDS },
    };
    prize.collected = true;
    prize.state = "collected";
    prize.positionOwner = "result";
    prize.object.visible = false;
    if (prize.body) {
      prize.body.velocity.set(0, 0, 0);
      prize.body.angularVelocity.set(0, 0, 0);
      prize.body.collisionResponse = false;
    }
    triggerResultEffect("success");
    celebrationStarted = markPrizeCollected(prize);
  } else {
    game.lastReleaseStats = null;
    triggerResultEffect("miss");
  }
  recordAttempt(success);
  game.demoActive = false;
  game.demoTime = 0;
  game.demoTarget = null;
  game.demoTargetPrizeId = null;
  ui.cameraMessage.textContent = game.inputMode === "camera"
    ? "本次抓取已记录，可继续移动手掌。"
    : "本次抓取已记录，可再次点击开始演示。";
  game.awaitFistRelease = true;
  game.grabbedPrize = null;
  game.releaseStarted = false;
  game.releaseReadyMs = 0;
  claw.targetX = 0;
  claw.targetY = WORLD.clawHomeY;
  claw.targetZ = 0;
  claw.closed = 0;
  if (!celebrationStarted) setState(STATES.CONTROLLING);
}

function updateStartGesture(dt, holdMs, shouldResetRound) {
  game.palmOpenMs = input.openPalm ? game.palmOpenMs + dt : 0;
  if (game.palmOpenMs < holdMs || (shouldResetRound && game.stateTime < 900)) return;

  if (shouldResetRound) resetRoundForReplay();
  if (!shouldResetRound) startSession();
  game.result = "游戏中";
  game.calibration = null;
  game.palmOpenMs = 0;
  setState(STATES.CONTROLLING);
}

function resetRoundForReplay() {
  cancelCelebrationFlow();
  clearEffects();
  game.grabbedPrize = null;
  game.fistMs = 0;
  game.calibration = null;
  game.demoActive = false;
  game.demoTime = 0;
  game.demoTarget = null;
  game.demoTargetPrizeId = null;
  game.releaseStarted = false;
  game.releaseReadyMs = 0;
  game.clawContactMs = 0;
  game.lastCarryMaxRelativeDelta = 0;
  game.lastReleaseStats = null;
  game.round += 1;
  game.collectedPrizeIds.clear();
  game.hasCelebratedCollection = false;
  input.rawX = 0.5;
  input.rawY = 0.5;
  input.x = 0.5;
  input.y = 0.5;
  input.fist = false;
  claw.x = 0;
  claw.y = WORLD.clawHomeY;
  claw.z = 0;
  claw.targetX = 0;
  claw.targetY = WORLD.clawHomeY;
  claw.targetZ = 0;
  claw.closed = 0;
  buildPrizeRound({ resetProgress: true });
}

function updateClaw(dt) {
  if (game.state === STATES.CONTROLLING) {
    claw.targetX = map(input.x, 0, 1, WORLD.xMin, WORLD.xMax);
    claw.targetZ = map(input.y, 0, 1, WORLD.zMin, WORLD.zMax);
    claw.targetY = WORLD.clawHomeY;
    claw.closed = approach(claw.closed, 0, dt * 0.004);
  }

  const follow = 1 - Math.pow(0.002, dt / 1000);
  if (game.grabbedPrize && [STATES.LIFTING, STATES.RETURNING].includes(game.state)) {
    claw.x = approach(claw.x, claw.targetX, dt * HELD_CLAW_TRAVEL_SPEED);
    claw.y = approach(claw.y, claw.targetY, dt * HELD_CLAW_LIFT_SPEED);
    claw.z = approach(claw.z, claw.targetZ, dt * HELD_CLAW_TRAVEL_SPEED);
  } else {
    claw.x = lerp(claw.x, claw.targetX, follow);
    claw.y = lerp(claw.y, claw.targetY, follow);
    claw.z = lerp(claw.z, claw.targetZ, follow);
  }
  constrainClawAgainstPrizes(dt);

  sceneObjects.claw.position.set(claw.x, claw.y, claw.z);
  sceneObjects.fingers.forEach((finger) => {
    const spread = lerp(0.38, 0.14, claw.closed);
    finger.position.set(Math.cos(finger.userData.baseAngle) * spread, -0.08, Math.sin(finger.userData.baseAngle) * spread);
    finger.rotation.z = lerp(0.18, -0.08, claw.closed);
  });

  const cableLength = Math.max(0.35, WORLD.railY - claw.y);
  sceneObjects.cable.scale.set(1, cableLength, 1);
  sceneObjects.cable.position.set(claw.x, claw.y + cableLength / 2, claw.z);
  syncClawCollider(dt);
  if (game.grabbedPrize) syncHeldPrize(game.grabbedPrize, dt);
}

function updatePrizes(now) {
  sceneObjects.prizes.forEach((prize) => {
    if (prize.collected || !prize.object.visible) return;
    if (prize.grabbed) return;
    if (prize.positionOwner === "outlet-drop") {
      if (prize === game.grabbedPrize && game.state === STATES.RELEASING) return;
      updateOutletDrop(prize, 16);
      return;
    }
    if (prize.body && prize.body.position.y < -0.8) resetPrizePhysics(prize, false);
    syncPrizeVisual(prize, "physics-sync");
  });
}

function pickPrize() {
  let best = null;
  let bestDist = Infinity;
  sceneObjects.prizes.forEach((prize) => {
    if (prize.collected) return;
    const px = prize.body ? prize.body.position.x : prize.object.position.x;
    const pz = prize.body ? prize.body.position.z : prize.object.position.z;
    const dist = Math.hypot(px - claw.x, pz - claw.z);
    const tolerance = (prize.grabRadius || prize.radius) + (game.demoActive ? 0.42 : 0.22);
    if (dist < tolerance && dist < bestDist) {
      best = prize;
      bestDist = dist;
    }
  });
  if (!best && game.demoActive && game.demoTargetPrizeId) {
    best = sceneObjects.prizes.find((prize) => (
      prize.id === game.demoTargetPrizeId
      && !prize.collected
      && prize.object.visible
    )) || null;
  }
  return best;
}

function triggerResultEffect(outcome) {
  clearEffects();
  if (outcome === "success") {
    spawnConfetti(WORLD.exit.x, 1.0, WORLD.exit.z, 80, 1.15);
    spawnConfetti(0, 4.28, 1.5, 42, 0.8);
  } else {
    spawnMissSparks(claw.x, claw.y - 0.9, claw.z, 64);
  }
}

function spawnConfetti(x, y, z, count, force) {
  const colors = [0xff5f7e, 0xffc857, 0x55efc4, 0x73d2ff, 0xd5a7ff, 0xfff7e6];
  for (let i = 0; i < count; i += 1) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(random(0.035, 0.08), random(0.012, 0.028), random(0.018, 0.05)),
      new THREE.MeshStandardMaterial({ color: colors[i % colors.length], roughness: 0.45, metalness: 0.05 }),
    );
    mesh.position.set(x, y, z);
    mesh.rotation.set(random(0, Math.PI), random(0, Math.PI), random(0, Math.PI));
    mesh.userData.effect = {
      type: "confetti",
      life: random(1300, 2200),
      maxLife: 2200,
      velocity: new THREE.Vector3(random(-0.006, 0.006) * force, random(0.006, 0.018) * force, random(-0.009, 0.009) * force),
      spin: new THREE.Vector3(random(-0.02, 0.02), random(-0.02, 0.02), random(-0.02, 0.02)),
      gravity: 0.00003,
    };
    sceneObjects.machine.add(mesh);
    sceneObjects.effects.push(mesh);
  }
}

function spawnMissSparks(x, y, z, count) {
  const colors = [0x6f7f8f, 0x9aa7b4, 0x73d2ff, 0xff5f7e];
  for (let i = 0; i < count; i += 1) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(random(0.025, 0.06), 10, 8),
      new THREE.MeshStandardMaterial({ color: colors[i % colors.length], roughness: 0.7, metalness: 0.02 }),
    );
    mesh.position.set(x, y, z);
    mesh.userData.effect = {
      type: "miss",
      life: random(720, 1280),
      maxLife: 1280,
      velocity: new THREE.Vector3(random(-0.004, 0.004), random(-0.005, 0.003), random(-0.006, 0.006)),
      spin: new THREE.Vector3(0, 0, 0),
      gravity: 0.000035,
    };
    sceneObjects.machine.add(mesh);
    sceneObjects.effects.push(mesh);
  }
}

function clearEffects() {
  sceneObjects.effects.forEach((effect) => {
    sceneObjects.machine.remove(effect);
    effect.geometry.dispose();
    effect.material.dispose();
  });
  sceneObjects.effects = [];
}

function updateEffects(dt) {
  sceneObjects.effects.forEach((effect) => {
    const data = effect.userData.effect;
    data.life -= dt;
    data.velocity.y -= data.gravity * dt;
    effect.position.addScaledVector(data.velocity, dt);
    effect.rotation.x += data.spin.x * dt;
    effect.rotation.y += data.spin.y * dt;
    effect.rotation.z += data.spin.z * dt;
    const alpha = clamp(data.life / data.maxLife, 0, 1);
    effect.scale.setScalar(Math.max(0.1, alpha));
  });

  sceneObjects.effects = sceneObjects.effects.filter((effect) => {
    if (effect.userData.effect.life > 0) return true;
    sceneObjects.machine.remove(effect);
    effect.geometry.dispose();
    effect.material.dispose();
    return false;
  });
}

function resizeRenderer() {
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function render(now) {
  camera.lookAt(0, 1.55, 0.18);
  if (sceneObjects.exitGlow) sceneObjects.exitGlow.intensity = 0.46 + Math.sin(now * 0.004) * 0.08;
  renderer.render(scene, camera);
}

function tick(now) {
  beginAuditFrame();
  const dt = Math.min(180, now - game.lastTime || 16);
  game.lastTime = now;

  if (game.inputMode === "camera") readCameraInput();
  if (game.demoActive) readDemoInput(dt);

  input.x = lerp(input.x, input.rawX, 0.18);
  input.y = lerp(input.y, input.rawY, 0.18);

  updateState(dt);
  updateClaw(dt);
  stepPhysics(dt);
  updatePrizes(now);
  updateEffects(dt);
  updateUi();
  render(now);
  animationFrameId = requestAnimationFrame(tick);
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

function formatClock(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatDuration(ms) {
  return `${Math.max(0, ms / 1000).toFixed(1)}s`;
}

function worldXToInput(x) {
  return clamp(map(x, WORLD.xMin, WORLD.xMax, 0, 1), 0, 1);
}

function worldZToInput(z) {
  return clamp(map(z, WORLD.zMin, WORLD.zMax, 0, 1), 0, 1);
}

function random(min, max) {
  return min + Math.random() * (max - min);
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
  reset() {
    resetGame();
  },
  startDemo() {
    if (game.demoActive || (game.state !== STATES.IDLE && game.state !== STATES.CONTROLLING)) return;
    if (game.state === STATES.CONTROLLING && game.collectedPrizeIds.size >= sceneObjects.prizes.length) {
      maybeStartCollectionCelebration();
      return;
    }
    const resumeAudit = positionAudit.active;
    if (!game.sessionActive || game.state === STATES.IDLE) resetGame();
    if (resumeAudit) positionAudit.active = true;
    game.demoTarget = chooseDemoTarget();
    game.demoActive = true;
    game.inputMode = game.inputMode === "camera" ? "camera" : "demo";
    game.demoTime = 0;
    game.fistMs = 0;
    game.awaitFistRelease = false;
    ui.cameraMessage.textContent = "自动演示正在生成模拟手势轨迹。";
  },
  advance(ms, step = 100) {
    const frames = Math.ceil(ms / step);
    for (let i = 0; i < frames; i += 1) {
      beginAuditFrame();
      const dt = Math.min(180, step);
      if (game.inputMode === "camera") readCameraInput();
      if (game.demoActive) readDemoInput(dt);
      input.x = lerp(input.x, input.rawX, 0.18);
      input.y = lerp(input.y, input.rawY, 0.18);
      updateState(dt);
      updateClaw(dt);
      stepPhysics(dt);
      updatePrizes(performance.now());
      updateEffects(dt);
      updateUi();
    }
    render(performance.now());
  },
  getState() {
    return {
      state: game.state,
      result: game.result,
      inputMode: game.inputMode,
      round: game.round,
      roundSeed: game.roundSeed,
      roundSignature: game.roundSignature,
      attempts: game.attempts.length,
      successes: game.attempts.filter((attempt) => attempt.success).length,
      collectedCount: game.collectedPrizeIds.size,
      visiblePrizeCount: sceneObjects.prizes.filter((prize) => prize.object.visible && !prize.collected).length,
      uniquePrizeTypes: new Set(sceneObjects.prizes.map((prize) => prize.definitionId)).size,
      prizeDefinitions: sceneObjects.prizes.map((prize) => ({
        instanceId: prize.instanceId,
        definitionId: prize.definitionId,
        state: prize.state,
        positionOwner: prize.positionOwner,
        mass: Number((prize.mass || 0).toFixed(3)),
        grabRadius: Number((prize.grabRadius || 0).toFixed(3)),
        bodyHalf: prize.bodyHalf
          ? {
              x: Number(prize.bodyHalf.x.toFixed(3)),
              y: Number(prize.bodyHalf.y.toFixed(3)),
              z: Number(prize.bodyHalf.z.toFixed(3)),
            }
          : null,
        position: prize.body
          ? {
              x: Number(prize.body.position.x.toFixed(3)),
              y: Number(prize.body.position.y.toFixed(3)),
              z: Number(prize.body.position.z.toFixed(3)),
            }
          : null,
        speed: prize.body ? Number(prize.body.velocity.length().toFixed(4)) : 0,
        angularSpeed: prize.body ? Number(prize.body.angularVelocity.length().toFixed(4)) : 0,
        sleepState: prize.body?.sleepState ?? null,
      })),
      celebrationCount: game.celebrationCount,
      hasCelebratedCollection: game.hasCelebratedCollection,
      celebrationVisible: ui.celebrationOverlay.classList.contains("is-visible"),
      sessionElapsedMs: Math.round(game.sessionElapsedMs),
      latestAttempt: game.attempts.at(-1) || null,
      canvasPainted: true,
      renderer: "three",
      prizeCount: sceneObjects.prizes.length,
      physicsBodies: physics.world ? physics.world.bodies.length : 0,
      clawColliderCount: physics.clawBodies.length,
      gripConstraintCount: game.grabbedPrize?.gripConstraints?.length || 0,
      grabbedPositionOwner: game.grabbedPrize?.positionOwner || null,
      carryMaxRelativeDelta: Number((game.grabbedPrize?.carryMaxRelativeDelta || game.lastCarryMaxRelativeDelta || 0).toFixed(6)),
      carryVelocity: game.grabbedPrize?.carryVelocity
        ? {
            x: Number(game.grabbedPrize.carryVelocity.x.toFixed(3)),
            y: Number(game.grabbedPrize.carryVelocity.y.toFixed(3)),
            z: Number(game.grabbedPrize.carryVelocity.z.toFixed(3)),
          }
        : null,
      clawY: Number(claw.y.toFixed(3)),
      clawClosed: Number(claw.closed.toFixed(3)),
      grabbedPrizeY: game.grabbedPrize?.body ? Number(game.grabbedPrize.body.position.y.toFixed(3)) : null,
      grabbedPrizeSpeed: game.grabbedPrize?.body ? Number(game.grabbedPrize.body.velocity.length().toFixed(3)) : 0,
      grabbedPrizeAngularSpeed: game.grabbedPrize?.body ? Number(game.grabbedPrize.body.angularVelocity.length().toFixed(3)) : 0,
      clawContactMs: game.clawContactMs,
      effectCount: sceneObjects.effects.length,
      lastReleaseStats: game.lastReleaseStats,
      lastPrewarmStats: game.lastPrewarmStats,
      prizePhysics: (() => {
        const summary = getPrizePhysicsSummary();
        return {
          maxLinearSpeed: Number(summary.maxLinearSpeed.toFixed(4)),
          maxAngularSpeed: Number(summary.maxAngularSpeed.toFixed(4)),
          awakeCount: summary.awakeCount,
          overlapCount: summary.overlapCount,
        };
      })(),
      physicsTuning: {
        toy: {
          minMass: PHYSICS_TUNING.toy.minMass,
          maxMass: PHYSICS_TUNING.toy.maxMass,
          linearDamping: PHYSICS_TUNING.toy.linearDamping,
          angularDamping: PHYSICS_TUNING.toy.angularDamping,
          colliderScale: { ...PHYSICS_TUNING.toy.colliderScale },
        },
        contact: { ...PHYSICS_TUNING.contact },
        simulation: { ...PHYSICS_TUNING.simulation },
      },
      outletBounds: { ...OUTLET_BOUNDS },
    };
  },
  startPositionAudit() {
    resetPositionAudit();
    positionAudit.active = true;
  },
  stopPositionAudit() {
    const summary = {
      active: positionAudit.active,
      samples: positionAudit.samples,
      maxSourcesPerFrame: positionAudit.maxSourcesPerFrame,
    };
    positionAudit.active = false;
    return summary;
  },
  getPositionAudit() {
    return getPositionAuditSnapshot();
  },
  getPositionAuditFrames() {
    return getPositionAuditSnapshot({ includeFrames: true });
  },
  probeClawCollision() {
    resetRoundForReplay();
    const prize = sceneObjects.prizes[0];
    if (!prize?.body) return { displacement: 0, clawColliderCount: physics.clawBodies.length };

    const start = { x: 0.28, y: WORLD.floorY + PRIZE_BODY_OFFSET_Y, z: 0.16 };
    prize.body.position.set(start.x, start.y, start.z);
    prize.body.velocity.set(0, 0, 0);
    prize.body.angularVelocity.set(0, 0, 0);
    prize.body.quaternion.setFromEuler(0, 0, 0);
    prize.body.wakeUp();
    syncPrizeVisual(prize);

    const previousState = game.state;
    game.state = STATES.DROPPING;
    game.clawContactMs = 0;
    claw.x = 0;
    claw.z = 0;
    claw.targetX = 0;
    claw.targetZ = 0;
    claw.closed = 0.2;
    let maxPenetration = 0;
    for (let i = 0; i < 58; i += 1) {
      const t = i / 57;
      claw.y = lerp(WORLD.clawHomeY, WORLD.clawDropY, easeInOut(t));
      constrainClawAgainstPrizes(16);
      syncClawCollider(16);
      stepPhysics(16);
      updatePrizes(performance.now());
      maxPenetration = Math.max(maxPenetration, measureClawPrizePenetration(prize));
    }

    const end = { x: prize.body.position.x, y: prize.body.position.y, z: prize.body.position.z };
    const displacement = Math.hypot(end.x - start.x, end.z - start.z);
    const finalPenetration = measureClawPrizePenetration(prize);
    game.state = previousState;
    resetRoundForReplay();
    render(performance.now());
    return {
      displacement,
      maxPenetration,
      finalPenetration,
      start,
      end,
      clawColliderCount: physics.clawBodies.length,
    };
  },
  collectAllPrizesForTest() {
    if (game.hasCelebratedCollection) return window.__clawDebug.getState();
    startSession();
    sceneObjects.prizes.forEach((prize) => {
      prize.collected = true;
      prize.grabbed = false;
      prize.state = "collected";
      prize.positionOwner = "result";
      prize.object.visible = false;
      if (prize.body) prize.body.collisionResponse = false;
      game.collectedPrizeIds.add(prize.id);
    });
    maybeStartCollectionCelebration();
    return window.__clawDebug.getState();
  },
  setCelebrationSourceForTest(src) {
    celebrationSource = src || CELEBRATION_SRC_DEFAULT;
    if (celebrationPlayer) {
      celebrationPlayer.destroy();
      celebrationPlayer = null;
    }
    celebrationLoadedSource = "";
    ui.celebrationPlayer.replaceChildren();
  },
  previewPrizeRound(seed) {
    return createPrizeRound({ seed: normalizeSeed(seed) });
  },
};

function handlePrimaryAction() {
  if (game.cameraStatus === "loading") return;
  if (game.cameraStatus === "error") {
    retryCamera();
    return;
  }
  window.__clawDebug.startDemo();
}

function handleResultAction() {
  if (game.inputMode === "demo") window.__clawDebug.startDemo();
  game.resultFlashMs = 0;
}

function cleanupPageRuntime() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = 0;
  }
  cancelCelebrationFlow({ destroyPlayer: true });
  stopCameraStream();
  window.removeEventListener("resize", resizeRenderer);
  window.removeEventListener("beforeunload", cleanupPageRuntime);
  ui.primary.removeEventListener("click", handlePrimaryAction);
  ui.resultAction.removeEventListener("click", handleResultAction);
  ui.cameraRetry.removeEventListener("click", retryCamera);
  ui.reset.removeEventListener("click", resetGame);
}

ui.primary.addEventListener("click", handlePrimaryAction);
ui.resultAction.addEventListener("click", handleResultAction);
ui.cameraRetry.addEventListener("click", retryCamera);
ui.reset.addEventListener("click", resetGame);
window.addEventListener("beforeunload", cleanupPageRuntime);

resetGame();
initCameraAndModel().catch((error) => {
  enableDemoMode(error.message || "摄像头不可用。");
});
animationFrameId = requestAnimationFrame(tick);
