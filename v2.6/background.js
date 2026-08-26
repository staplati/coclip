import { friendlyError, getSettings } from "./lib/common.js";
import { resolveLanguage, setLanguage, t } from "./lib/i18n.js";
import { createPanelController } from "./lib/panel-controller.js";

const MENU_OPEN_PANEL = "coclip-open-panel";
const MENU_QUERY_CLIPBOARD = "coclip-query-clipboard";
const panelController = createPanelController(chrome);

chrome.action.onClicked.addListener(() => void runConfiguredAction());

chrome.commands.onCommand.addListener((command) => {
  if (command === "query-clipboard") {
    void panelController.open(true);
  }
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === MENU_QUERY_CLIPBOARD) {
    void panelController.open(true);
  } else if (info.menuItemId === MENU_OPEN_PANEL) {
    void panelController.open(false);
  }
});

chrome.runtime.onInstalled.addListener((details) => {
  void refreshBrowserUi();
  if (details.reason === "install") void chrome.runtime.openOptionsPage();
});

chrome.runtime.onStartup.addListener(() => void refreshBrowserUi());

chrome.windows.onRemoved.addListener((windowId) => {
  void panelController.release(windowId);
});

chrome.windows.onBoundsChanged.addListener((window) => {
  void panelController.rememberBounds(window);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== "background") return undefined;

  if (message.type === "PANEL_READY") {
    panelController.register(sender.tab?.windowId)
      .then(sendResponse)
      .catch((error) => sendResponse({ accepted: false, error: friendlyError(error) }));
    return true;
  }

  if (message.type === "SETTINGS_UPDATED") {
    refreshBrowserUi()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: friendlyError(error) }));
    return true;
  }

  return undefined;
});

async function runConfiguredAction() {
  const settings = await loadLocalizedSettings();
  if (settings.actionClick === "query-clipboard") {
    await panelController.open(true);
  } else {
    await chrome.runtime.openOptionsPage();
  }
}

async function refreshBrowserUi() {
  const settings = await loadLocalizedSettings();
  await new Promise((resolve) => chrome.contextMenus.removeAll(resolve));
  chrome.contextMenus.create({
    id: MENU_OPEN_PANEL,
    title: t("contextOpenPanel"),
    contexts: ["action"]
  });
  chrome.contextMenus.create({
    id: MENU_QUERY_CLIPBOARD,
    title: t("contextQueryClipboard"),
    contexts: ["action"]
  });

  const titleKey = settings.actionClick === "query-clipboard"
    ? "actionTitleQuery"
    : "actionTitleOptions";
  await chrome.action.setTitle({ title: t(titleKey) });
}

async function loadLocalizedSettings() {
  const settings = await getSettings();
  setLanguage(resolveLanguage(settings.language));
  return settings;
}
