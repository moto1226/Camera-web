import { createPrizeRound, DEFAULT_ROUND_OPTIONS, PRIZE_SPAWN_BOUNDS } from "../src/game/prizes/prizeLayout.js";

const seeds = Array.from({ length: 20 }, (_, index) => 1001 + index * 7919);
const signatures = new Set();
const failures = [];

for (const seed of seeds) {
  const round = createPrizeRound({ seed });
  const definitionCounts = new Map();
  const unique = new Set(round.prizes.map((prize) => prize.definition.id));
  round.prizes.forEach((prize) => {
    definitionCounts.set(prize.definition.id, (definitionCounts.get(prize.definition.id) || 0) + 1);
  });

  if (round.prizes.length < DEFAULT_ROUND_OPTIONS.minCount || round.prizes.length > DEFAULT_ROUND_OPTIONS.maxCount) {
    failures.push(`seed ${seed}: count ${round.prizes.length}`);
  }
  if (unique.size < DEFAULT_ROUND_OPTIONS.minUniqueTypes) {
    failures.push(`seed ${seed}: unique ${unique.size}`);
  }
  for (const [definitionId, count] of definitionCounts) {
    if (count > DEFAULT_ROUND_OPTIONS.maxDuplicatePerType) {
      failures.push(`seed ${seed}: ${definitionId} count ${count}`);
    }
  }
  if (!round.prizes.some((prize) => prize.definition.id === "cube_bunny")) {
    failures.push(`seed ${seed}: missing required current bunny`);
  }

  round.prizes.forEach((prize, index) => {
    const { x, z } = prize.transform.position;
    const radius = prize.boundsRadius || prize.placementRadius;
    if (
      x < PRIZE_SPAWN_BOUNDS.minX + radius
      || x > PRIZE_SPAWN_BOUNDS.maxX - radius
      || z < PRIZE_SPAWN_BOUNDS.minZ + radius
      || z > PRIZE_SPAWN_BOUNDS.maxZ - radius
    ) {
      failures.push(`seed ${seed}: prize ${index} outside bounds`);
    }
    const excluded = PRIZE_SPAWN_BOUNDS.excludedZones.some((zone) => (
      x >= zone.minX && x <= zone.maxX && z >= zone.minZ && z <= zone.maxZ
    ));
    if (excluded) failures.push(`seed ${seed}: prize ${index} inside excluded zone`);
  });

  for (let i = 0; i < round.prizes.length; i += 1) {
    for (let j = i + 1; j < round.prizes.length; j += 1) {
      const a = round.prizes[i];
      const b = round.prizes[j];
      const distance = Math.hypot(
        a.transform.position.x - b.transform.position.x,
        a.transform.position.z - b.transform.position.z,
      );
      if (distance < 0.001) failures.push(`seed ${seed}: overlapping centers ${i}/${j}`);
      const minDistance = ((a.collisionRadius || a.placementRadius) + (b.collisionRadius || b.placementRadius)) * 0.9;
      if (distance < minDistance) {
        failures.push(`seed ${seed}: collider overlap ${i}/${j} distance=${distance.toFixed(3)} min=${minDistance.toFixed(3)}`);
      }
      if (a.collisionHalf && b.collisionHalf) {
        const overlapX = Math.abs(a.transform.position.x - b.transform.position.x)
          < (a.collisionHalf.x + b.collisionHalf.x) * 0.96;
        const overlapZ = Math.abs(a.transform.position.z - b.transform.position.z)
          < (a.collisionHalf.z + b.collisionHalf.z) * 0.96;
        if (overlapX && overlapZ) {
          failures.push(`seed ${seed}: aabb overlap ${i}/${j}`);
        }
      }
    }
  }

  signatures.add(round.signature);
}

const sameA = createPrizeRound({ seed: 424242 });
const sameB = createPrizeRound({ seed: 424242 });
if (JSON.stringify(sameA.prizes.map(toComparable)) !== JSON.stringify(sameB.prizes.map(toComparable))) {
  failures.push("same seed did not reproduce identical layout");
}

const differentA = createPrizeRound({ seed: 424243 });
if (JSON.stringify(sameA.prizes.map(toComparable)) === JSON.stringify(differentA.prizes.map(toComparable))) {
  failures.push("different seed produced identical layout");
}

if (signatures.size < 8) failures.push(`20 seeds produced too few model combinations: ${signatures.size}`);

if (failures.length) {
  throw new Error(failures.join("\n"));
}

console.log(JSON.stringify({
  rounds: seeds.length,
  uniqueSignatures: signatures.size,
  countRange: [DEFAULT_ROUND_OPTIONS.minCount, DEFAULT_ROUND_OPTIONS.maxCount],
  minUniqueTypes: DEFAULT_ROUND_OPTIONS.minUniqueTypes,
  maxDuplicatePerType: DEFAULT_ROUND_OPTIONS.maxDuplicatePerType,
}));

function toComparable(prize) {
  return {
    id: prize.definition.id,
    x: Number(prize.transform.position.x.toFixed(4)),
    z: Number(prize.transform.position.z.toFixed(4)),
    sx: Number(prize.transform.scale.toFixed(4)),
    ry: Number(prize.transform.rotation.y.toFixed(4)),
  };
}
