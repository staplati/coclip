import {
  buildHeaders,
  errorFromResponse,
  extractDeltaText,
  extractResponseText,
  friendlyError,
  getChatCompletionsUrl,
  getSettings,
  validateSettings
} from "./lib/common.js";
import { readClipboardContent } from "./lib/clipboard.js";
import { applyTranslations, resolveLanguage, setLanguage, t } from "./lib/i18n.js";
import { renderMarkdown } from "./lib/markdown.js";

const INPUT_OPEN_STATE_KEY = "clipquery.inputOpen";
const elements = {};
let settings;
let clipboard = { text: "", images: [], warnings: [] };
let responseEntries = [];
const controllers = new Map();
let lastAutoQueryNonce = null;
let activeQueryRun = null;
let queryRequestSerial = 0;
let panelReady = false;
let pendingAutoQuery = false;

const panelRegistration = chrome.runtime.sendMessage({
  target: "background",
  type: "PANEL_READY"
}).catch(() => ({ accepted: false }));

document.addEventListener("DOMContentLoaded", () => void initialize());

chrome.runtime.onMessage.addListener((message) => {
  if (message?.target !== "panel" || message.type !== "AUTO_QUERY") return;
  if (message.nonce && message.nonce === lastAutoQueryNonce) return;
  lastAutoQueryNonce = message.nonce || String(Date.now());
  if (!panelReady) {
    pendingAutoQuery = true;
    return;
  }
  void queryClipboard();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.settings) return;
  void refreshSettings({ resetResponses: false, queryAddedApis: true });
});

async function initialize() {
  const registration = await panelRegistration;
  if (registration?.accepted !== true) return;

  cacheElements();
  restoreInputCardState();
  bindEvents();
  await refreshSettings({ resetResponses: true });
  panelReady = true;

  const params = new URLSearchParams(location.search);
  if (params.get("auto") === "1") {
    lastAutoQueryNonce = params.get("nonce") || String(Date.now());
    history.replaceState(null, "", location.pathname);
    setTimeout(() => void queryClipboard(), 120);
  } else if (pendingAutoQuery) {
    pendingAutoQuery = false;
    setTimeout(() => void queryClipboard(), 0);
  }
}

function cacheElements() {
  for (const id of [
    "notice", "navList", "clipboardCard", "clipboardTextView",
    "imageGrid", "emptyState", "responseList", "imageDialog", "closeImageButton",
    "fullImage", "responseTemplate"
  ]) {
    elements[id] = document.getElementById(id);
  }
}

function bindEvents() {
  elements.clipboardCard.addEventListener("toggle", rememberInputCardState);
  elements.closeImageButton.addEventListener("click", () => elements.imageDialog.close());
  elements.imageDialog.addEventListener("click", (event) => {
    if (event.target === elements.imageDialog) elements.imageDialog.close();
  });
  elements.imageDialog.addEventListener("close", () => {
    elements.fullImage.removeAttribute("src");
  });
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      void queryClipboard();
    }
  });
  window.addEventListener("beforeunload", () => disposeClipboardImages(clipboard));
}

async function refreshSettings({ resetResponses, queryAddedApis = false }) {
  settings = await getSettings();
  setLanguage(resolveLanguage(settings.language));
  applyTranslations(document);
  renderClipboardPreview();
  if (resetResponses) {
    renderResponseCards();
    return;
  }

  const createdEntries = reconcileResponseCards();
  if (queryAddedApis) await queryNewResponseEntries(createdEntries);
}

function renderResponseCards() {
  for (const entry of responseEntries) disposeResponseEntry(entry);
  commitResponseEntries(visibleApiRecords().map(({ api, index }) => createResponseEntry(api, index)));
}

function reconcileResponseCards() {
  const available = new Map();
  const createdEntries = [];
  for (const entry of responseEntries) {
    const key = apiConfigKey(entry.api);
    if (!available.has(key)) available.set(key, []);
    available.get(key).push(entry);
  }

  const nextEntries = visibleApiRecords().map(({ api, index }) => {
    const matches = available.get(apiConfigKey(api));
    let entry = matches?.shift();
    if (!entry) {
      entry = createResponseEntry(api, index);
      createdEntries.push(entry);
    }
    entry.api = api;
    entry.settingsIndex = index;
    entry.card.querySelector(".response-model").textContent = responseLabel(api, index);
    return entry;
  });

  const retained = new Set(nextEntries);
  for (const entry of responseEntries) {
    if (!retained.has(entry)) disposeResponseEntry(entry);
  }

  commitResponseEntries(nextEntries);
  return createdEntries;
}

function commitResponseEntries(entries) {
  responseEntries = entries;
  elements.responseList.replaceChildren(...entries.map((entry) => entry.card));
  updateResponseEmptyState();
  renderSectionNav();
}

async function queryNewResponseEntries(entries) {
  if (!entries.length || (!clipboard.text && !clipboard.images.length)) return;
  await Promise.allSettled(entries.map((entry) => queryApi(entry, clipboard)));
}

function createResponseEntry(api, index) {
  const card = elements.responseTemplate.content.firstElementChild.cloneNode(true);
  card.querySelector(".response-model").textContent = responseLabel(api, index);
  return {
    api,
    settingsIndex: index,
    card,
    output: card.querySelector(".markdown-output"),
    text: "",
    renderFrame: null
  };
}

function visibleApiRecords() {
  return settings.apis
    .map((api, index) => ({ api, index }))
    .filter(({ api }) => api.showCard);
}

function disposeResponseEntry(entry) {
  controllers.get(entry)?.abort();
  if (entry.renderFrame != null) cancelAnimationFrame(entry.renderFrame);
}

function apiConfigKey(api) {
  return JSON.stringify([
    api.displayName,
    api.apiUrl,
    api.apiKey,
    api.modelId,
    api.prompt,
    Boolean(api.supportsImages)
  ]);
}

function responseLabel(api, index) {
  return api.displayName || api.modelId || t("apiFallback", { number: index + 1 });
}

function updateResponseEmptyState() {
  elements.emptyState.hidden = responseEntries.length > 0;

  if (!settings.apis.length) {
    elements.emptyState.querySelector("h2").textContent = t("noApis");
    elements.emptyState.querySelector("p").textContent = t("addApiFirst");
  } else if (!responseEntries.length) {
    elements.emptyState.querySelector("h2").textContent = t("noVisibleApis");
    elements.emptyState.querySelector("p").textContent = t("showApiFirst");
  }
}

function renderSectionNav() {
  elements.navList.replaceChildren();
  elements.navList.hidden = !settings.showTopNavigation;
  if (elements.navList.hidden) return;

  const refreshButton = createNavButton("↻");
  refreshButton.classList.add("refresh-button");
  refreshButton.title = t("refreshClipboard");
  refreshButton.setAttribute("aria-label", t("refreshClipboard"));
  refreshButton.addEventListener("click", () => void queryClipboard());
  elements.navList.append(refreshButton);

  if (settings.showInputCard) {
    const inputButton = createNavButton(t("input"));
    inputButton.disabled = elements.clipboardCard.hidden;
    inputButton.addEventListener("click", () => scrollToCard(elements.clipboardCard));
    elements.navList.append(inputButton);
  }

  responseEntries.forEach((entry) => {
    const button = createNavButton(responseLabel(entry.api, entry.settingsIndex));
    button.dataset.apiIndex = String(entry.settingsIndex);
    button.addEventListener("click", () => scrollToCard(entry.card));
    elements.navList.append(button);
  });
}

function createNavButton(label) {
  const button = document.createElement("button");
  button.className = "nav-button";
  button.type = "button";
  button.title = label;
  button.textContent = label;
  return button;
}

function scrollToCard(card) {
  if (!card || card.hidden) return;
  card.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function queryClipboard() {
  const requestSerial = ++queryRequestSerial;
  abortActiveQueries();

  const previousRun = activeQueryRun;
  if (previousRun) await previousRun.catch(() => undefined);
  if (requestSerial !== queryRequestSerial) return;

  const run = runQuery(requestSerial);
  activeQueryRun = run;
  try {
    await run;
  } finally {
    if (activeQueryRun === run) activeQueryRun = null;
  }
}

function abortActiveQueries() {
  for (const controller of controllers.values()) controller.abort();
}

async function runQuery(requestSerial) {
  hideNotice();

  try {
    settings = validateSettings(await getSettings());
  } catch (error) {
    showNotice(friendlyError(error));
    return;
  }
  if (requestSerial !== queryRequestSerial) return;

  try {
    const clipboardPermission = await chrome.permissions.contains({ permissions: ["clipboardRead"] });
    if (!clipboardPermission) {
      throw new Error(t("clipboardPermissionMissing"));
    }
    const nextClipboard = await readClipboardContent();
    if (requestSerial !== queryRequestSerial) {
      disposeClipboardImages(nextClipboard);
      return;
    }
    if (!nextClipboard.text && !nextClipboard.images?.length) {
      disposeClipboardImages(nextClipboard);
      throw new Error(t("clipboardEmpty"));
    }
    if (elements.imageDialog.open) elements.imageDialog.close();
    disposeClipboardImages(clipboard);
    clipboard = nextClipboard;

    if (clipboard.warnings?.length) showNotice(clipboard.warnings.join(" "), "info");

    renderClipboardPreview();
    renderResponseCards();
    await Promise.allSettled(responseEntries.map((entry) => queryApi(entry, clipboard)));
  } catch (error) {
    showNotice(friendlyError(error));
  }
}

async function queryApi(entry, queryInput) {
  const { api } = entry;
  const controller = new AbortController();
  controllers.set(entry, controller);
  entry.output.replaceChildren(createLoadingIndicator());
  entry.card.open = true;

  try {
    const images = queryInput.images;
    if (images.length && !api.supportsImages && !queryInput.text) {
      throw new Error(t("imageOnlyUnsupported"));
    }

    const response = await fetch(getChatCompletionsUrl(api.apiUrl), {
      method: "POST",
      headers: buildHeaders(api),
      signal: controller.signal,
      body: JSON.stringify({
        model: api.modelId,
        messages: [buildUserMessage(api, queryInput)],
        stream: true
      })
    });
    if (!response.ok) throw await errorFromResponse(response);

    if (response.headers.get("content-type")?.includes("text/event-stream")) {
      await consumeEventStream(response, entry);
    } else {
      const data = await response.json();
      appendResponse(entry, extractResponseText(data));
    }

    flushMarkdown(entry);
    if (!entry.text) throw new Error(t("emptyApiResponse"));
  } catch (error) {
    flushMarkdown(entry);
    if (error?.name === "AbortError") {
      if (!entry.text) showEntryError(entry, t("generationStopped"));
    } else {
      showEntryError(entry, friendlyError(error));
    }
  } finally {
    if (controllers.get(entry) === controller) controllers.delete(entry);
  }
}

function buildUserMessage(api, currentClipboard) {
  const text = currentClipboard.text
    ? `${api.prompt}\n\n${t("clipboardTextLabel")}\n${currentClipboard.text}`
    : api.prompt;
  if (!api.supportsImages || !currentClipboard.images.length) {
    return { role: "user", content: text };
  }
  return {
    role: "user",
    content: [
      { type: "text", text },
      ...currentClipboard.images.map((image) => ({
        type: "image_url",
        image_url: { url: image.dataUrl, detail: "auto" }
      }))
    ]
  };
}

async function consumeEventStream(response, entry) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      processEventLine(line, entry);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) processEventLine(buffer.trim(), entry);
}

function processEventLine(line, entry) {
  if (!line.startsWith("data:")) return;
  const payload = line.slice(5).trim();
  if (!payload || payload === "[DONE]") return;
  let data;
  try { data = JSON.parse(payload); } catch { return; }
  if (data?.error) throw new Error(data.error.message || t("streamError"));
  appendResponse(entry, extractDeltaText(data));
}

function appendResponse(entry, chunk) {
  if (!chunk) return;
  entry.text += chunk;
  if (entry.renderFrame == null) {
    entry.renderFrame = requestAnimationFrame(() => {
      entry.renderFrame = null;
      renderMarkdown(entry.output, entry.text);
    });
  }
}

function flushMarkdown(entry) {
  if (entry.renderFrame != null) cancelAnimationFrame(entry.renderFrame);
  entry.renderFrame = null;
  renderMarkdown(entry.output, entry.text);
}

function showEntryError(entry, message) {
  if (!entry.text) entry.output.replaceChildren();
  const error = document.createElement("p");
  error.className = "response-error";
  error.textContent = t("errorPrefix", { message });
  entry.output.append(error);
}

function renderClipboardPreview() {
  const hasContent = Boolean(clipboard.text || clipboard.images.length);
  const visible = settings.showInputCard && hasContent;
  elements.clipboardCard.hidden = !visible;
  if (!visible) {
    renderSectionNav();
    return;
  }

  const images = clipboard.images;

  elements.clipboardTextView.textContent = clipboard.text || "";
  elements.clipboardTextView.hidden = !clipboard.text;
  elements.imageGrid.hidden = images.length === 0;
  elements.imageGrid.replaceChildren();
  images.forEach((image, index) => {
    const button = document.createElement("button");
    button.className = "image-thumb";
    button.type = "button";
    const img = document.createElement("img");
    img.src = image.dataUrl;
    img.alt = t("inputImage", { number: index + 1 });
    button.append(img);
    button.addEventListener("click", () => showFullImage(image, index));
    elements.imageGrid.append(button);
  });
  renderSectionNav();
}

function showFullImage(image, index) {
  elements.fullImage.src = image.originalUrl || image.dataUrl;
  elements.fullImage.alt = t("originalImage", { number: index + 1 });
  elements.imageDialog.showModal();
}

function restoreInputCardState() {
  try {
    elements.clipboardCard.open = localStorage.getItem(INPUT_OPEN_STATE_KEY) === "true";
  } catch {
    elements.clipboardCard.open = false;
  }
}

function rememberInputCardState() {
  try {
    localStorage.setItem(INPUT_OPEN_STATE_KEY, String(elements.clipboardCard.open));
  } catch {
    // The default collapsed state still works if local storage is unavailable.
  }
}

function disposeClipboardImages(value) {
  for (const image of value?.images || []) {
    if (typeof image.originalUrl === "string" && image.originalUrl.startsWith("blob:")) {
      URL.revokeObjectURL(image.originalUrl);
    }
  }
}

function createLoadingIndicator() {
  const indicator = document.createElement("span");
  indicator.className = "loading-dots";
  indicator.setAttribute("aria-label", t("waitingApi"));
  for (let index = 0; index < 3; index += 1) {
    const dot = document.createElement("span");
    dot.textContent = ".";
    dot.setAttribute("aria-hidden", "true");
    indicator.append(dot);
  }
  return indicator;
}

function showNotice(message, type = "error") {
  elements.notice.textContent = message;
  elements.notice.className = `notice ${type}`;
  elements.notice.hidden = false;
}

function hideNotice() {
  elements.notice.hidden = true;
  elements.notice.textContent = "";
}
