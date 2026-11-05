// Service worker registration + "new version available" banner.
import { h } from './ui.js';

let registration = null;
let bannerShown = false;

function showBanner(worker) {
  if (bannerShown) return;
  bannerShown = true;
  const banner = h('div.update-banner',
    h('p', 'A new version of Table for Two is ready.'),
    h('button', { onclick: () => {
      banner.querySelector('button').textContent = 'Updating…';
      worker.postMessage({ type: 'SKIP_WAITING' });
    } }, 'Update'),
  );
  document.body.append(banner);
}

function watch(reg) {
  if (reg.waiting && navigator.serviceWorker.controller) showBanner(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const w = reg.installing;
    if (!w) return;
    w.addEventListener('statechange', () => {
      if (w.state === 'installed' && navigator.serviceWorker.controller) showBanner(w);
    });
  });
}

export async function registerUpdates() {
  if (!('serviceWorker' in navigator)) return;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
  try {
    registration = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
    watch(registration);
  } catch (e) {
    console.warn('Service worker not registered', e);
  }
  // iOS keeps Home Screen apps alive for a long time: check whenever we come back.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate();
  });
  setInterval(checkForUpdate, 30 * 60 * 1000);
}

// Resolves true when a newer version was found.
export async function checkForUpdate() {
  if (!registration) return false;
  try {
    await registration.update();
  } catch { return false; }
  await new Promise((r) => setTimeout(r, 1500));
  const w = registration.waiting || registration.installing;
  if (w && navigator.serviceWorker.controller) { showBanner(w); return true; }
  return false;
}
