import { t } from "./i18n.js";
import { friendlyError } from "./common.js";

const MAX_IMAGES = 4;
const MAX_DIMENSION = 2048;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export async function readClipboardContent() {
  if (!navigator.clipboard?.read) {
    throw new Error(t("clipboardUnsupported"));
  }

  let items;
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await waitForDocumentFocus();
    try {
      items = await navigator.clipboard.read();
      break;
    } catch (error) {
      lastError = error;
      if (!isFocusError(error) || attempt === 2) break;
      window.focus();
      await delay(120 * (attempt + 1));
    }
  }

  if (!items) {
    throw new Error(t("clipboardReadFailed", { message: friendlyError(lastError) }));
  }

  const textParts = [];
  const htmlParts = [];
  const images = [];
  const warnings = [];

  for (const item of items) {
    if (item.types.includes("text/plain")) {
      const blob = await item.getType("text/plain");
      const text = await blob.text();
      if (text.trim()) textParts.push(text);
    } else if (item.types.includes("text/html")) {
      const blob = await item.getType("text/html");
      htmlParts.push(await blob.text());
    }

    const imageTypes = item.types.filter((candidate) => candidate.startsWith("image/"));
    const imageType = imageTypes.includes("image/png") ? "image/png" : imageTypes[0];
    if (!imageType) continue;

    if (images.length >= MAX_IMAGES) {
      warnings.push(t("maxImages", { number: MAX_IMAGES }));
      continue;
    }

    try {
      const blob = await item.getType(imageType);
      images.push(await prepareImage(blob));
    } catch (error) {
      warnings.push(t("imageReadFailed", { message: friendlyError(error) }));
    }
  }

  if (!textParts.length && htmlParts.length) {
    const parser = new DOMParser();
    for (const html of htmlParts) {
      const text = parser.parseFromString(html, "text/html").body.textContent || "";
      if (text.trim()) textParts.push(text);
    }
  }

  return {
    text: textParts.join("\n").trim(),
    images,
    warnings
  };
}

async function waitForDocumentFocus(timeoutMs = 2500) {
  if (document.hasFocus()) return;
  window.focus();

  const startedAt = Date.now();
  while (!document.hasFocus() && Date.now() - startedAt < timeoutMs) {
    await delay(50);
  }

  if (!document.hasFocus()) {
    throw new Error(t("clipboardFocusRequired"));
  }
}

async function prepareImage(sourceBlob) {
  const bitmap = await createImageBitmap(sourceBlob);
  const originalUrl = URL.createObjectURL(sourceBlob);
  try {
    let outputBlob = sourceBlob;
    let width = bitmap.width;
    let height = bitmap.height;
    const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));

    if (scale < 1 || sourceBlob.size > MAX_IMAGE_BYTES) {
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
      outputBlob = await renderBitmap(bitmap, width, height, 0.86);

      if (outputBlob.size > MAX_IMAGE_BYTES) {
        const secondScale = Math.min(1, 1600 / Math.max(width, height));
        width = Math.max(1, Math.round(width * secondScale));
        height = Math.max(1, Math.round(height * secondScale));
        outputBlob = await renderBitmap(bitmap, width, height, 0.72);
      }
    }

    return {
      dataUrl: await blobToDataUrl(outputBlob),
      originalUrl
    };
  } catch (error) {
    URL.revokeObjectURL(originalUrl);
    throw error;
  } finally {
    bitmap.close();
  }
}

function renderBitmap(bitmap, width, height, quality) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error(t("imageResizeFailed")))),
      "image/jpeg",
      quality
    );
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error(t("imageEncodeFailed")));
    reader.readAsDataURL(blob);
  });
}

function isFocusError(error) {
  return /not focused|document is not focused/i.test(friendlyError(error));
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
