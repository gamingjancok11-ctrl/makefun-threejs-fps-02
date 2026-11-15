// Every sound is synthesized in WebAudio: noise bursts for gunfire and
// explosions, short tones for hits, beeps and round stingers. No audio files,
// so the game still loads with no network request. The context starts on the
// player's first click, as browsers require.
export function createSound() {
  return { ctx: null, master: null };
}

export function ensureSound(sound) {
  if (!sound.ctx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    sound.ctx = new AudioContextClass();
    sound.master = sound.ctx.createGain();
    sound.master.gain.value = 0.45;
    sound.master.connect(sound.ctx.destination);
  }
  if (sound.ctx.state === 'suspended') void sound.ctx.resume();
}

function tone(sound, { freq, freqEnd, dur, type = 'sine', gain = 0.2, at = 0 }) {
  if (!sound.ctx) return;
  const t0 = sound.ctx.currentTime + at;
  const osc = sound.ctx.createOscillator();
  const amp = sound.ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
  amp.gain.setValueAtTime(gain, t0);
  amp.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(amp);
  amp.connect(sound.master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise(sound, { dur, filterFreq = 1000, gain = 0.3, at = 0, type = 'lowpass' }) {
  if (!sound.ctx) return;
  const t0 = sound.ctx.currentTime + at;
  const length = Math.max(1, Math.floor(sound.ctx.sampleRate * dur));
  const buffer = sound.ctx.createBuffer(1, length, sound.ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  const source = sound.ctx.createBufferSource();
  source.buffer = buffer;
  const filter = sound.ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = filterFreq;
  const amp = sound.ctx.createGain();
  amp.gain.setValueAtTime(gain, t0);
  amp.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  source.connect(filter);
  filter.connect(amp);
  amp.connect(sound.master);
  source.start(t0);
}

const SHOT_PROFILE = {
  pistol: { dur: 0.1, filter: 1400, gain: 0.32, thump: 140 },
  smg: { dur: 0.08, filter: 1600, gain: 0.26, thump: 160 },
  rifle: { dur: 0.12, filter: 1100, gain: 0.34, thump: 120 },
  sniper: { dur: 0.25, filter: 700, gain: 0.5, thump: 80 },
};

export function playShot(sound, weaponId, distance = 0) {
  const profile = SHOT_PROFILE[weaponId] ?? SHOT_PROFILE.rifle;
  const volume = 1 / (1 + distance * 0.06);
  noise(sound, { dur: profile.dur, filterFreq: profile.filter, gain: profile.gain * volume });
  tone(sound, { freq: profile.thump, freqEnd: 50, dur: 0.1, type: 'sine', gain: 0.25 * volume });
}

export function playReload(sound) {
  tone(sound, { freq: 1200, dur: 0.04, type: 'square', gain: 0.08 });
  tone(sound, { freq: 900, dur: 0.04, type: 'square', gain: 0.08, at: 0.35 });
}

export function playHit(sound, head) {
  tone(sound, { freq: head ? 2600 : 1900, dur: 0.05, type: 'sine', gain: 0.18 });
}

export function playKill(sound) {
  tone(sound, { freq: 880, dur: 0.07, type: 'sine', gain: 0.16 });
  tone(sound, { freq: 1320, dur: 0.09, type: 'sine', gain: 0.16, at: 0.07 });
}

export function playDry(sound) {
  tone(sound, { freq: 2000, dur: 0.03, type: 'square', gain: 0.07 });
}

export function playExplosion(sound, distance = 0) {
  const volume = 1 / (1 + distance * 0.03);
  noise(sound, { dur: 0.9, filterFreq: 320, gain: 0.7 * volume });
  tone(sound, { freq: 65, freqEnd: 28, dur: 0.7, type: 'sine', gain: 0.5 * volume });
}

export function playBeep(sound) {
  tone(sound, { freq: 880, dur: 0.06, type: 'square', gain: 0.1 });
}

export function playPlant(sound) {
  tone(sound, { freq: 660, dur: 0.09, type: 'square', gain: 0.12 });
  tone(sound, { freq: 880, dur: 0.09, type: 'square', gain: 0.12, at: 0.12 });
  tone(sound, { freq: 1100, dur: 0.14, type: 'square', gain: 0.12, at: 0.24 });
}

export function playDefuse(sound) {
  tone(sound, { freq: 1100, dur: 0.09, type: 'square', gain: 0.12 });
  tone(sound, { freq: 880, dur: 0.09, type: 'square', gain: 0.12, at: 0.12 });
  tone(sound, { freq: 660, dur: 0.14, type: 'square', gain: 0.12, at: 0.24 });
}

export function playRoundEnd(sound, won) {
  if (won) {
    tone(sound, { freq: 523, dur: 0.12, type: 'sine', gain: 0.16 });
    tone(sound, { freq: 659, dur: 0.12, type: 'sine', gain: 0.16, at: 0.12 });
    tone(sound, { freq: 784, dur: 0.2, type: 'sine', gain: 0.16, at: 0.24 });
  } else {
    tone(sound, { freq: 392, dur: 0.12, type: 'sine', gain: 0.16 });
    tone(sound, { freq: 330, dur: 0.12, type: 'sine', gain: 0.16, at: 0.12 });
    tone(sound, { freq: 262, dur: 0.22, type: 'sine', gain: 0.16, at: 0.24 });
  }
}

export function playBuy(sound) {
  tone(sound, { freq: 1500, dur: 0.05, type: 'sine', gain: 0.12 });
  tone(sound, { freq: 2000, dur: 0.07, type: 'sine', gain: 0.12, at: 0.06 });
}

export function playClick(sound) {
  tone(sound, { freq: 1000, dur: 0.03, type: 'sine', gain: 0.1 });
}
