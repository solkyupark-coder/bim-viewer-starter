'use client';

import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';

// Worker is the same 4.10.38 build as pdfjs-dist (copied to public/).
GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

const docs = new Map();
let renderTask = null;

export async function openPdfDoc(url) {
  if (!url) throw new Error('no pdf url');
  const hit = docs.get(url);
  if (hit) return hit;
  const doc = await getDocument({ url, isEvalSupported: false }).promise;
  docs.set(url, doc);
  return doc;
}

export async function paintPdfPage(canvas, url, pageNumber, rotation, fitW, fitH, zoom) {
  const doc = await openPdfDoc(url);
  const page = await doc.getPage(Math.min(doc.numPages, Math.max(1, pageNumber)));
  const base = page.getViewport({ scale: 1, rotation });
  const fit = Math.min((fitW || base.width) / base.width, (fitH || base.height) / base.height);
  const dpr = typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 2);
  const cssScale = Math.max(0.2, fit * (Number(zoom) || 1));
  const viewport = page.getViewport({ scale: cssScale * dpr, rotation });
  if (renderTask) {
    renderTask.cancel();
    renderTask = null;
  }
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${viewport.width / dpr}px`;
  canvas.style.height = `${viewport.height / dpr}px`;
  const ctx = canvas.getContext('2d', { alpha: false });
  renderTask = page.render({ canvasContext: ctx, viewport });
  try {
    await renderTask.promise;
  } catch (err) {
    if (err?.name === 'RenderingCancelledException') return null;
    throw err;
  } finally {
    renderTask = null;
  }
  return { pages: doc.numPages };
}
