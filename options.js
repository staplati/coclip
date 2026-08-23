import {
  buildHeaders,
  createApiConfig,
  errorFromResponse,
  extractResponseText,
  friendlyError,
  getChatCompletionsUrl,
  getSettings,
  normalizeSettings,
  validateApiConfig,
  validateSettings
} from "./lib/common.js";
import { applyTranslations, resolveLanguage, setLanguage, t } from "./lib/i18n.js";

const elements = {};
let settings;
let statusHideTimer = null;
const API_TEST_MESSAGE = "Reply with OK only.";
const API_FIELDS = {
  displayName: ".display-name",
  apiUrl: ".api-url",
  apiKey: ".api-key",
  modelId: ".model-id",
  prompt: ".api-prompt"
};

document.addEventListener("DOMContentLoaded", () => void initialize());

async function initialize() {
  cacheElements();
  bindEvents();
  settings = await getSettings();
  setLanguage(resolveLanguage(settings.language));
  elements.languageSelect.value = settings.language;
  elements.actionClickSelect.value = settings.actionClick;
  applyTranslations(document);
  if (!settings.apis.length) settings.apis.push(createApiConfig());
  renderApis();
}

function cacheElements() {
  for (const id of [
    "addApiButton",
    "languageSelect",
    "actionClickSelect",
    "apiList",
    "apiTemplate",
    "statusMessage",
    "shortcutButton",
    "saveButton"
  ]) {
    elements[id] = document.getElementById(id);
  }
}

function bindEvents() {
  elements.addApiButton.addEventListener("click", () => {
    syncStateFromDom();
    settings.apis.push(createApiConfig());
    renderApis();
    elements.apiList.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  elements.saveButton.addEventListener("click", () => void saveSettings());
  elements.shortcutButton.addEventListener("click", openShortcutSettings);
  elements.languageSelect.addEventListener("change", updateInterfaceLanguage);
}

function renderApis() {
  elements.apiList.replaceChildren();
  settings.apis.forEach((api, index) => {
    const card = elements.apiTemplate.content.firstElementChild.cloneNode(true);
    applyTranslations(card);
    fillApiCard(card, api, index);
    bindApiCard(card, index);
    elements.apiList.append(card);
  });
}

function fillApiCard(card, api, index) {
  for (const [key, selector] of Object.entries(API_FIELDS)) {
    card.querySelector(selector).value = api[key];
  }
  card.querySelector(".supports-images").checked = api.supportsImages;
  card.querySelector(".move-up").disabled = index === 0;
  card.querySelector(".move-down").disabled = index === settings.apis.length - 1;
  updateCardIdentity(card);
}

function bindApiCard(card, index) {
  card.querySelector(".test-api").addEventListener("click", () => void testApi(index, card));
  card.querySelector(".move-up").addEventListener("click", () => moveApi(index, -1));
  card.querySelector(".move-down").addEventListener("click", () => moveApi(index, 1));
  card.querySelector(".remove-api").addEventListener("click", () => {
    syncStateFromDom();
    settings.apis.splice(index, 1);
    if (!settings.apis.length) settings.apis.push(createApiConfig());
    renderApis();
  });
  card.querySelector(".reveal-key").addEventListener("click", (event) => {
    const input = card.querySelector(".api-key");
    const reveal = input.type === "password";
    input.type = reveal ? "text" : "password";
    event.currentTarget.textContent = t(reveal ? "hide" : "show");
  });
  card.querySelector(".display-name").addEventListener("input", () => updateCardIdentity(card));
  card.querySelector(".model-id").addEventListener("input", () => updateCardIdentity(card));
  card.querySelector(".api-url").addEventListener("input", () => updateCardIdentity(card));
}

function moveApi(index, offset) {
  const targetIndex = index + offset;
  if (targetIndex < 0 || targetIndex >= settings.apis.length) return;
  syncStateFromDom();
  const [api] = settings.apis.splice(index, 1);
  settings.apis.splice(targetIndex, 0, api);
  renderApis();
  const movedCard = elements.apiList.children[targetIndex];
  movedCard?.classList.add("just-moved");
  movedCard?.scrollIntoView({ behavior: "smooth", block: "center" });
  setTimeout(() => movedCard?.classList.remove("just-moved"), 450);
}

function updateCardIdentity(card) {
  const displayName = card.querySelector(".display-name").value.trim();
  const modelId = card.querySelector(".model-id").value.trim();
  const apiUrl = card.querySelector(".api-url").value.trim();
  card.querySelector(".api-title").textContent = displayName || t("unnamed");
  card.querySelector(".api-host").textContent = [modelId, safeHost(apiUrl)].filter(Boolean).join(" · ") || t("notConfigured");
}

function syncStateFromDom() {
  settings = normalizeSettings({
    language: elements.languageSelect.value,
    actionClick: elements.actionClickSelect.value,
    apis: [...elements.apiList.querySelectorAll(".api-card")].map(readApiCard)
  });
}

function readApiCard(card) {
  const api = Object.fromEntries(
    Object.entries(API_FIELDS).map(([key, selector]) => [key, card.querySelector(selector).value])
  );
  api.supportsImages = card.querySelector(".supports-images").checked;
  return api;
}

function updateInterfaceLanguage() {
  syncStateFromDom();
  setLanguage(resolveLanguage(settings.language));
  applyTranslations(document);
  for (const card of elements.apiList.querySelectorAll(".api-card")) {
    updateCardIdentity(card);
    const input = card.querySelector(".api-key");
    card.querySelector(".reveal-key").textContent = t(input.type === "password" ? "show" : "hide");
  }
}

async function testApi(index, card) {
  syncStateFromDom();
  const button = card.querySelector(".test-api");
  button.disabled = true;
  button.textContent = t("testing");
  setApiTestState(card, t("testing"), "", "");

  try {
    const api = validateApiConfig(settings.apis[index], index);
    const response = await fetch(getChatCompletionsUrl(api.apiUrl), {
      method: "POST",
      headers: buildHeaders(api),
      body: JSON.stringify({
        model: api.modelId,
        messages: [{ role: "user", content: API_TEST_MESSAGE }],
        max_tokens: 8,
        stream: false
      })
    });
    if (!response.ok) throw await errorFromResponse(response);
    const data = await response.json();
    const reply = extractResponseText(data).trim();
    setApiTestState(
      card,
      t("available"),
      "success",
      reply ? t("replyPrefix", { reply: reply.slice(0, 120) }) : t("connectionSucceeded")
    );
  } catch (error) {
    setApiTestState(card, t("failed"), "error", friendlyError(error), "error");
  } finally {
    button.disabled = false;
    button.textContent = t("test");
  }
}

function setApiTestState(card, label, stateClass, message) {
  const state = card.querySelector(".api-state");
  const result = card.querySelector(".api-test-message");
  state.textContent = label;
  state.className = `api-state ${stateClass}`;
  state.hidden = false;
  result.textContent = message;
  result.className = `api-test-message ${stateClass}`;
  result.hidden = !message;
}

async function saveSettings() {
  hideStatus();
  syncStateFromDom();
  elements.saveButton.disabled = true;
  elements.saveButton.textContent = t("saving");

  try {
    settings = validateSettings(settings);
    const permission = { permissions: ["clipboardRead"] };
    const granted = await chrome.permissions.contains(permission) || await chrome.permissions.request(permission);
    if (!granted) throw new Error(t("clipboardPermissionRequired"));
    await chrome.storage.local.set({ settings });
    await chrome.runtime.sendMessage({ target: "background", type: "SETTINGS_UPDATED" }).catch(() => undefined);
    showStatus(t("saved"), "success", 1800);
  } catch (error) {
    showStatus(friendlyError(error));
  } finally {
    elements.saveButton.disabled = false;
    elements.saveButton.textContent = t("saveSettings");
  }
}

async function openShortcutSettings() {
  try {
    const scheme = navigator.userAgent.includes("Edg/") ? "edge" : "chrome";
    await chrome.tabs.create({ url: `${scheme}://extensions/shortcuts` });
  } catch {
    showStatus(t("shortcutFallback"));
  }
}

function safeHost(value) {
  try { return new URL(value).host; } catch { return ""; }
}

function showStatus(message, type = "error", autoHideMs = 0) {
  if (statusHideTimer != null) clearTimeout(statusHideTimer);
  statusHideTimer = null;
  elements.statusMessage.textContent = message;
  elements.statusMessage.className = `status-message ${type}`;
  elements.statusMessage.hidden = false;
  if (autoHideMs > 0) {
    statusHideTimer = setTimeout(hideStatus, autoHideMs);
  }
}

function hideStatus() {
  if (statusHideTimer != null) clearTimeout(statusHideTimer);
  statusHideTimer = null;
  elements.statusMessage.hidden = true;
  elements.statusMessage.textContent = "";
}
