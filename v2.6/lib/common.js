import { t } from "./i18n.js";

export const DEFAULT_SETTINGS = Object.freeze({
  language: "en",
  actionClick: "query-clipboard",
  showTopNavigation: true,
  showInputCard: true,
  apis: []
});

const NEW_DEFAULT_PROMPT = "Translate the content to Chinese.";
const LEGACY_DEFAULT_PROMPTS = new Set([
  "解释内容。",
  "Explain the content."
]);

export async function getSettings() {
  const saved = await chrome.storage.local.get("settings");
  return normalizeSettings(saved.settings || DEFAULT_SETTINGS);
}

export function normalizeSettings(value = {}) {
  const rawApis = Array.isArray(value.apis)
    ? value.apis
    : migrateLegacyApi(value);

  return {
    language: normalizeLanguage(value.language),
    actionClick: normalizeActionClick(value.actionClick),
    showTopNavigation: value.showTopNavigation !== false,
    showInputCard: value.showInputCard !== false,
    apis: rawApis.map(normalizeApiConfig)
  };
}

export function normalizeApiConfig(value = {}) {
  return {
    displayName: String(value.displayName ?? value.modelId ?? value.model ?? "").trim(),
    apiUrl: String(value.apiUrl || value.apiBase || "").trim().replace(/\/+$/, ""),
    apiKey: String(value.apiKey || "").trim(),
    modelId: String(value.modelId || value.model || "").trim(),
    prompt: normalizePrompt(value.prompt ?? value.queryPrompt ?? t("defaultPrompt")),
    supportsImages: Boolean(value.supportsImages),
    showCard: value.showCard !== false
  };
}

export function createApiConfig() {
  return {
    displayName: "",
    apiUrl: "",
    apiKey: "",
    modelId: "",
    prompt: t("defaultPrompt"),
    supportsImages: false,
    showCard: true
  };
}

export function validateSettings(value) {
  const settings = normalizeSettings(value);
  if (!settings.apis.length) {
    throw new Error(t("atLeastOneApi"));
  }

  settings.apis.forEach((api, index) => validateApiConfig(api, index));
  return settings;
}

export function validateApiConfig(api, index = 0) {
  const number = index + 1;
  let url;
  try {
    url = new URL(api.apiUrl);
  } catch {
    throw new Error(t("invalidApiUrl", { number }));
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(t("apiProtocol", { number }));
  }
  if (!api.modelId) {
    throw new Error(t("missingModelId", { number }));
  }
  if (!api.displayName) {
    throw new Error(t("missingDisplayName", { number }));
  }
  if (!api.prompt) {
    throw new Error(t("missingPrompt", { number }));
  }
  return api;
}

export function getChatCompletionsUrl(apiUrl) {
  const base = String(apiUrl || "").trim().replace(/\/+$/, "");
  return /\/chat\/completions$/i.test(base)
    ? base
    : `${base}/chat/completions`;
}

export function buildHeaders(api) {
  const headers = { "Content-Type": "application/json" };
  if (api.apiKey) {
    headers.Authorization = `Bearer ${api.apiKey}`;
  }
  return headers;
}

export function extractResponseText(data) {
  const content = contentToText(data?.choices?.[0]?.message?.content);
  if (content) return content;
  const legacyText = data?.choices?.[0]?.text;
  return typeof legacyText === "string" ? legacyText : "";
}

export function extractDeltaText(data) {
  return contentToText(data?.choices?.[0]?.delta?.content);
}

export async function errorFromResponse(response) {
  let detail = "";
  try {
    const body = await response.text();
    try {
      const data = JSON.parse(body);
      detail = data?.error?.message || data?.message || JSON.stringify(data);
    } catch {
      detail = body;
    }
  } catch {
    detail = "";
  }

  const suffix = detail ? `: ${String(detail).slice(0, 500)}` : "";
  return new Error(t("apiRequestFailed", { status: response.status, detail: suffix }));
}

export function friendlyError(error) {
  if (error instanceof Error) return error.message;
  return String(error || t("unknownError"));
}

function normalizeLanguage(value) {
  return value === "zh-CN" ? "zh-CN" : "en";
}

function normalizeActionClick(value) {
  return value === "open-options" ? value : "query-clipboard";
}

function normalizePrompt(value) {
  const prompt = String(value || NEW_DEFAULT_PROMPT).trim();
  return LEGACY_DEFAULT_PROMPTS.has(prompt) ? NEW_DEFAULT_PROMPT : prompt;
}

function contentToText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => typeof part === "string" ? part : part?.text || part?.content || "")
    .join("");
}

function migrateLegacyApi(value) {
  const hasLegacyApi = value.apiBase || value.apiUrl || value.model || value.modelId;
  if (!hasLegacyApi) return [];
  return [{
    displayName: value.displayName || value.modelId || value.model,
    apiUrl: value.apiUrl || value.apiBase,
    apiKey: value.apiKey,
    modelId: value.modelId || value.model,
    prompt: value.prompt || value.queryPrompt || t("defaultPrompt"),
    supportsImages: value.supportsImages,
    showCard: value.showCard
  }];
}
