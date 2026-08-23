import markdownItKatex from "../vendor/markdown-it-katex/index.js";

let markdownRenderer = null;

export function renderMarkdown(container, source) {
  const renderer = getMarkdownRenderer();
  if (!renderer) {
    container.textContent = String(source || "");
    return;
  }
  container.innerHTML = renderer.render(String(source || ""));
}

export function renderMarkdownText(source) {
  const renderer = getMarkdownRenderer();
  const text = String(source || "");
  return renderer ? renderer.render(text) : escapeHtml(text);
}

function getMarkdownRenderer() {
  if (markdownRenderer) return markdownRenderer;
  if (typeof globalThis.markdownit !== "function" || !globalThis.katex?.renderToString) return null;

  const renderer = globalThis.markdownit({
    html: false,
    linkify: true,
    breaks: false,
    typographer: false
  });
  renderer.disable("image");
  renderer.use(markdownItKatex, {
    katex: globalThis.katex,
    throwOnError: false,
    errorColor: "currentColor",
    output: "htmlAndMathml",
    strict: "ignore",
    trust: false,
    maxExpand: 1000,
    maxSize: 50
  });
  secureExternalLinks(renderer);
  markdownRenderer = renderer;
  return renderer;
}

function secureExternalLinks(renderer) {
  const fallback = (tokens, index, options, environment, self) => self.renderToken(tokens, index, options);
  const renderLink = renderer.renderer.rules.link_open || fallback;
  renderer.renderer.rules.link_open = (tokens, index, options, environment, self) => {
    tokens[index].attrSet("target", "_blank");
    tokens[index].attrSet("rel", "noreferrer noopener");
    return renderLink(tokens, index, options, environment, self);
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}
