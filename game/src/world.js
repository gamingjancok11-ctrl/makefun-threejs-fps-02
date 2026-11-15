// DEPOT 7 — the map. A 64 by 48 metre freight yard, three lanes from the south
// (Vanguard) spawn to the north (Ember) spawn: A-long down the west side, B-long
// down the east, and mid through a doorway and around a silo. Site A is a warehouse
// yard in the north-west, site B a container yard in the north-east.
//
// Every solid is an axis-aligned box with a matching collider, so the physics
// (physics.js) and the bot vision agree with what the eye sees. The waypoint graph
// is the bots' road map: hand-placed nodes on clear ground, hand-listed edges, BFS
// between them. Paths were checked against the solids: no edge crosses a box.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const WALL_H = 5;

// [x, z, width, depth, height, material] — axis-aligned solids.
const SOLIDS = [
  // Perimeter walls.
  [0, -23.5, 64, 1, WALL_H, 'wall'],
  [0, 23.5, 64, 1, WALL_H, 'wall'],
  [-31.5, 0, 1, 48, WALL_H, 'wall'],
  [31.5, 0, 1, 48, WALL_H, 'wall'],
  // Mid building: two blocks with a 3 m doorway at x -1.5..1.5.
  [-5.75, 5, 8.5, 6, 3.5, 'wall'],
  [5.75, 5, 8.5, 6, 3.5, 'wall'],
  // Mid silo, splitting the north half of mid into two paths.
  [0, -2, 6, 6, 4, 'silo'],
  // Mid low wall: crouch cover on the north side of the silo.
  [0, -10.5, 4, 1, 1.2, 'wall'],
  // Mid crates.
  [-9, -4, 1.2, 1.2, 1.2, 'crate'],
  [9, -4, 1.2, 1.2, 1.2, 'crate'],
  // A-long corner wall and crates.
  [-28.5, 3, 1, 6, 2.6, 'wall'],
  [-26, 8, 1.2, 1.2, 1.2, 'crate'],
  [-24, -2, 1.2, 1.2, 1.2, 'crate'],
  // B-long corner wall and crates.
  [28.5, 3, 1, 6, 2.6, 'wall'],
  [26, 8, 1.2, 1.2, 1.2, 'crate'],
  [24, -2, 1.2, 1.2, 1.2, 'crate'],
  // Site A: container, crates.
  [-22, -13.8, 6, 2.4, 2.4, 'containerA'],
  [-18, -16, 1.2, 1.2, 1.2, 'crate'],
  [-26, -19, 1.2, 1.2, 1.2, 'crate'],
  [-16, -13, 1.2, 1.2, 1.2, 'crate'],
  // Site B: container, crates.
  [22, -13.8, 6, 2.4, 2.4, 'containerB'],
  [18, -16, 1.2, 1.2, 1.2, 'crate'],
  [26, -19, 1.2, 1.2, 1.2, 'crate'],
  [16, -13, 1.2, 1.2, 1.2, 'crate'],
  // Pillars.
  [-12, -8, 1, 1, 4, 'pillar'],
  [12, -8, 1, 1, 4, 'pillar'],
  [-12, 14, 1, 1, 4, 'pillar'],
  [12, 14, 1, 1, 4, 'pillar'],
  // Spawn crates.
  [-6, 19, 1.2, 1.2, 1.2, 'crate'],
  [6, 19, 1.2, 1.2, 1.2, 'crate'],
  [-6, -19, 1.2, 1.2, 1.2, 'crate'],
  [6, -19, 1.2, 1.2, 1.2, 'crate'],
  // Light masts.
  [-16, 0, 0.3, 0.3, 6, 'pillar'],
  [16, 0, 0.3, 0.3, 6, 'pillar'],
];

const MATERIALS = {
  wall: new THREE.MeshStandardMaterial({ color: '#2a303c', roughness: 0.95 }),
  silo: new THREE.MeshStandardMaterial({ color: '#39424f', roughness: 0.8, metalness: 0.25 }),
  crate: new THREE.MeshStandardMaterial({ color: '#6b5433', roughness: 0.9 }),
  containerA: new THREE.MeshStandardMaterial({ color: '#2f5d54', roughness: 0.7, metalness: 0.35 }),
  containerB: new THREE.MeshStandardMaterial({ color: '#7a4530', roughness: 0.7, metalness: 0.35 }),
  pillar: new THREE.MeshStandardMaterial({ color: '#39424f', roughness: 0.85 }),
};

// Waypoint graph. Node ids are short names; edges are listed both ways by hand.
export const WAYPOINTS = {
  v0: [0, 20], v1: [-4, 18], v2: [4, 18],
  a1: [-14, 16], a2: [-22, 14], a3: [-26, 6], a4: [-26, -4], a5: [-24, -10],
  b1: [14, 16], b2: [22, 14], b3: [26, 6], b4: [26, -4], b5: [24, -10],
  m1: [0, 12], m2: [0, 6],
  mw: [-6, 0], me: [6, 0], mw2: [-6, -8], me2: [6, -8], m5: [0, -12],
  c1: [-12, 10], c2: [12, 10],
  sA1: [-18, -12], sA2: [-20, -17], sA3: [-26, -17], sA4: [-18, -18],
  sB1: [18, -12], sB2: [20, -17], sB3: [26, -17], sB4: [18, -18],
  e0: [0, -20], e1: [-6, -18], e2: [6, -18],
  hA1: [-16, -10], hA2: [-28, -12], hB1: [16, -10], hB2: [28, -12],
  r1: [-12, -16], r2: [12, -16],
};

const EDGE_LIST = [
  ['v0', 'v1'], ['v0', 'v2'], ['v0', 'm1'],
  ['v1', 'a1'], ['v1', 'm1'], ['v2', 'b1'], ['v2', 'm1'],
  ['a1', 'a2'], ['a1', 'c1'], ['a1', 'm1'],
  ['a2', 'a3'], ['a3', 'a4'], ['a3', 'c1'], ['a4', 'a5'],
  ['a5', 'sA1'], ['a5', 'hA2'],
  ['b1', 'b2'], ['b1', 'c2'], ['b1', 'm1'],
  ['b2', 'b3'], ['b3', 'b4'], ['b3', 'c2'], ['b4', 'b5'],
  ['b5', 'sB1'], ['b5', 'hB2'],
  ['m1', 'm2'], ['m2', 'mw'], ['m2', 'me'],
  ['mw', 'mw2'], ['me', 'me2'],
  ['mw2', 'm5'], ['mw2', 'hA1'], ['mw2', 'r1'],
  ['me2', 'm5'], ['me2', 'hB1'], ['me2', 'r2'],
  ['m5', 'sA1'], ['m5', 'sB1'], ['m5', 'r1'], ['m5', 'r2'],
  ['c1', 'm1'], ['c2', 'm1'],
  ['sA1', 'sA2'], ['sA1', 'sA3'], ['sA1', 'hA1'], ['sA1', 'r1'],
  ['sA2', 'sA3'], ['sA2', 'sA4'], ['sA3', 'sA4'],
  ['sA4', 'r1'], ['sA4', 'e1'],
  ['sB1', 'sB2'], ['sB1', 'sB3'], ['sB1', 'hB1'], ['sB1', 'r2'],
  ['sB2', 'sB3'], ['sB2', 'sB4'], ['sB3', 'sB4'],
  ['sB4', 'r2'], ['sB4', 'e2'],
  ['e0', 'e1'], ['e0', 'e2'], ['e0', 'r1'], ['e0', 'r2'],
  ['e1', 'r1'], ['e2', 'r2'],
  ['hA2', 'sA3'], ['hB2', 'sB3'],
];

export const EDGES = {};
for (const id of Object.keys(WAYPOINTS)) EDGES[id] = [];
for (const [a, b] of EDGE_LIST) {
  EDGES[a].push(b);
  EDGES[b].push(a);
}

export const SITES = {
  A: { zone: { minX: -30, maxX: -14, minZ: -22, maxZ: -10 }, plant: [-23, -17.5], color: PALETTE.vanguard },
  B: { zone: { minX: 14, maxX: 30, minZ: -22, maxZ: -10 }, plant: [23, -17.5], color: PALETTE.ember },
};

// Spawn points follow the ROLE, not the team: attackers always start south and
// defenders north, so the sides can swap at half-time and the map still works.
export const SPAWNS = {
  attack: [[0, 20], [-3, 19], [3, 19], [-1.5, 21]],
  defend: [[0, -20], [-3, -19], [3, -19], [1.5, -21]],
};

// Breadth-first search over the waypoint graph; returns the node ids to walk,
// including the destination, or an empty list when no route exists.
export function findPath(fromId, toId) {
  if (fromId === toId) return [toId];
  const cameFrom = { [fromId]: null };
  const queue = [fromId];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const next of EDGES[current]) {
      if (next in cameFrom) continue;
      cameFrom[next] = current;
      if (next === toId) {
        const path = [next];
        let node = current;
        while (node !== null) {
          path.unshift(node);
          node = cameFrom[node];
        }
        return path.slice(1);
      }
      queue.push(next);
    }
  }
  return [];
}

export function nearestWaypoint(x, z) {
  let best = 'v0';
  let bestD = Infinity;
  for (const [id, [wx, wz]] of Object.entries(WAYPOINTS)) {
    const d = (wx - x) ** 2 + (wz - z) ** 2;
    if (d < bestD) { bestD = d; best = id; }
  }
  return best;
}

function siteDecal(letter, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);
  ctx.strokeStyle = color;
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(128, 128, 108, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = 'bold 150px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, 128, 136);
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(9, 9),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.75, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

export function buildWorld(scene) {
  scene.background = new THREE.Color('#141a24');
  scene.fog = new THREE.Fog('#141a24', 55, 115);

  const colliders = [];
  const solids = [];
  const ground = new THREE.Mesh(
    new THREE.BoxGeometry(64, 0.2, 48),
    new THREE.MeshStandardMaterial({ color: '#232833', roughness: 1 }),
  );
  ground.position.set(0, -0.1, 0);
  ground.receiveShadow = true;
  scene.add(ground);
  colliders.push(new THREE.Box3(new THREE.Vector3(-32, -0.2, -24), new THREE.Vector3(32, 0, 24)));

  const box = new THREE.BoxGeometry(1, 1, 1);
  for (const [x, z, w, d, h, material] of SOLIDS) {
    const mesh = new THREE.Mesh(box, MATERIALS[material]);
    mesh.scale.set(w, h, d);
    mesh.position.set(x, h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    solids.push(mesh);
    colliders.push(new THREE.Box3(
      new THREE.Vector3(x - w / 2, 0, z - d / 2),
      new THREE.Vector3(x + w / 2, h, z + d / 2),
    ));
  }

  // Site markers painted on the ground at the plant spots.
  for (const [letter, site] of Object.entries(SITES)) {
    const decal = siteDecal(letter, site.color);
    decal.position.set(site.plant[0], 0.02, site.plant[1]);
    scene.add(decal);
  }

  // Dusk light: a low warm sun with shadows, a cool sky fill, warm pools at the sites.
  const sun = new THREE.DirectionalLight('#ffd9a0', 2.2);
  sun.position.set(-30, 38, 22);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -40;
  sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40;
  sun.shadow.camera.bottom = -40;
  sun.shadow.camera.far = 120;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight('#8fb4d8', '#1a1d22', 1.0));
  for (const site of Object.values(SITES)) {
    const glow = new THREE.PointLight('#ffb36b', 18, 22, 1.8);
    glow.position.set(site.plant[0], 4.5, site.plant[1]);
    scene.add(glow);
  }

  return { colliders, solids, waypoints: WAYPOINTS, edges: EDGES, sites: SITES, spawns: SPAWNS };
}
