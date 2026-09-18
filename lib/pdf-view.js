'use client';

import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import { clampPdfZoom, pageTurn } from '@/lib/format';

// Worker is the same 4.10.38 build as pdfjs-dist (copied to public/).
GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

const docs = new Map();
let renderTask = null;
let paintSeq = 0;
let gate = Promise.resolve();

function room(n, fallback) {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function deadWorker(err) {
  return /worker|terminated|transport|Loading task/i.test(String(err?.message || err || ''));
}

export async function openPdfDoc(url, fresh = false) {
  if (!url) throw new Error('no pdf url');
  if (fresh) {
    const old = docs.get(url);
    docs.delete(url);
    try { await old?.destroy?.(); } catch { /* already dead */ }
  }
  const hit = docs.get(url);
  if (hit) return hit;
  const doc = await getDocument({ url, isEvalSupported: false }).promise;
  docs.set(url, doc);
  return doc;
}

async function cancelPaint() {
  const task = renderTask;
  renderTask = null;
  if (!task) return;
  task.cancel();
  try { await task.promise; } catch { /* RenderingCancelledException */ }
}

async function paintOnce(canvas, url, pageNumber, rotation, fitW, fitH, zoom, fresh) {
  const doc = await openPdfDoc(url, fresh);
  const page = await doc.getPage(Math.min(doc.numPages, Math.max(1, pageNumber | 0)));
  const rot = pageTurn(rotation);
  const base = page.getViewport({ scale: 1, rotation: rot });
  const bw = room(base.width, 1);
  const bh = room(base.height, 1);
  const fit = Math.min(room(fitW, bw) / bw, room(fitH, bh) / bh);
  const dpr = typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 2);
  const z = clampPdfZoom(zoom);
  const cssScale = Math.min(8, Math.max(0.2, (Number.isFinite(fit) && fit > 0 ? fit : 1) * z));
  const viewport = page.getViewport({ scale: cssScale * dpr, rotation: rot });
  const w = Math.max(1, Math.floor(Number.isFinite(viewport.width) ? viewport.width : 1));
  const h = Math.max(1, Math.floor(Number.isFinite(viewport.height) ? viewport.height : 1));
  await cancelPaint();
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = `${w / dpr}px`;
  canvas.style.height = `${h / dpr}px`;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return null;
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

export async function paintPdfPage(canvas, url, pageNumber, rotation, fitW, fitH, zoom) {
  if (!canvas || !url) return null;
  const mine = ++paintSeq;
  let unlock = () => {};
  const prev = gate;
  gate = new Promise((r) => { unlock = r; });
  await prev;
  try {
    if (mine !== paintSeq) return null;
    try {
      return await paintOnce(canvas, url, pageNumber, rotation, fitW, fitH, zoom, false);
    } catch (err) {
      if (mine !== paintSeq) return null;
      if (!deadWorker(err)) throw err;
      return await paintOnce(canvas, url, pageNumber, rotation, fitW, fitH, zoom, true);
    }
  } finally {
    unlock();
  }
}
