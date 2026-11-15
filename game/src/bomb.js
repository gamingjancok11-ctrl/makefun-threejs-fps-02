// The charge: the objective that makes a round more than a deathmatch. It rides
// with a carrier on the attacking team, drops where they fall, plants at a site
// in 3.5 seconds, and burns a 35-second fuse that beeps faster as it runs out.
// A defender who holds E beside it for 7 seconds defuses it. The mesh is a dark
// case with a blinking light; it hides while carried and sits on the ground
// dropped or planted.
import * as THREE from 'three';

export const PLANT_TIME = 3.5;
export const DEFUSE_TIME = 7;
export const FUSE_TIME = 35;

export function createBomb(scene) {
  const group = new THREE.Group();
  const caseMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.2, 0.3),
    new THREE.MeshStandardMaterial({ color: '#22262e', roughness: 0.5, metalness: 0.6 }),
  );
  caseMesh.position.y = 0.1;
  const light = new THREE.Mesh(
    new THREE.SphereGeometry(0.04, 8, 8),
    new THREE.MeshBasicMaterial({ color: '#ff3b30' }),
  );
  light.position.set(0.12, 0.22, 0);
  group.add(caseMesh, light);
  group.visible = false;
  scene.add(group);
  return {
    group,
    light,
    state: 'carried',
    carrier: null,
    site: null,
    position: new THREE.Vector3(),
    fuseEndAt: 0,
    beepAt: 0,
  };
}

export function carryBomb(bomb, fighter) {
  bomb.state = 'carried';
  bomb.carrier = fighter;
  bomb.group.visible = false;
}

export function dropBomb(bomb, position) {
  bomb.state = 'dropped';
  bomb.carrier = null;
  bomb.position.copy(position);
  bomb.position.y = 0;
  bomb.group.position.copy(bomb.position);
  bomb.group.visible = true;
}

export function plantBomb(bomb, site, position, now) {
  bomb.state = 'planted';
  bomb.carrier = null;
  bomb.site = site;
  bomb.position.copy(position);
  bomb.position.y = 0;
  bomb.group.position.copy(bomb.position);
  bomb.group.visible = true;
  bomb.fuseEndAt = now + FUSE_TIME;
  bomb.beepAt = now;
}

export function resetBomb(bomb) {
  bomb.state = 'carried';
  bomb.carrier = null;
  bomb.site = null;
  bomb.group.visible = false;
}

// Returns 'exploded' when the fuse runs out, 'beep' when a fuse beep is due.
export function updateBomb(bomb, now) {
  if (bomb.state !== 'planted') return null;
  const left = bomb.fuseEndAt - now;
  if (left <= 0) {
    bomb.state = 'exploded';
    return 'exploded';
  }
  const interval = left > 20 ? 1 : left > 10 ? 0.5 : 0.25;
  if (now >= bomb.beepAt) {
    bomb.beepAt = now + interval;
    bomb.light.material.color.set('#ff3b30');
    setTimeout(() => bomb.light.material.color.set('#5a1410'), 80);
    return 'beep';
  }
  return null;
}
