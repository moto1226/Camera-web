import { PRIZE_MANIFEST } from "./prizeManifest.js";
import { createSeededRandom, randomInt, randomRange, shuffleWithRng } from "./seededRandom.js";

export const DEFAULT_ROUND_OPTIONS = {
  minCount: 12,
  maxCount: 16,
  totalCount: 12,
  minUniqueTypes: 7,
  maxDuplicatePerType: 2,
};

export const PRIZE_SPAWN_BOUNDS = {
  minX: -2.55,
  maxX: 2.55,
  minZ: -1.24,
  maxZ: 1.16,
  baseY: 0,
  excludedZones: [
    { minX: -3.35, maxX: -2.05, minZ: 1.18, maxZ: 2.38 },
    { minX: -0.78, maxX: 0.78, minZ: -0.58, maxZ: 0.58 },
  ],
};

const PRIZE_SCALE_BOOST = 1.1;

export function createPrizeRound(options = {}) {
  const config = { ...DEFAULT_ROUND_OPTIONS, ...options };
  const seed = options.seed >>> 0;
  const rng = createSeededRandom(seed);
  const totalCount = clamp(
    options.totalCount ?? config.totalCount ?? randomInt(rng, config.minCount, config.maxCount),
    config.minCount,
    config.maxCount,
  );
  const definitions = PRIZE_MANIFEST.filter((definition) => definition.enabled);
  const selected = selectDefinitions(definitions, {
    rng,
    totalCount,
    minUniqueTypes: Math.min(config.minUniqueTypes, definitions.length),
    maxDuplicatePerType: config.maxDuplicatePerType,
    previousSignature: options.previousSignature,
  });
  const layout = createLayout(selected, rng, PRIZE_SPAWN_BOUNDS);
  const signature = selected.map((definition) => definition.id).sort().join("|");
  return {
    seed,
    signature,
    bounds: PRIZE_SPAWN_BOUNDS,
    prizes: layout.map((item, index) => ({
      instanceId: `round-${seed}-${index}-${item.definition.id}`,
      definition: item.definition,
      transform: item.transform,
      colorVariant: item.colorVariant,
      placementRadius: item.placementRadius,
    })),
  };
}

export function getEnabledPrizeDefinitions() {
  return PRIZE_MANIFEST.filter((definition) => definition.enabled);
}

function selectDefinitions(definitions, options) {
  const counts = new Map();
  const selected = [];
  const forceDefinition = definitions.find((definition) => definition.id === "cube_bunny") || definitions[0];
  addDefinition(forceDefinition);

  const shuffled = shuffleWithRng(definitions, options.rng)
    .filter((definition) => definition !== forceDefinition);
  while (new Set(selected.map((definition) => definition.id)).size < options.minUniqueTypes && shuffled.length) {
    addDefinition(shuffled.shift());
  }

  while (selected.length < options.totalCount) {
    const definition = weightedPick(
      definitions.filter((item) => canAdd(item)),
      options.rng,
    );
    if (!definition) break;
    addDefinition(definition);
  }

  if (selected.length < options.totalCount) {
    definitions.forEach((definition) => {
      if (selected.length < options.totalCount && canAdd(definition)) addDefinition(definition);
    });
  }

  let signature = selected.map((definition) => definition.id).sort().join("|");
  if (signature === options.previousSignature) {
    const swapIndex = selected.findIndex((definition) => counts.get(definition.id) > 1);
    const replacement = weightedPick(
      definitions.filter((definition) => !selected.includes(definition) && canAdd(definition)),
      options.rng,
    );
    if (swapIndex >= 0 && replacement) {
      counts.set(selected[swapIndex].id, counts.get(selected[swapIndex].id) - 1);
      selected[swapIndex] = replacement;
      counts.set(replacement.id, (counts.get(replacement.id) || 0) + 1);
      signature = selected.map((definition) => definition.id).sort().join("|");
    }
  }

  return shuffleWithRng(selected, options.rng);

  function addDefinition(definition) {
    selected.push(definition);
    counts.set(definition.id, (counts.get(definition.id) || 0) + 1);
  }

  function canAdd(definition) {
    const maxPerRound = Math.min(
      definition.maxPerRound || options.maxDuplicatePerType,
      options.maxDuplicatePerType,
    );
    return (counts.get(definition.id) || 0) < maxPerRound;
  }
}

function createLayout(definitions, rng, bounds) {
  const sorted = [...definitions].sort((a, b) => getPlacementRadius(b) - getPlacementRadius(a));
  const grid = createGrid(definitions.length, bounds, rng);
  const placed = [];
  const minGapMultiplier = 0.82;

  sorted.forEach((definition, index) => {
    const placementRadius = getPlacementRadius(definition);
    const colorVariant = pickColorVariant(definition, rng);
    let chosen = null;
    let gapMultiplier = minGapMultiplier;

    for (let attempt = 0; attempt < 90 && !chosen; attempt += 1) {
      if (attempt > 52) gapMultiplier = 0.72;
      const base = grid[(index + attempt) % grid.length];
      const jitter = Math.max(0.04, 0.18 - attempt * 0.0015);
      const x = clamp(base.x + randomRange(rng, -jitter, jitter), bounds.minX + placementRadius, bounds.maxX - placementRadius);
      const z = clamp(base.z + randomRange(rng, -jitter, jitter), bounds.minZ + placementRadius, bounds.maxZ - placementRadius);
      if (isExcluded(x, z, bounds)) continue;
      const overlaps = placed.some((item) => (
        Math.hypot(item.transform.position.x - x, item.transform.position.z - z)
          < (item.placementRadius + placementRadius) * gapMultiplier
      ));
      if (!overlaps) chosen = { x, y: base.y ?? bounds.baseY, z };
    }

    if (!chosen) {
      for (const fallback of grid) {
        const x = clamp(fallback.x + randomRange(rng, -0.06, 0.06), bounds.minX + placementRadius, bounds.maxX - placementRadius);
        const z = clamp(fallback.z + randomRange(rng, -0.06, 0.06), bounds.minZ + placementRadius, bounds.maxZ - placementRadius);
        if (isExcluded(x, z, bounds)) continue;
        const duplicate = placed.some((item) => (
          Math.hypot(item.transform.position.x - x, item.transform.position.z - z) < 0.02
        ));
        if (!duplicate) {
          chosen = { x, y: fallback.y ?? bounds.baseY, z };
          break;
        }
      }
      chosen ||= {
        x: randomRange(rng, bounds.minX + placementRadius, bounds.maxX - placementRadius),
        y: bounds.baseY,
        z: randomRange(rng, bounds.minZ + placementRadius, bounds.maxZ - placementRadius),
      };
    }

    const scale = randomRange(rng, definition.scaleRange[0], definition.scaleRange[1]) * PRIZE_SCALE_BOOST;
    placed.push({
      definition,
      colorVariant,
      placementRadius,
      transform: {
        position: { x: chosen.x, y: chosen.y ?? bounds.baseY, z: chosen.z },
        rotation: {
          x: randomRange(rng, definition.rotationRange.x[0], definition.rotationRange.x[1]),
          y: randomRange(rng, -0.55, 0.55),
          z: randomRange(rng, definition.rotationRange.z[0], definition.rotationRange.z[1]),
        },
        scale,
      },
    });
  });

  return shuffleWithRng(placed, rng);
}

function weightedPick(definitions, rng) {
  if (!definitions.length) return null;
  const total = definitions.reduce((sum, definition) => sum + Math.max(0, definition.selectionWeight || 1), 0);
  if (total <= 0) return definitions[0];
  let cursor = rng() * total;
  for (const definition of definitions) {
    cursor -= Math.max(0, definition.selectionWeight || 1);
    if (cursor <= 0) return definition;
  }
  return definitions.at(-1);
}

function createGrid(count, bounds, rng) {
  const columns = Math.max(5, Math.ceil(count / 2.4));
  const points = [];
  const layers = [
    { z: -1.05, y: 0.18, inset: 0.18 },
    { z: -0.23, y: 0.07, inset: 0 },
    { z: 0.78, y: 0, inset: 0.1 },
  ];

  layers.forEach((layer, row) => {
    const minX = bounds.minX + layer.inset;
    const maxX = bounds.maxX - layer.inset;
    const stepX = (maxX - minX) / Math.max(1, columns - 1);
    for (let column = 0; column < columns; column += 1) {
      const stagger = row % 2 ? stepX * 0.5 : 0;
      points.push({
        x: clamp(minX + stepX * column + stagger, minX, maxX),
        y: layer.y,
        z: layer.z + randomRange(rng, -0.1, 0.1),
      });
    }
  });
  return shuffleWithRng(points, rng);
}

function getPlacementRadius(definition) {
  return Math.max(definition.grabRadius, Math.max(...definition.collider.size) * 0.5) * PRIZE_SCALE_BOOST;
}

function pickColorVariant(definition, rng) {
  if (!definition.colorVariants?.length) return null;
  return definition.colorVariants[Math.floor(rng() * definition.colorVariants.length)] || null;
}

function isExcluded(x, z, bounds) {
  return bounds.excludedZones.some((zone) => (
    x >= zone.minX && x <= zone.maxX && z >= zone.minZ && z <= zone.maxZ
  ));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
