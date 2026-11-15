// The armoury. Five buys, each one job: the pistol is free and honest, the SMG
// wins close fights, the rifle is the workhorse, the sniper one-shots at range,
// the frag clears a corner. Damage, headshot bonus, fire rate, magazine, spread
// and price are all here, so balance is one table.
//
// Accuracy is the game's thesis: every weapon is a laser when still and aimed,
// and a sprinkler when running or spraying. Spread is a cone angle in radians.
import * as THREE from 'three';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', slot: 'sidearm', price: 0,
    damage: 26, headMult: 3.5, mag: 12, reserve: 48, fireGap: 0.18,
    reloadTime: 1.5, auto: false, spreadStill: 0.004, spreadMove: 0.02,
    spreadAir: 0.05, bloom: 0.006, recoil: 0.012, range: 60,
  },
  smg: {
    id: 'smg', name: 'VK-9 Sting', slot: 'primary', price: 1200,
    damage: 21, headMult: 3, mag: 30, reserve: 120, fireGap: 0.075,
    reloadTime: 2.0, auto: true, spreadStill: 0.006, spreadMove: 0.03,
    spreadAir: 0.06, bloom: 0.004, recoil: 0.008, range: 45,
  },
  rifle: {
    id: 'rifle', name: 'AR-77 Raptor', slot: 'primary', price: 2700,
    damage: 34, headMult: 3, mag: 30, reserve: 90, fireGap: 0.096,
    reloadTime: 2.2, auto: true, spreadStill: 0.002, spreadMove: 0.026,
    spreadAir: 0.055, bloom: 0.0035, recoil: 0.011, range: 80,
  },
  sniper: {
    id: 'sniper', name: 'L-88 Longshot', slot: 'primary', price: 4750,
    damage: 110, headMult: 2, mag: 5, reserve: 20, fireGap: 1.15,
    reloadTime: 3.2, auto: false, spreadStill: 0.0005, spreadMove: 0.05,
    spreadAir: 0.09, bloom: 0.02, recoil: 0.05, range: 120,
  },
};

export const GRENADE = { id: 'grenade', name: 'Frag Grenade', price: 300, max: 2 };
export const ARMOR = { id: 'armor', name: 'Kevlar Vest', price: 650 };

export function createLoadout() {
  return {
    sidearm: 'pistol',
    primary: null,
    current: 'pistol',
    ammo: { pistol: { mag: 12, reserve: 48 } },
    grenades: 0,
    nextShotAt: 0,
    reloading: null,
    reloadEndAt: 0,
    bloom: 0,
    scoped: false,
  };
}

// The spread cone for one shot, in radians. Standing still and crouched is the
// tightest; running, jumping and spraying open it up.
export function currentSpread(def, player, loadout, moving, airborne) {
  let spread = def.spreadStill;
  if (airborne) spread = def.spreadAir;
  else if (moving) spread = def.spreadMove;
  if (player.crouched) spread *= 0.7;
  if (loadout.scoped) spread *= 0.4;
  return Math.min(0.12, spread + loadout.bloom);
}

export function currentWeapon(loadout) {
  return WEAPONS[loadout.current];
}

export function switchTo(loadout, id) {
  if (id === loadout.sidearm || id === loadout.primary) {
    loadout.current = id;
    loadout.reloading = null;
    loadout.scoped = false;
    loadout.bloom = 0;
    return true;
  }
  return false;
}

// The gun in the player's hands: a low-poly build per weapon, a muzzle flash
// that lives for one frame, a kick on every shot and a dip on reload. It hangs
// off the camera, so it never collides with the world.
const GUN_STYLE = {
  pistol: { length: 0.34, body: '#3a4150', accent: '#f0a830', grip: 0.16 },
  smg: { length: 0.5, body: '#2e3b33', accent: '#35c4a8', grip: 0.18 },
  rifle: { length: 0.72, body: '#3a3f4a', accent: '#e06a3a', grip: 0.2 },
  sniper: { length: 0.95, body: '#24303a', accent: '#9aa3ad', grip: 0.22 },
};

export function createViewModel(camera) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: '#3a3f4a', roughness: 0.6, metalness: 0.5 });
  const accentMat = new THREE.MeshStandardMaterial({ color: '#e06a3a', roughness: 0.5, metalness: 0.4 });
  const gripMat = new THREE.MeshStandardMaterial({ color: '#1c2027', roughness: 0.9 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.5), bodyMat);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.3), bodyMat);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.08), accentMat);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.08), gripMat);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.07), gripMat);
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.22, 0.22),
    new THREE.MeshBasicMaterial({ color: '#ffcf6e', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
  );
  const flashLight = new THREE.PointLight('#ffb36b', 0, 6, 2);
  // A small light riding with the camera, so the gun is never pitch black.
  const gunLight = new THREE.PointLight('#fff2dd', 3, 4, 1.5);
  gunLight.position.set(0.1, 0.3, -0.2);
  group.add(body, barrel, sight, grip, mag, flash, flashLight, gunLight);
  group.position.set(0.24, -0.22, -0.45);
  camera.add(group);

  const view = {
    group,
    kick: 0,
    reloadDip: 0,
    flashUntil: 0,
    setWeapon(id) {
      const style = GUN_STYLE[id];
      bodyMat.color.set(style.body);
      accentMat.color.set(style.accent);
      body.scale.z = style.length / 0.5;
      body.position.z = -style.length / 2 + 0.1;
      barrel.position.set(0, 0.01, -style.length - 0.05);
      sight.position.set(0, 0.07, -style.length * 0.4);
      grip.position.set(0, -0.1, 0.05);
      mag.position.set(0, -0.09, -style.length * 0.35);
      flash.position.set(0, 0.01, -style.length - 0.2);
      flashLight.position.set(0, 0, -style.length - 0.2);
    },
    onShot(now) {
      view.kick = 1;
      view.flashUntil = now + 0.05;
      flash.material.opacity = 0.95;
      flash.rotation.z = Math.random() * Math.PI;
      flashLight.intensity = 8;
    },
    update(now, dt, moving) {
      view.kick = Math.max(0, view.kick - dt * 7);
      if (now > view.flashUntil) {
        flash.material.opacity = 0;
        flashLight.intensity = 0;
      }
      const sway = moving ? Math.sin(now * 9) * 0.004 : 0;
      group.position.z = -0.45 + view.kick * 0.09 + view.reloadDip * 0.18;
      group.position.y = -0.22 - view.reloadDip * 0.12 + sway;
      group.rotation.x = view.kick * 0.06 + view.reloadDip * 0.5;
    },
  };
  view.setWeapon('pistol');
  return view;
}
