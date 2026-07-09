import "./styles.css";
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import * as CANNON from "cannon-es";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const canvas = document.getElementById("game-canvas");
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
  demoActive: false,
  demoTime: 0,
  round: 0,
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
const PRIZE_MASS = 0.58;
const PRIZE_BODY_HALF = { x: 0.28, y: 0.36, z: 0.26 };
const CLAW_CONTACT_SKIN = 0.025;
const CLAW_SIDE_GRIP_Y = 0.13;
const GRIP_CONSTRAINT_FORCE = 28;
const DEMO_TARGET = { x: 0.18, z: 1.05 };
const physics = {
  world: null,
  prizeMaterial: null,
  wallMaterial: null,
  clawMaterial: null,
  clawBody: null,
  clawBodies: [],
  gripAnchors: [],
  fixedTimeStep: 1 / 60,
  maxSubSteps: 5,
};

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

const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 60);
camera.position.set(0, 4.65, 8.7);

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
    color: 0x8bd8ff,
    transparent: true,
    opacity: 0.22,
    roughness: 0.04,
    metalness: 0,
    transmission: 0.16,
    depthWrite: false,
  }),
  floor: new THREE.MeshStandardMaterial({ color: 0x111820, roughness: 0.78, metalness: 0.05 }),
  rail: new THREE.MeshStandardMaterial({ color: 0xffe3a4, roughness: 0.28, metalness: 0.32 }),
  clawBody: new THREE.MeshStandardMaterial({ color: 0x3b2416, roughness: 0.45, metalness: 0.18 }),
  clawMetal: new THREE.MeshStandardMaterial({ color: 0xe9edf0, roughness: 0.24, metalness: 0.42 }),
  mint: new THREE.MeshStandardMaterial({ color: 0x55efc4, roughness: 0.35, metalness: 0.08, emissive: 0x0b5a46 }),
  red: new THREE.MeshStandardMaterial({ color: 0xff5f7e, roughness: 0.5, metalness: 0.05, emissive: 0x45111c }),
  shadow: new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.34 }),
};

const PRIZE_ASSETS = [
  "/assets/models/3d/prizes/animal-bunny.glb",
  "/assets/models/3d/prizes/animal-cat.glb",
  "/assets/models/3d/prizes/animal-dog.glb",
  "/assets/models/3d/prizes/animal-panda.glb",
  "/assets/models/3d/prizes/animal-penguin.glb",
  "/assets/models/3d/prizes/animal-tiger.glb",
];

let handLandmarker = null;
let cameraStarted = false;

scene.add(sceneObjects.root);
sceneObjects.root.add(sceneObjects.machine);
buildLights();
buildMachine();
buildClaw();
initPhysics();
buildPrizePlaceholders();
loadPrizeModels();
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
  addBox(m, [6.2, 0.12, 0.12], [0, WORLD.railY, 0.05], mats.rail, true);
  addBox(m, [0.16, 0.16, 3.8], [-3.08, WORLD.railY - 0.04, 0], mats.rail, true);
  addBox(m, [0.16, 0.16, 3.8], [3.08, WORLD.railY - 0.04, 0], mats.rail, true);

  addGlassPanel([0, 2.0, 2.0], [6.85, 3.45, 0.04]);
  addGlassPanel([-3.45, 2.0, 0], [0.04, 3.45, 3.95]);
  addGlassPanel([3.45, 2.0, 0], [0.04, 3.45, 3.95]);

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
  addBox(exit, [1.18, 0.18, 0.74], [0, 0.03, 0], mats.shellDark, true);
  addBox(exit, [0.88, 0.08, 0.48], [0, 0.14, 0.02], mats.mint, false);
  sceneObjects.exitGlow = new THREE.PointLight(0x55efc4, 1.2, 2.4);
  sceneObjects.exitGlow.position.set(0, 0.38, 0.08);
  exit.add(sceneObjects.exitGlow);
  m.add(exit);

  const chuteLabel = makeTextSprite("PRIZE", {
    fontSize: 64,
    color: "#55efc4",
    bg: "rgba(0,0,0,0)",
    width: 360,
    height: 120,
  });
  chuteLabel.position.set(WORLD.exit.x, 0.55, WORLD.exit.z + 0.3);
  chuteLabel.scale.set(0.82, 0.26, 1);
  m.add(chuteLabel);

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

function buildPrizePlaceholders() {
  const positions = [
    [-2.05, 0, -0.92],
    [-0.75, 0, -1.08],
    [0.75, 0, -0.94],
    [2.0, 0, -1.04],
    [-2.25, 0, 0.18],
    [-0.55, 0, 0.12],
    [0.9, 0, 0.18],
    [2.15, 0, 0.1],
    [-1.65, 0, 1.05],
    [0.18, 0, 1.05],
  ];

  positions.forEach((pos, index) => {
    const mesh = createPlushPlaceholder(index);
    mesh.position.set(pos[0], 0, pos[2]);
    sceneObjects.machine.add(mesh);

    const prize = {
      id: `prize-${index}`,
      object: mesh,
      home: mesh.position.clone(),
      radius: 0.46,
      grabbed: false,
      collected: false,
      wobble: Math.random() * Math.PI * 2,
      body: null,
      bodyOffsetY: PRIZE_BODY_OFFSET_Y,
      holdSpin: 0,
      holdOffset: null,
      holdBlend: 0,
      gripConstraints: [],
    };
    createPrizeBody(prize);
    sceneObjects.prizes.push(prize);
  });
}

function createPlushPlaceholder(index) {
  const color = [0xff9f43, 0x55efc4, 0x73d2ff, 0xff5f7e, 0xd5a7ff, 0xffd776][index % 6];
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

async function loadPrizeModels() {
  const selected = sceneObjects.prizes;
  await Promise.allSettled(
    selected.map(async (prize, index) => {
      const gltf = await loader.loadAsync(PRIZE_ASSETS[index % PRIZE_ASSETS.length]);
      const model = gltf.scene;
      normalizeModel(model, 0.82);
      model.position.copy(prize.object.position);
      model.rotation.y = random(-0.4, 0.4);
      model.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      sceneObjects.machine.add(model);
      sceneObjects.machine.remove(prize.object);
      prize.object = model;
      prize.home = model.position.clone();
      prize.radius = 0.5;
      syncPrizeVisual(prize);
    }),
  );
}

function normalizeModel(model, targetHeight) {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const scale = targetHeight / Math.max(size.y, 0.001);
  model.scale.multiplyScalar(scale);
  const nextBox = new THREE.Box3().setFromObject(model);
  const center = nextBox.getCenter(new THREE.Vector3());
  model.position.sub(center);
  model.position.y += targetHeight / 2;
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
    { friction: 0.82, restitution: 0.08, contactEquationStiffness: 7e6 },
  ));
  physics.world.addContactMaterial(new CANNON.ContactMaterial(
    physics.prizeMaterial,
    physics.wallMaterial,
    { friction: 0.7, restitution: 0.12 },
  ));
  physics.world.addContactMaterial(new CANNON.ContactMaterial(
    physics.prizeMaterial,
    physics.clawMaterial,
    { friction: 0.45, restitution: 0.05 },
  ));

  addStaticBody([0, -0.08, 0.05], [3.45, 0.08, 2.2]);
  addStaticBody([WORLD.xMin - 0.28, 0.72, 0.05], [0.1, 0.72, 2.1]);
  addStaticBody([WORLD.xMax + 0.28, 0.72, 0.05], [0.1, 0.72, 2.1]);
  addStaticBody([0, 0.72, WORLD.zMin - 0.26], [3.35, 0.72, 0.1]);
  addStaticBody([0, 0.72, WORLD.zMax + 0.22], [3.35, 0.72, 0.1]);

  physics.clawBody = createClawCollider(0.15, "hub");
  for (let i = 0; i < 3; i += 1) {
    createClawCollider(0.16, `knuckle-${i}`);
    createClawCollider(0.16, `tip-${i}`);
    createGripAnchor();
  }
  syncClawCollider(16, true);
  syncGripAnchors(16, true);
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
  body.collisionResponse = true;
  body.userData = { role, radius };
  physics.world.addBody(body);
  physics.clawBodies.push(body);
  return body;
}

function createGripAnchor() {
  const body = new CANNON.Body({
    mass: 0,
    type: CANNON.Body.KINEMATIC,
    material: physics.clawMaterial,
    collisionResponse: false,
  });
  physics.world.addBody(body);
  physics.gripAnchors.push(body);
  return body;
}

function createPrizeBody(prize) {
  if (!physics.world) return null;

  const body = new CANNON.Body({
    mass: PRIZE_MASS,
    material: physics.prizeMaterial,
    linearDamping: 0.62,
    angularDamping: 0.82,
    allowSleep: true,
    sleepSpeedLimit: 0.05,
    sleepTimeLimit: 0.45,
  });
  body.addShape(new CANNON.Box(new CANNON.Vec3(PRIZE_BODY_HALF.x, PRIZE_BODY_HALF.y, PRIZE_BODY_HALF.z)));
  body.position.set(prize.home.x, prize.home.y + PRIZE_BODY_OFFSET_Y, prize.home.z);
  body.quaternion.setFromEuler(0, random(-0.35, 0.35), 0);
  physics.world.addBody(body);

  prize.body = body;
  prize.bodyOffsetY = PRIZE_BODY_OFFSET_Y;
  prize.holdSpin = 0;
  syncPrizeVisual(prize);
  return body;
}

function syncPrizeVisual(prize) {
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
}

function resetPrizePhysics(prize, rotate = true) {
  if (!prize.body) return;
  prize.body.type = CANNON.Body.DYNAMIC;
  prize.body.mass = PRIZE_MASS;
  prize.body.collisionResponse = true;
  prize.body.updateMassProperties();
  prize.body.position.set(prize.home.x, prize.home.y + (prize.bodyOffsetY || PRIZE_BODY_OFFSET_Y), prize.home.z);
  prize.body.velocity.set(0, 0, 0);
  prize.body.angularVelocity.set(0, 0, 0);
  prize.body.force.set(0, 0, 0);
  prize.body.torque.set(0, 0, 0);
  prize.body.quaternion.setFromEuler(0, rotate ? random(-0.35, 0.35) : 0, 0);
  prize.body.wakeUp();
  prize.holdSpin = 0;
  prize.holdOffset = null;
  prize.holdBlend = 0;
  clearPrizeGrip(prize);
  syncPrizeVisual(prize);
}

function capturePrize(prize) {
  prize.grabbed = true;
  if (!prize.body) return;

  clearPrizeGrip(prize);
  prize.body.type = CANNON.Body.DYNAMIC;
  prize.body.mass = PRIZE_MASS;
  prize.body.collisionResponse = true;
  prize.body.updateMassProperties();
  prize.body.linearDamping = 0.76;
  prize.body.angularDamping = 0.9;
  prize.body.wakeUp();

  syncGripAnchors(16, true);
  const anchors = getGripAnchorTargets();
  prize.gripConstraints = anchors.map((target, index) => {
    const anchor = physics.gripAnchors[index];
    const worldPivot = new CANNON.Vec3(target.x, target.y, target.z);
    const localPivot = prize.body.pointToLocalFrame(worldPivot);
    localPivot.x = clamp(localPivot.x, -PRIZE_BODY_HALF.x, PRIZE_BODY_HALF.x);
    localPivot.y = clamp(localPivot.y, -PRIZE_BODY_HALF.y * 0.55, PRIZE_BODY_HALF.y * 0.55);
    localPivot.z = clamp(localPivot.z, -PRIZE_BODY_HALF.z, PRIZE_BODY_HALF.z);
    const constraint = new CANNON.PointToPointConstraint(
      prize.body,
      localPivot,
      anchor,
      new CANNON.Vec3(0, 0, 0),
      GRIP_CONSTRAINT_FORCE,
    );
    physics.world.addConstraint(constraint);
    return constraint;
  });
  syncPrizeVisual(prize);
}

function syncHeldPrize(prize, dt) {
  if (!prize.body) return;
  syncGripAnchors(dt);
  prize.body.wakeUp();
  syncPrizeVisual(prize);
}

function releaseGrabbedPrize() {
  const prize = game.grabbedPrize;
  if (!prize) return;

  prize.grabbed = false;
  prize.holdOffset = null;
  prize.holdBlend = 0;
  if (!prize.body) return;
  clearPrizeGrip(prize);
  prize.body.type = CANNON.Body.DYNAMIC;
  prize.body.mass = PRIZE_MASS;
  prize.body.collisionResponse = true;
  prize.body.updateMassProperties();
  prize.body.linearDamping = 0.62;
  prize.body.angularDamping = 0.82;
  prize.body.velocity.x += random(-0.2, 0.15);
  prize.body.velocity.y -= 0.85;
  prize.body.velocity.z += random(0.18, 0.55);
  prize.body.angularVelocity.set(random(-1.6, 1.6), random(-2.0, 2.0), random(-1.6, 1.6));
  prize.body.wakeUp();
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
    if (distance > 1.4) {
      body.position.set(target.x, target.y, target.z);
      body.previousPosition.copy(body.position);
      body.velocity.set(0, 0, 0);
    } else {
      body.velocity.set(dx / seconds, dy / seconds, dz / seconds);
    }
    body.aabbNeedsUpdate = true;
  });
  wakePrizesNearClaw(targets);
}

function syncGripAnchors(dt, teleport = false) {
  if (!physics.gripAnchors.length) return;

  const seconds = Math.max(dt / 1000, 1 / 120);
  getGripAnchorTargets().forEach((target, index) => {
    const body = physics.gripAnchors[index];
    if (!body) return;

    const dx = target.x - body.position.x;
    const dy = target.y - body.position.y;
    const dz = target.z - body.position.z;
    if (teleport || Math.hypot(dx, dy, dz) > 1.4) {
      body.position.set(target.x, target.y, target.z);
      body.previousPosition.copy(body.position);
      body.velocity.set(0, 0, 0);
    } else {
      body.velocity.set(dx / seconds, dy / seconds, dz / seconds);
      body.position.set(target.x, target.y, target.z);
    }
    body.aabbNeedsUpdate = true;
  });
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

function getGripAnchorTargets() {
  return getClawColliderTargets(claw.y).filter((target) => target.role.startsWith("tip"));
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
      const prizeTop = prize.body.position.y + PRIZE_BODY_HALF.y;
      const topContact = getTopContactDepth(target, prize, dx, dz);
      const sideContact = getSideContactStrength(target, prize, dx, dz);

      if (topContact > 0) {
        const minTargetY = prizeTop + target.radius + CLAW_CONTACT_SKIN;
        lift = Math.max(lift, minTargetY - target.y);
        touching = true;
        pushPrizeAwayFromClaw(prize, target, 0.2, dt);
      } else if (sideContact > 0) {
        touching = true;
        pushPrizeAwayFromClaw(prize, target, sideContact, dt);
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

  const topBlockX = PRIZE_BODY_HALF.x * 0.55 + target.radius * 0.35;
  const topBlockZ = PRIZE_BODY_HALF.z * 0.55 + target.radius * 0.35;
  const normalized = (dx * dx) / (topBlockX * topBlockX) + (dz * dz) / (topBlockZ * topBlockZ);
  if (normalized > 1) return 0;

  const prizeTop = prize.body.position.y + PRIZE_BODY_HALF.y;
  const minTargetY = prizeTop + target.radius + CLAW_CONTACT_SKIN;
  return Math.max(0, minTargetY - target.y);
}

function getSideContactStrength(target, prize, dx, dz) {
  if (target.role === "hub") return 0;

  const prizeTop = prize.body.position.y + PRIZE_BODY_HALF.y;
  const sideBandTop = prizeTop - CLAW_SIDE_GRIP_Y;
  const sideBandBottom = prize.body.position.y - PRIZE_BODY_HALF.y * 0.72;
  if (target.y > sideBandTop || target.y < sideBandBottom) return 0;

  const sideX = PRIZE_BODY_HALF.x + target.radius * 0.85;
  const sideZ = PRIZE_BODY_HALF.z + target.radius * 0.85;
  const normalized = (dx * dx) / (sideX * sideX) + (dz * dz) / (sideZ * sideZ);
  if (normalized > 1) return 0;
  return Math.max(0.18, 1 - Math.sqrt(normalized));
}

function pushPrizeAwayFromClaw(prize, target, strength, dt) {
  const body = prize.body;
  const dx = body.position.x - target.x;
  const dz = body.position.z - target.z;
  let length = Math.hypot(dx, dz);
  let nx = dx;
  let nz = dz;

  if (length < 0.001) {
    nx = body.position.x - claw.x || 0.001;
    nz = body.position.z - claw.z || 0.001;
    length = Math.hypot(nx, nz);
  }

  nx /= length;
  nz /= length;
  const impulse = strength * Math.min(4.2, 1.8 + dt * 0.012);
  body.velocity.x += nx * impulse;
  body.velocity.z += nz * impulse;
  body.angularVelocity.x += nz * strength * 2.2;
  body.angularVelocity.z -= nx * strength * 2.2;
  body.wakeUp();
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

function stepPhysics(dt) {
  if (!physics.world) return;
  physics.world.step(physics.fixedTimeStep, Math.min(dt / 1000, 0.05), physics.maxSubSteps);
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
  }

  const cnv = document.createElement("canvas");
  cnv.width = 920;
  cnv.height = 300;
  const c = cnv.getContext("2d");
  c.fillStyle = "rgba(5, 9, 12, 0.78)";
  roundedCanvasRect(c, 0, 0, cnv.width, cnv.height, 34);
  c.fill();
  c.strokeStyle = "rgba(255, 247, 230, 0.18)";
  c.lineWidth = 3;
  c.stroke();
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillStyle = "#fff7e6";
  c.font = "900 88px Trebuchet MS, Microsoft YaHei, sans-serif";
  c.fillText(text, cnv.width / 2, 118);
  c.fillStyle = "#ffc857";
  c.font = "700 42px Trebuchet MS, Microsoft YaHei, sans-serif";
  c.fillText(subtext, cnv.width / 2, 210);

  const texture = new THREE.CanvasTexture(cnv);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(4.2, 1.36, 1);
  sprite.position.set(0, 2.22, 2.16);
  sprite.renderOrder = 20;
  sceneObjects.messageSprite = sprite;
  sceneObjects.machine.add(sprite);
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

function enableDemoMode(reason) {
  game.inputMode = "demo";
  ui.cameraMessage.textContent = `演示模式：${reason} 可点击自动演示验证流程。`;
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
  const mirroredPalmCenter = toMirroredPalmCenter(hand.palmCenter);
  game.handPresent = true;
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
  const targetX = worldXToInput(DEMO_TARGET.x);
  const targetY = worldZToInput(DEMO_TARGET.z);
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
  }
}

function setState(next) {
  if (game.state === next) return;
  game.state = next;
  game.stateTime = 0;
  ui.state.textContent = STATE_LABELS[next];
  window.__clawGameState = game.state;
  updateMessage();
}

function resetGame() {
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
  game.round += 1;
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
  sceneObjects.prizes.forEach((prize) => {
    prize.object.visible = true;
    prize.grabbed = false;
    prize.collected = false;
    resetPrizePhysics(prize);
  });
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
  ui.gesture.textContent = input.fist ? "攥拳" : input.openPalm ? "张开手掌" : game.handPresent ? "手已入镜" : "未检测";
  ui.result.textContent = game.result;
  ui.meterX.value = input.x;
  ui.meterY.value = input.y;
}

function updateMessage() {
  if (game.state === STATES.IDLE) {
    setMessage("张开手掌开始", "无摄像头可点自动演示");
  } else if (game.state === STATES.RESULT) {
    setMessage(game.result, "张开手掌或点自动演示再来一局");
  } else if (sceneObjects.messageSprite) {
    sceneObjects.machine.remove(sceneObjects.messageSprite);
    sceneObjects.messageSprite.material.map.dispose();
    sceneObjects.messageSprite.material.dispose();
    sceneObjects.messageSprite = null;
  }
}

function updateState(dt) {
  game.stateTime += dt;

  if (game.state === STATES.IDLE) {
    updateStartGesture(dt, 900, false);
  } else if (game.state === STATES.CONTROLLING) {
    game.fistMs = input.fist ? game.fistMs + dt : 0;
    if (game.fistMs >= 280) {
      game.fistMs = 0;
      setState(STATES.DROPPING);
    }
  } else if (game.state === STATES.DROPPING) {
    claw.targetY = WORLD.clawDropY;
    claw.closed = approach(claw.closed, 0.2, dt * 0.006);
    if (Math.abs(claw.y - WORLD.clawDropY) < 0.05 || game.clawContactMs > 180 || game.stateTime > 1500) {
      setState(STATES.GRABBING);
    }
  } else if (game.state === STATES.GRABBING) {
    claw.closed = approach(claw.closed, 1, dt * 0.004);
    if (game.stateTime > 560) {
      game.grabbedPrize = pickPrize();
      if (game.grabbedPrize) capturePrize(game.grabbedPrize);
      setState(STATES.LIFTING);
    }
  } else if (game.state === STATES.LIFTING) {
    claw.targetY = WORLD.clawHomeY;
    if (Math.abs(claw.y - WORLD.clawHomeY) < 0.05) setState(STATES.RETURNING);
  } else if (game.state === STATES.RETURNING) {
    claw.targetX = WORLD.exit.x;
    claw.targetZ = WORLD.exit.z - 0.08;
    claw.targetY = WORLD.clawHomeY;
    if (Math.abs(claw.x - claw.targetX) < 0.07 && Math.abs(claw.z - claw.targetZ) < 0.07) {
      game.releaseStarted = false;
      setState(STATES.RELEASING);
    }
  } else if (game.state === STATES.RELEASING) {
    claw.closed = approach(claw.closed, 0, dt * 0.0045);
    if (game.grabbedPrize && !game.releaseStarted) {
      releaseGrabbedPrize();
      game.releaseStarted = true;
    }
    if (game.stateTime > 760) {
      if (game.grabbedPrize) {
        game.grabbedPrize.collected = true;
        game.grabbedPrize.object.visible = false;
        game.result = "抓到了";
        triggerResultEffect("success");
      } else {
        game.result = "差一点";
        triggerResultEffect("miss");
      }
      game.demoActive = false;
      setState(STATES.RESULT);
    }
  } else if (game.state === STATES.RESULT) {
    claw.targetX = 0;
    claw.targetY = WORLD.clawHomeY;
    claw.targetZ = 0;
    updateStartGesture(dt, 1000, true);
  }
}

function updateStartGesture(dt, holdMs, shouldResetRound) {
  game.palmOpenMs = input.openPalm ? game.palmOpenMs + dt : 0;
  if (game.palmOpenMs < holdMs || (shouldResetRound && game.stateTime < 900)) return;

  if (shouldResetRound) resetRoundForReplay();
  game.result = "游戏中";
  game.calibration = null;
  game.palmOpenMs = 0;
  setState(STATES.CONTROLLING);
}

function resetRoundForReplay() {
  clearEffects();
  game.grabbedPrize = null;
  game.fistMs = 0;
  game.calibration = null;
  game.demoActive = false;
  game.demoTime = 0;
  game.releaseStarted = false;
  game.clawContactMs = 0;
  game.round += 1;
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
  sceneObjects.prizes.forEach((prize) => {
    prize.object.visible = true;
    prize.grabbed = false;
    prize.collected = false;
    resetPrizePhysics(prize);
  });
}

function updateClaw(dt) {
  if (game.state === STATES.CONTROLLING) {
    claw.targetX = map(input.x, 0, 1, WORLD.xMin, WORLD.xMax);
    claw.targetZ = map(input.y, 0, 1, WORLD.zMin, WORLD.zMax);
    claw.targetY = WORLD.clawHomeY;
    claw.closed = approach(claw.closed, 0, dt * 0.004);
  }

  const follow = 1 - Math.pow(0.002, dt / 1000);
  claw.x = lerp(claw.x, claw.targetX, follow);
  claw.y = lerp(claw.y, claw.targetY, follow);
  claw.z = lerp(claw.z, claw.targetZ, follow);
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
    if (prize.grabbed) {
      syncPrizeVisual(prize);
      return;
    }
    if (prize.body && prize.body.position.y < -0.8) resetPrizePhysics(prize, false);
    syncPrizeVisual(prize);
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
    if (dist < prize.radius + 0.22 && dist < bestDist) {
      best = prize;
      bestDist = dist;
    }
  });
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
  camera.lookAt(0, 1.85, 0.08);
  if (sceneObjects.exitGlow) sceneObjects.exitGlow.intensity = 1.1 + Math.sin(now * 0.006) * 0.35;
  renderer.render(scene, camera);
}

function tick(now) {
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
  requestAnimationFrame(tick);
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
  startDemo() {
    resetGame();
    game.demoActive = true;
    game.inputMode = game.inputMode === "camera" ? "camera" : "demo";
    game.demoTime = 0;
    ui.cameraMessage.textContent = "自动演示正在生成模拟手势轨迹。";
  },
  advance(ms, step = 100) {
    const frames = Math.ceil(ms / step);
    for (let i = 0; i < frames; i += 1) {
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
      canvasPainted: true,
      renderer: "three",
      prizeCount: sceneObjects.prizes.length,
      physicsBodies: physics.world ? physics.world.bodies.length : 0,
      clawColliderCount: physics.clawBodies.length,
      gripConstraintCount: game.grabbedPrize?.gripConstraints?.length || 0,
      clawContactMs: game.clawContactMs,
      effectCount: sceneObjects.effects.length,
    };
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
};

ui.demo.addEventListener("click", () => window.__clawDebug.startDemo());
ui.reset.addEventListener("click", resetGame);

resetGame();
initCameraAndModel().catch((error) => {
  enableDemoMode(error.message || "摄像头不可用。");
});
requestAnimationFrame(tick);
