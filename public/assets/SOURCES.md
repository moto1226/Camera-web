# Asset Sources

- This prototype uses selected CC0 3D GLB assets recorded in `THIRD_PARTY_ASSETS.md`.
- Claw machine cabinet, glass, lighting, UI details, and fallback toys are generated with Three.js/CSS in this repository.
- MediaPipe WASM runtime files are copied from the npm package `@mediapipe/tasks-vision`.
- `models/hand_landmarker.task` is the official MediaPipe Hand Landmarker float16 model downloaded from `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`.

## 3D Prototype Asset Candidates

Selected for the Three.js version. These files are copied into `models/3d/`.

### Kenney Cube Pets

- Source: https://kenney.nl/assets/cube-pets
- License: Creative Commons CC0
- Reason: Small GLB files, toy-like animal shapes, good fit for mobile Web prizes.
- Selected files:
  - `models/3d/prizes/animal-bunny.glb`
  - `models/3d/prizes/animal-cat.glb`
  - `models/3d/prizes/animal-dog.glb`
  - `models/3d/prizes/animal-panda.glb`
  - `models/3d/prizes/animal-penguin.glb`
  - `models/3d/prizes/animal-tiger.glb`
  - `models/3d/prizes/animal-fox.glb`
  - `models/3d/prizes/animal-koala.glb`
  - `models/3d/prizes/animal-lion.glb`
  - `models/3d/prizes/animal-monkey.glb`
  - `models/3d/prizes/animal-bee.glb`
  - `models/3d/prizes/animal-crab.glb`
  - `models/3d/prizes/Textures/colormap.png`

### Kenney Factory Kit

- Source: https://kenney.nl/assets/factory-kit
- License: Creative Commons CC0
- Reason: Lightweight mechanical GLB parts suitable for a claw-machine rail, lift, gripper assembly, and machine dressing.
- Selected files:
  - `models/3d/claw-machine/crane.glb`
  - `models/3d/claw-machine/crane-lift.glb`
  - `models/3d/claw-machine/robot-arm-a.glb`
  - `models/3d/claw-machine/robot-arm-b.glb`
  - `models/3d/claw-machine/piston-thin-round.glb`
  - `models/3d/claw-machine/cog-b.glb`
  - `models/3d/claw-machine/machine-window.glb`
  - `models/3d/claw-machine/conveyor-long.glb`
  - `models/3d/prizes/gift-box-small.glb`
  - `models/3d/prizes/gift-box-wide.glb`

### Optional Claw Reference

- Source: https://sketchfab.com/3d-models/claw-451-open-and-closed-cf4f475c33c64b139eed8e88a7a02917
- License: Creative Commons Attribution
- Reason: Very relevant arcade claw shape, low poly, but Sketchfab requires authenticated download. Prefer Kenney CC0 mechanical parts or custom Three.js geometry unless attribution/download friction is acceptable.
