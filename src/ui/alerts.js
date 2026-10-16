// Gentle signals for the focus timer. Everything here is best effort: a browser that says no
// (no permission, no API, battery saver) just gets a quieter timer, never an error.

let audio = null;

/** Soft two-note chime made with Web Audio (no sound file). */
export function chime() {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    const t0 = audio.currentTime;
    [523.25, 783.99].forEach((freq, i) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = t0 + i * 0.28;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.18, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 1.2);
      osc.connect(gain).connect(audio.destination);
      osc.start(start);
      osc.stop(start + 1.25);
    });
  } catch {
    /* no audio */
  }
}

/** Call from a tap (e.g. "Start focus") so the browser lets the chime play later. */
export function unlockAudio() {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch {
    /* no audio */
  }
}

export function buzz() {
  try {
    navigator.vibrate?.([180, 90, 180]);
  } catch {
    /* no vibration */
  }
}

/** A system notification, through the service worker when there is one (needed on Android). */
export async function notify(title, body) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const options = { body, tag: 'ascend-focus', renotify: true, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' };
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(title, options);
    else new Notification(title, options);
  } catch {
    /* notifications not available */
  }
}

/** True when it's worth asking (supported and not decided yet). */
export const canAskNotify = () => 'Notification' in window && Notification.permission === 'default';

export async function askNotify() {
  try {
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

// ---------- Keep the screen on during focus ----------

let lock = null;
let wantAwake = false;

async function acquire() {
  if (!wantAwake || lock || document.visibilityState !== 'visible') return;
  try {
    lock = await navigator.wakeLock.request('screen');
    lock.addEventListener('release', () => {
      lock = null;
    });
  } catch {
    lock = null;
  }
}

/** The browser drops the lock when the app is hidden; take it again when it comes back. */
document.addEventListener('visibilitychange', acquire);

export const wakeLockSupported = () => 'wakeLock' in navigator;

export function keepAwake(on) {
  wantAwake = Boolean(on) && wakeLockSupported();
  if (wantAwake) acquire();
  else if (lock) {
    lock.release().catch(() => {});
    lock = null;
  }
}
