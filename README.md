<img width="500" alt="coclip" src="https://github.com/user-attachments/assets/4ad9102b-5057-48d5-8212-4102a2310e6e" />

## 简介

coclip 是一个 Chrome 剪贴板查询扩展。按下 `Alt+X` 后，它会在唯一的独立窗口中读取剪贴板文字或图片，并行调用多个 OpenAI-compatible API，以可折叠 Markdown 卡片展示结果。

每个 API 可以分别设置显示名称、API URL、API Key、Model ID、Prompt 和图片输入支持。设置页支持上下移动卡片；独立窗口会保留已有结果，并自动查询新加入的 API。

扩展只使用剪贴板、内部存储和右键菜单权限，不读取网页内容，也不声明 API 域名访问权限。API 服务需要正确配置 CORS。

添加 ClipboardAction.exe：Ctrl+F1 (snipaste截图并复制) → 监听剪贴板 10 秒 → 有变化则按 Alt+X (coclip查询)

## What coclip does

coclip reads the current clipboard and sends it to every configured API in parallel. Each answer appears as an independent, collapsible card in a single standalone window.

- Query clipboard text or images with `Alt+X`.
- Configure any number of OpenAI-compatible Chat Completions APIs.
- Give every API its own display name, endpoint, key, model, prompt, and image capability.
- Compare streamed answers vertically without switching tabs.
- Add or reorder API cards without clearing existing results.
- Add a new API while the window is open and query it automatically with the current input.
- Cancel an in-progress run and immediately start a new clipboard query.
- Preview input text in a collapsed read-only card and open clipboard images at full size.
- Remember the standalone window size, position, and input-card state.
- Use a monochrome responsive interface with system light and dark themes.

## Markdown and math

Answers are rendered locally with:

- Markdown-it 15.0.0
- @vscode/markdown-it-katex 1.1.2
- KaTeX 0.18.1

Supported math delimiters are `$...$` for inline formulas and `$$...$$` for display formulas. Raw HTML and Markdown images are disabled in API output. Links use Markdown-it protocol validation and open with `noopener` and `noreferrer`.

All renderer code, styles, fonts, and licenses are bundled with the extension. coclip does not load a CDN at runtime.

## Install from source

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select the folder containing `manifest.json`.
6. Add at least one API on the settings page and save.

The first save requests the optional clipboard-read permission if it has not already been granted.

## Configure an API

Each API card contains:

| Field | Purpose |
| --- | --- |
| Display name | Label shown in the standalone window |
| API URL | OpenAI-compatible base URL or full Chat Completions URL |
| API Key | Optional Bearer token stored in extension-local storage |
| Model ID | Model identifier sent in the request body |
| Prompt | Instruction prepended to clipboard content |
| Supports image input | Enables OpenAI-compatible `image_url` message parts |

The default prompt is:

```text
Translate the content to Chinese.
```

If the API URL is `https://example.com/v1`, coclip requests `https://example.com/v1/chat/completions`. A URL already ending in `/chat/completions` is used unchanged.

**CORS:** coclip deliberately declares no API host permissions. The configured server must therefore allow browser cross-origin requests from the extension.

## Controls

- `Alt+X` — query the clipboard in the standalone window while the browser is focused.
- Toolbar icon — configurable as **Query clipboard** or **Open settings**.
- Extension icon context menu — **Open standalone window** or **Query clipboard in standalone window**.
- Top navigation — query again or jump directly to the input or an API card.

Shortcut assignments can be changed at `chrome://extensions/shortcuts` or `edge://extensions/shortcuts`.

## Permissions and privacy

| Permission | Why it is used |
| --- | --- |
| `clipboardRead` | Read clipboard content only when a query is requested |
| `storage` | Save settings, API order, and standalone-window state |
| `contextMenus` | Add the two extension-icon menu actions |

coclip has no `host_permissions`, `optional_host_permissions`, `tabs` permission, or content scripts. It does not inject code into websites.

Requests go directly from the extension to the API endpoints you configure. API keys are stored in `chrome.storage.local`; coclip does not add application-level encryption or send them to a separate coclip service.

## Third-party licenses

Markdown-it, `@vscode/markdown-it-katex`, and KaTeX are distributed under the MIT License. Their license files are included under `vendor/`.
