import { t } from "./i18n.js";

const PANEL_WINDOW_ID_KEY = "panelWindowId";
const PANEL_BOUNDS_VERSION = 2;
export const DEFAULT_PANEL_BOUNDS = Object.freeze({ width: 480, height: 600 });

export function createPanelController(api, panelPage = "panel.html") {
  let memoryWindowId = null;
  let operationQueue = Promise.resolve();

  function enqueue(operation) {
    const task = operationQueue
      .catch(() => undefined)
      .then(operation);
    operationQueue = task;
    return task;
  }

  function open(autoQuery) {
    return enqueue(() => openOnce(autoQuery));
  }

  async function openOnce(autoQuery) {
    const existing = await getLockedWindow();
    const nonce = autoQuery ? `${Date.now()}-${Math.random().toString(36).slice(2)}` : "";

    if (existing?.id != null) {
      await api.windows.update(existing.id, { focused: true, state: "normal" });
      if (autoQuery) {
        try {
          await api.runtime.sendMessage({ target: "panel", type: "AUTO_QUERY", nonce });
        } catch {
          // The focused panel may still be loading; a later shortcut can retry.
        }
      }
      return existing;
    }

    const bounds = await getCreationBounds();
    const url = new URL(api.runtime.getURL(panelPage));
    if (autoQuery) {
      url.searchParams.set("auto", "1");
      url.searchParams.set("nonce", nonce);
    }

    const created = await api.windows.create({
      url: url.toString(),
      type: "popup",
      focused: true,
      ...bounds
    });
    if (created?.id == null) throw new Error(t("panelOpenFailed"));
    await setWindowLock(created.id);
    if (created.state === "normal") {
      await api.storage.local.set({ panelBounds: versionPanelBounds(created) });
    }
    return created;
  }

  function register(candidateWindowId) {
    return enqueue(() => registerOnce(candidateWindowId));
  }

  async function registerOnce(candidateWindowId) {
    if (!Number.isInteger(candidateWindowId)) return { accepted: false };

    const existing = await getLockedWindow();
    if (existing?.id != null) {
      if (existing.id !== candidateWindowId) {
        try { await api.windows.remove(candidateWindowId); } catch { /* Already closed. */ }
      }
      return { accepted: existing.id === candidateWindowId, windowId: existing.id };
    }

    let candidate;
    try {
      candidate = await api.windows.get(candidateWindowId);
    } catch {
      return { accepted: false };
    }
    if (candidate?.type !== "popup") return { accepted: false };

    await setWindowLock(candidateWindowId);
    return { accepted: true, windowId: candidateWindowId };
  }

  function release(windowId) {
    return enqueue(async () => {
      const lockedId = await getStoredWindowId();
      if (lockedId === windowId) await clearWindowLock();
    });
  }

  async function rememberBounds(window) {
    if (window?.id == null || window.state !== "normal") return;
    const lockedId = await getStoredWindowId();
    if (lockedId !== window.id) return;
    await api.storage.local.set({ panelBounds: versionPanelBounds(window) });
  }

  async function getLockedWindow() {
    const lockedId = await getStoredWindowId();
    if (!Number.isInteger(lockedId)) return null;

    try {
      const window = await api.windows.get(lockedId);
      if (window?.type === "popup") return window;
    } catch {
      // Stale locks are cleared below.
    }

    await clearWindowLock();
    return null;
  }

  async function getCreationBounds() {
    const stored = await api.storage.local.get("panelBounds");
    if (hasStoredBounds(stored.panelBounds)) {
      return sanitizePanelBounds(stored.panelBounds);
    }

    try {
      return centerPanelBounds(await api.windows.getLastFocused());
    } catch {
      return sanitizePanelBounds(null);
    }
  }

  async function getStoredWindowId() {
    if (Number.isInteger(memoryWindowId)) return memoryWindowId;
    const stored = await api.storage.session.get(PANEL_WINDOW_ID_KEY);
    const storedId = stored[PANEL_WINDOW_ID_KEY];
    memoryWindowId = Number.isInteger(storedId) ? storedId : null;
    return memoryWindowId;
  }

  async function setWindowLock(windowId) {
    memoryWindowId = windowId;
    await api.storage.session.set({ [PANEL_WINDOW_ID_KEY]: windowId });
  }

  async function clearWindowLock() {
    memoryWindowId = null;
    await api.storage.session.remove(PANEL_WINDOW_ID_KEY);
  }

  return { open, register, release, rememberBounds };
}

function hasStoredBounds(value) {
  return value?.version === PANEL_BOUNDS_VERSION &&
    Number.isFinite(Number(value.width)) &&
    Number.isFinite(Number(value.height));
}

function versionPanelBounds(value) {
  return { ...sanitizePanelBounds(value), version: PANEL_BOUNDS_VERSION };
}

export function sanitizePanelBounds(value) {
  const bounds = {
    width: clampNumber(value?.width, 260, 3000, DEFAULT_PANEL_BOUNDS.width),
    height: clampNumber(value?.height, 320, 2200, DEFAULT_PANEL_BOUNDS.height)
  };
  if (Number.isFinite(Number(value?.left))) bounds.left = Math.round(Number(value.left));
  if (Number.isFinite(Number(value?.top))) bounds.top = Math.round(Number(value.top));
  return bounds;
}

export function centerPanelBounds(container, preferred = DEFAULT_PANEL_BOUNDS) {
  const bounds = sanitizePanelBounds(preferred);
  const values = [container?.left, container?.top, container?.width, container?.height].map(Number);
  if (values.every(Number.isFinite)) {
    const [left, top, width, height] = values;
    bounds.left = Math.round(left + (width - bounds.width) / 2);
    bounds.top = Math.round(top + (height - bounds.height) / 2);
  }
  return bounds;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(max, Math.max(min, Math.round(number)))
    : fallback;
}
