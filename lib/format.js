export function kindOf(name) {
  const ext = String(name || '').split('.').pop().toLowerCase();
  return ({ ifc: 'ifc', dxf: 'dxf', dwg: 'dwg', glb: 'glb', gltf: 'glb', dae: 'dae', '3dm': '3dm' })[ext] || null;
}

export function is3d(kind) {
  return ['ifc', 'glb', 'dae', '3dm'].includes(kind);
}

export function isShareableId(id) {
  return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

export function sharePath(id) {
  return `/m/${id}`;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function fmtDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function safeFileName(name) {
  return String(name || 'file').replace(/[^\w.\-가-힣]/g, '_');
}

export function isPdfName(name) {
  return String(name || '').split('.').pop().toLowerCase() === 'pdf';
}

export function isImageFile(file) {
  if (!file) return false;
  if (file.type && String(file.type).startsWith('image/')) return true;
  return /^(jpe?g|png|gif|webp|heic|heif|bmp)$/i.test(String(file.name || '').split('.').pop());
}

export function issueStatus(row) {
  return row?.status === 'done' ? 'done' : 'open';
}

export function nextIssueStatus(status) {
  return status === 'done' ? 'open' : 'done';
}

export function issueLabel(status) {
  return status === 'done' ? '완료' : '열림';
}

export function lectureErr(msg) {
  const s = String(msg || '');
  if (/invalid input syntax for type uuid|22P02/i.test(s)) return s;
  if (!s || /bucket not found|could not find the table|schema cache|does not exist|permission denied for table/i.test(s)) {
    return 'DB에 저장 못 했어요';
  }
  return s;
}

export const PRESENCE_PALETTE = ['#0474E0', '#E05A04', '#1A8A5A', '#C43B6E', '#6B4FE0', '#C49A00', '#0D8A8A', '#D4482A'];

export function hashColor(s) {
  let h = 2166136261;
  const t = String(s || '');
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return PRESENCE_PALETTE[(h >>> 0) % PRESENCE_PALETTE.length];
}

export function peersFromPresence(state, selfKey) {
  return Object.entries(state || {}).flatMap(([key, metas]) => {
    if (key === selfKey) return [];
    const m = metas?.[metas.length - 1];
    if (!m || !Number.isFinite(+m.x) || !Number.isFinite(+m.y)) return [];
    return [{
      key,
      name: String(m.name || '').trim(),
      color: PRESENCE_PALETTE.includes(m.color) ? m.color : hashColor(m.name || key),
      x: Math.min(1, Math.max(0, +m.x)),
      y: Math.min(1, Math.max(0, +m.y)),
      surface: m.surface === 'pdf' ? 'pdf' : 'model',
      drawing_id: String(m.drawing_id || ''),
      page: Number.isFinite(+m.page) ? Math.max(1, Math.round(+m.page)) : 1,
    }];
  });
}

export function isPdfComment(c) {
  return c?.kind === 'pdf';
}

export function commentSurface(c) {
  return isPdfComment(c) ? 'pdf' : 'model';
}

export function commentSurfaceLabel(c) {
  return commentSurface(c) === 'pdf' ? '도면' : '모델';
}

export function commentWhere(c) {
  if (isPdfComment(c)) return `도면 p.${c.page || 1}`;
  return c?.element_name ? `모델 · ${c.element_name}` : '모델';
}

export function schemaGap(msg) {
  return /column|schema cache|does not exist|could not find the|permission denied|row-level security|not authorized|42501/i.test(String(msg || ''));
}

export function unitPos(pos) {
  const x = Number(pos?.x);
  const y = Number(pos?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: 0.5, y: 0.5 };
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
}

export function ndcFromEvent(event, el) {
  const r = el.getBoundingClientRect();
  const w = r.width || 1;
  const h = r.height || 1;
  return {
    x: ((event.clientX - r.left) / w) * 2 - 1,
    y: -((event.clientY - r.top) / h) * 2 + 1,
  };
}

export function ndcToUnit(ndc) {
  return {
    x: Math.min(1, Math.max(0, (ndc.x + 1) / 2)),
    y: Math.min(1, Math.max(0, (1 - ndc.y) / 2)),
  };
}

export function pageTurn(deg) {
  return (((Number(deg) || 0) % 360) + 360) % 360;
}

export function clampPdfZoom(z) {
  const n = Number(z);
  const raw = Number.isFinite(n) ? n : 1;
  return Math.min(3, Math.max(0.5, Math.round(raw * 4) / 4));
}

/** Displayed (rotated, optional flip) 0–1 → unrotated page 0–1. pdf.js rotation is clockwise. */
export function pageUnitFromRotated(x, y, deg, flipX) {
  const sx = flipX ? 1 - x : x;
  const r = pageTurn(deg);
  if (r === 90) return { x: y, y: 1 - sx };
  if (r === 180) return { x: 1 - sx, y: 1 - y };
  if (r === 270) return { x: 1 - y, y: sx };
  return { x: sx, y };
}

/** Unrotated page 0–1 → displayed (rotated, optional flip) 0–1. */
export function rotatedFromPageUnit(x, y, deg, flipX) {
  const r = pageTurn(deg);
  let mark;
  if (r === 90) mark = { x: 1 - y, y: x };
  else if (r === 180) mark = { x: 1 - x, y: 1 - y };
  else if (r === 270) mark = { x: y, y: 1 - x };
  else mark = { x, y };
  return flipX ? { x: 1 - mark.x, y: mark.y } : mark;
}

export function clampFov(deg) {
  const n = Number(deg);
  return Math.min(90, Math.max(20, Number.isFinite(n) ? n : 50));
}

export function explodeVec(origin, part) {
  return { x: part.x - origin.x, y: part.y - origin.y, z: part.z - origin.z };
}

export function explodePos(base, vec, amount) {
  const t = Number(amount) || 0;
  return { x: base.x + vec.x * t, y: base.y + vec.y * t, z: base.z + vec.z * t };
}

export function verticalExplodeY(baseY, storey, gap, amount) {
  return baseY + (storey == null ? 0 : storey * gap * (Number(amount) || 0));
}

export function commentHotkeyBlocked(target) {
  return !!target?.closest?.('input, textarea, select');
}

export function walkClickIntent(hitId, modifier, isGround) {
  if (modifier || isGround || hitId == null) return 'teleport';
  return 'select';
}

export function walkPoseFromHit(hit, look, diag) {
  const eye = Math.max((Number(diag) || 10) * 0.02, 0.15);
  let lx = +look.x || 0;
  let lz = +look.z || 0;
  const len = Math.hypot(lx, lz);
  if (len < 1e-6) { lx = 0; lz = -1; }
  else { lx /= len; lz /= len; }
  return { x: +hit.x, y: +hit.y + eye, z: +hit.z, lx, lz, eye };
}

export async function pdfPageCount(url) {
  if (!url) return 1;
  try {
    const buf = await (await fetch(url)).arrayBuffer();
    const text = new TextDecoder('latin1').decode(buf);
    // ponytail: /Type /Page count; use a PDF parser if object streams hide pages
    return Math.max(1, (text.match(/\/Type\s*\/Page(?!s)\b/g) || []).length);
  } catch {
    return 1;
  }
}

export function fileStem(name) {
  return String(name || '')
    .trim()
    .replace(/^\d{10,}_/, '')
    .replace(/\.[^.]+$/, '')
    .replace(/[_\-\s]+(rev|v|old|back)?\d+$/i, '')
    .toLowerCase();
}

export const SAMPLE_PROJECT = '정X 샘플';
export const HLAB_PROJECT = '현X H LAB';
export const PROJECTS_KEY = 'viewer-projects';
export const HLAB_PDFS = [
  '1층 평면도.pdf',
  '1층 천장도.pdf',
  '2층 평면도.pdf',
  '2층 천장도.pdf',
  '복도 실내 입면도.pdf',
  '호텔 실내 입면도.pdf',
  '홍보관 실내 입면도.pdf',
];

export function rowProject(row) {
  const p = String(row?.project || '').trim();
  if (p) return p;
  const id = String(row?.id || '');
  const url = String(row?.url || row?.path || '');
  if (id.startsWith('local-hlab') || url.includes('/samples/hlab/')) return HLAB_PROJECT;
  const stem = fileStem(row?.name);
  if (id.startsWith('local-sample') || /jeongrim|정림/.test(stem) || /sample_drawing|sample_plan/.test(stem)) {
    return SAMPLE_PROJECT;
  }
  const name = String(row?.name || '').replace(/^\d{10,}_/, '').replace(/\.[^.]+$/, '').trim();
  return name || '프로젝트';
}

export function projectNameOf(row) {
  if (row == null || row === '') return SAMPLE_PROJECT;
  if (typeof row === 'string') return row.replace(/^p:/, '') || SAMPLE_PROJECT;
  if (row.label) return row.label;
  if (row.key) return String(row.key).replace(/^p:/, '') || SAMPLE_PROJECT;
  return rowProject(row);
}

export function projectKey(row) {
  return `p:${projectNameOf(row)}`;
}

export function projectLabel(row) {
  return projectNameOf(row);
}

export function readNamedProjects(raw) {
  try {
    const list = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(list)) return [];
    return [...new Set(list.map((s) => String(s || '').trim()).filter(Boolean))];
  } catch {
    return [];
  }
}

export function addNamedProject(list, name) {
  const n = String(name || '').trim();
  const cur = Array.isArray(list) ? list : [];
  if (!n) return cur;
  return cur.includes(n) ? cur : [...cur, n];
}

export function pickProject(tree, want) {
  if (!tree?.length) return null;
  const key = want == null || want === ''
    ? projectKey(SAMPLE_PROJECT)
    : (typeof want === 'string' ? (want.startsWith('p:') ? want : projectKey(want)) : projectKey(want));
  return tree.find((p) => p.key === key) || tree.find((p) => p.label === SAMPLE_PROJECT) || tree[0];
}

export function fileKindLabel(kind) {
  return kind === 'photo' ? '사진' : String(kind || '').toUpperCase();
}

function lectureSlot(kind) {
  if (kind === 'ifc') return 'ifc';
  if (kind === 'dwg' || kind === 'dxf') return 'dwg';
  if (kind === 'pdf') return 'pdf';
  if (kind === 'glb' || kind === 'dae' || kind === '3dm') return 'model';
  return '';
}

// 자리만 잡아 주는 호스트(현X H LAB 같은 빈 glb)는 목록에 안 보입니다. 실제 파일이 있어야 뜹니다.
function placeholderFile(f) {
  return lectureSlot(f.kind) === 'model' && !f.url && !f.source?.file;
}

function lectureScore(f) {
  const stem = fileStem(f.name);
  let n = 0;
  if (/jeongrim|정림/.test(stem)) n += 8;
  if (/sample_drawing|sample_plan/.test(stem)) n += 6;
  if (f.kind === 'dwg') n += 4;
  if (isShareableId(String(f.id))) n += 2;
  n += Math.min(1, new Date(f.created_at || 0).getTime() / 1e15);
  return n;
}

export function lectureFileName(file) {
  const kind = file?.kind || kindOf(file?.name) || (isPdfName(file?.name) ? 'pdf' : '');
  const stem = fileStem(file?.name);
  if (kind === 'ifc' && /jeongrim|정림/.test(stem)) return '정X 3D.ifc';
  if ((kind === 'dwg' || kind === 'dxf') && /jeongrim|정림|sample_plan/.test(stem)) {
    return kind === 'dxf' ? '정X 2D.dxf' : '정X 2D.dwg';
  }
  if ((kind === 'pdf' || isPdfName(file?.name)) && /sample_drawing|정림/.test(stem)) return '정X 도면.pdf';
  return String(file?.name || '').replace(/^\d{10,}_/, '');
}

export function projectHead(models) {
  const rank = (m) => (m.kind === 'ifc' ? 4 : m.kind === '3dm' ? 3 : is3d(m.kind) ? 2 : 1);
  return [...models].sort((a, b) => {
    const share = Number(isShareableId(String(b.id))) - Number(isShareableId(String(a.id)));
    if (share) return share;
    const r = rank(b) - rank(a);
    if (r) return r;
    return new Date(b.created_at || 0) - new Date(a.created_at || 0);
  })[0] || models[0];
}

function asFile(row, role) {
  return {
    id: row.id,
    name: row.name,
    kind: role === 'pdf' ? 'pdf' : role === 'photo' ? 'photo' : row.kind,
    role,
    created_at: row.created_at,
    url: row.url || '',
    path: row.path || row.photo_path || '',
    model_id: row.model_id || (role === 'model' ? row.id : ''),
    source: row,
  };
}

export function splitLatest(files, onePerSlot = false) {
  const groups = new Map();
  for (const f of files) {
    const s = lectureSlot(f.kind);
    if (!s || placeholderFile(f)) continue;
    const k = onePerSlot ? s : `${s}:${fileStem(f.name)}`;
    const list = groups.get(k);
    if (list) list.push(f);
    else groups.set(k, [f]);
  }
  const latest = [];
  const back = [];
  for (const list of groups.values()) {
    list.sort((a, b) => lectureScore(b) - lectureScore(a) || String(b.id).localeCompare(String(a.id)));
    latest.push(list[0]);
    const stem = fileStem(list[0].name);
    back.push(...list.slice(1).filter((f) => !onePerSlot || fileStem(f.name) === stem));
  }
  const order = { ifc: 0, glb: 0, dae: 0, '3dm': 0, dwg: 1, dxf: 1, pdf: 2 };
  latest.sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9) || String(a.name).localeCompare(String(b.name), 'ko'));
  return { latest, back };
}

export function groupProjects(models, drawings = [], extra = []) {
  const extraNames = (Array.isArray(extra) ? extra : []).filter((x) => typeof x === 'string' && String(x).trim());
  const byId = new Map((models || []).map((m) => [m.id, m]));
  const buckets = new Map();
  const bucket = (name) => {
    const label = String(name || '').trim() || '프로젝트';
    const key = projectKey(label);
    let g = buckets.get(key);
    if (!g) {
      g = { key, label, models: [], files: [] };
      buckets.set(key, g);
    }
    return g;
  };
  for (const m of models || []) {
    const g = bucket(rowProject(m));
    g.models.push(m);
    g.files.push(asFile(m, 'model'));
  }
  for (const d of drawings || []) {
    const host = byId.get(d.model_id);
    const g = bucket(host ? rowProject(host) : rowProject(d));
    if (host && !g.models.some((row) => row.id === host.id)) g.models.push(host);
    g.files.push(asFile(d, 'pdf'));
  }
  for (const name of [SAMPLE_PROJECT, HLAB_PROJECT, ...extraNames]) bucket(name);
  const rank = (label) => (label === SAMPLE_PROJECT ? 0 : label === HLAB_PROJECT ? 1 : 2);
  return [...buckets.values()]
    .map((g) => {
      const { latest, back } = splitLatest(g.files, g.label === SAMPLE_PROJECT);
      return { key: g.key, label: g.label, head: projectHead(g.models), models: g.models, latest, back };
    })
    .sort((a, b) => rank(a.label) - rank(b.label) || a.label.localeCompare(b.label, 'ko'));
}

export function activityAuthor(row, fallback) {
  return String(row?.author || row?.owner || fallback || '').trim() || '이름 없음';
}

function clipActivity(s, n = 28) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

export function eventKind(type) {
  if (type === 'comment_add') return 'comment';
  if (type === 'comment_done') return 'done';
  return type;
}

export function activityKind(type) {
  if (type === 'comment') return 'comment_add';
  if (type === 'done') return 'comment_done';
  return type;
}

export function asActivityEvent(row, fallback = {}) {
  const type = activityKind(row?.type);
  const ref = row?.ref || row?.file_id || row?.comment_id || '';
  const isFile = type === 'file_add' || type === 'file_replace';
  const project = row?.project
    ? (String(row.project).startsWith('p:') ? row.project : `p:${row.project}`)
    : (fallback.project || projectKey());
  return {
    id: row?.id || `event:${type}:${ref || row?.created_at || row?.at || ''}`,
    type,
    at: row?.created_at || row?.at,
    author: activityAuthor(row, fallback.author),
    project,
    file_id: isFile ? (row?.file_id || ref) : row?.file_id,
    comment_id: !isFile ? (row?.comment_id || ref) : row?.comment_id,
    name: row?.name || fallback.name || '',
    surface: row?.surface || fallback.surface || '',
    model_id: row?.model_id,
    file: row?.file,
    comment: row?.comment,
  };
}

export function fileEventType(name, existing = []) {
  const kind = kindOf(name) || (isPdfName(name) ? 'pdf' : '');
  const slot = kind === 'dwg' || kind === 'dxf' ? 'dwg' : kind;
  const stem = fileStem(name);
  const hit = existing.some((f) => {
    const fk = f.kind || kindOf(f.name) || (isPdfName(f.name) ? 'pdf' : '');
    const fs = fk === 'dwg' || fk === 'dxf' ? 'dwg' : fk;
    return fs === slot && fileStem(f.name) === stem;
  });
  return hit ? 'file_replace' : 'file_add';
}

export function activityTitle(ev) {
  const short = clipActivity(ev?.name);
  const surface = ev?.surface || (ev?.comment ? commentSurface(ev.comment) : '');
  const where = surface === 'pdf' ? '도면' : surface === 'model' ? '모델' : '';
  switch (activityKind(ev?.type)) {
    case 'file_add': return short ? `${short} 올림` : '파일 올림';
    case 'file_replace': return short ? `${short} 바꿈 · 이전` : '파일 바꿈 · 이전';
    case 'comment_add': return short
      ? (where ? `${where} 코멘트 남김 · ${short}` : `코멘트 남김 · ${short}`)
      : (where ? `${where} 코멘트 남김` : '코멘트 남김');
    case 'comment_done': return short
      ? (where ? `${where} 코멘트 완료 · ${short}` : `코멘트 완료 · ${short}`)
      : (where ? `${where} 코멘트 완료` : '코멘트 완료');
    default: return short;
  }
}

export function projectActivity(project, comments = [], extra = [], fileAuthor = '') {
  if (!project) return [];
  const events = [];
  const files = [...(project.latest || []), ...(project.back || [])].filter((f) => f.role !== 'photo');
  const groups = new Map();
  for (const f of files) {
    const k = `${f.kind}:${fileStem(f.name)}`;
    const list = groups.get(k);
    if (list) list.push(f);
    else groups.set(k, [f]);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0) || String(a.id).localeCompare(String(b.id)));
    list.forEach((f, i) => {
      events.push({
        id: `file:${f.id}`,
        type: i === 0 ? 'file_add' : 'file_replace',
        at: f.created_at,
        author: activityAuthor(f.source || f, fileAuthor),
        file: f,
        file_id: f.id,
        name: f.name,
      });
    });
  }
  const ids = new Set((project.models || []).map((m) => m.id));
  const extraRows = extra.map((e) => asActivityEvent(e, { author: fileAuthor }));
  const seenDone = new Set(extraRows.filter((e) => e.type === 'comment_done').map((e) => e.comment_id));
  for (const c of comments) {
    if (c.model_id && ids.size && !ids.has(c.model_id)) continue;
    events.push({
      id: `comment:${c.id}`,
      type: 'comment_add',
      at: c.created_at,
      author: activityAuthor(c, fileAuthor),
      comment: c,
      comment_id: c.id,
      name: c.body,
      surface: commentSurface(c),
    });
    if (issueStatus(c) === 'done' && !seenDone.has(c.id)) {
      events.push({
        id: `comment-done:${c.id}`,
        type: 'comment_done',
        at: c.updated_at || c.done_at || c.created_at,
        author: activityAuthor(c, fileAuthor),
        comment: c,
        comment_id: c.id,
        name: c.body,
        surface: commentSurface(c),
      });
    }
  }
  for (const e of extraRows) {
    if (e.project && e.project !== project.key) continue;
    if ((e.type === 'file_add' || e.type === 'file_replace') && e.file_id && events.some((x) => x.type === e.type && x.file_id === e.file_id)) continue;
    if (e.type === 'comment_add' && e.comment_id && events.some((x) => x.type === 'comment_add' && x.comment_id === e.comment_id)) continue;
    if (!e.comment && e.comment_id) {
      const c = comments.find((row) => row.id === e.comment_id);
      if (c) {
        e.comment = c;
        e.name = e.name || c.body;
        e.surface = e.surface || commentSurface(c);
      }
    }
    if (!e.project && e.comment_id && !e.comment && e.type !== 'file_add' && e.type !== 'file_replace') continue;
    events.push(e);
  }
  return events.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0) || String(b.id).localeCompare(String(a.id)));
}

export function sampleBundle() {
  const t1 = '2026-09-01T09:00:00.000Z';
  return {
    models: [
      { id: 'local-sample-ifc', name: 'Jeongrim3_3D.ifc', kind: 'ifc', project: SAMPLE_PROJECT, url: '/samples/Jeongrim3_3D.ifc', created_at: t1 },
      { id: 'local-sample-dwg', name: 'Jeongrim3_2D.dwg', kind: 'dwg', project: SAMPLE_PROJECT, url: '/samples/Jeongrim3_2D.dwg', created_at: t1 },
    ],
    drawings: [
      { id: 'local-sample-pdf', model_id: 'local-sample-ifc', name: 'sample_drawing.pdf', url: '/samples/sample_drawing.pdf', created_at: t1 },
    ],
  };
}

export function hlabBundle() {
  const t1 = '2026-09-10T09:00:00.000Z';
  return {
    models: [
      { id: 'local-hlab', name: HLAB_PROJECT, kind: 'glb', project: HLAB_PROJECT, url: '', created_at: t1 },
    ],
    drawings: HLAB_PDFS.map((name, i) => ({
      id: `local-hlab-pdf-${i + 1}`,
      model_id: 'local-hlab',
      name,
      url: `/samples/hlab/${encodeURI(name)}`,
      created_at: t1,
      project: HLAB_PROJECT,
    })),
  };
}

export function mergeLectureModels(remote = []) {
  const samples = [...sampleBundle().models, ...hlabBundle().models];
  const seenId = new Set(remote.map((r) => r.id));
  const seenStem = new Set(
    remote.filter((r) => lectureSlot(r.kind) && r.kind !== 'dxf').map((r) => `${rowProject(r)}:${lectureSlot(r.kind)}:${fileStem(r.name)}`),
  );
  const hasHlabHost = remote.some((r) => rowProject(r) === HLAB_PROJECT);
  return [
    ...remote,
    ...samples.filter((m) => {
      if (seenId.has(m.id)) return false;
      if (m.id === 'local-hlab' && hasHlabHost) return false;
      const slot = lectureSlot(m.kind);
      if (slot && seenStem.has(`${rowProject(m)}:${slot}:${fileStem(m.name)}`)) return false;
      return true;
    }),
  ];
}

export function mergeLectureDrawings(remote = []) {
  const samples = [...sampleBundle().drawings, ...hlabBundle().drawings];
  const seenId = new Set(remote.map((r) => r.id));
  const seenStem = new Set(remote.map((r) => fileStem(r.name)));
  return [
    ...remote,
    ...samples.filter((d) => !seenId.has(d.id) && !seenStem.has(fileStem(d.name))),
  ];
}

export const SAMPLES = [...new Map(sampleBundle().models.map((m) => [m.url, fileKindLabel(m.kind)])).entries()];

if (typeof window === 'undefined' && process.argv[1]?.includes('format.js')) {
  console.assert(kindOf('a.IFC') === 'ifc');
  console.assert(kindOf('house.gltf') === 'glb');
  console.assert(kindOf('x.skp') === null);
  console.assert(is3d('ifc') && !is3d('dxf'));
  console.assert(isShareableId('11dcfc39-9fb7-4414-812a-119eaeaeb412') && !isShareableId('local-1') && !isShareableId('a1b2') && !isShareableId('local-sample-pdf'));
  console.assert(sharePath('x') === '/m/x');
  console.assert(safeFileName('a b/c.pdf') === 'a_b_c.pdf');
  console.assert(isPdfName('A.PDF') && !isPdfName('a.dxf'));
  console.assert(isImageFile({ name: 'x.PNG', type: '' }));
  console.assert(issueStatus({}) === 'open' && issueStatus({ status: 'done' }) === 'done');
  const stagePins = [{ pos_x: 1 }, { pos_x: 2, status: 'done' }, { status: 'open' }].filter((c) => c.pos_x != null && issueStatus(c) !== 'done');
  console.assert(stagePins.length === 1 && stagePins[0].pos_x === 1);
  console.assert(nextIssueStatus('open') === 'done' && nextIssueStatus('done') === 'open');
  console.assert(issueLabel('open') === '열림' && issueLabel('done') === '완료');
  console.assert(lectureErr('Bucket not found') === 'DB에 저장 못 했어요');
  console.assert(lectureErr('') === 'DB에 저장 못 했어요');
  console.assert(lectureErr('network down') === 'network down');
  console.assert(hashColor('민수') === hashColor('민수') && PRESENCE_PALETTE.includes(hashColor('민수')));
  console.assert(hashColor('민수') !== hashColor('지훈') && hashColor('a') !== hashColor('b'));
  const peers = peersFromPresence({
    me: [{ name: '나', color: PRESENCE_PALETTE[0], x: 0.2, y: 0.3 }],
    you: [{ name: '민수', color: PRESENCE_PALETTE[1], x: 1.4, y: -0.2 }],
    ghost: [{ name: 'x' }],
  }, 'me');
  console.assert(peers.length === 1 && peers[0].key === 'you' && peers[0].name === '민수' && peers[0].x === 1 && peers[0].y === 0);
  console.assert(peers[0].surface === 'model');
  console.assert(isPdfComment({ kind: 'pdf' }) && !isPdfComment({ kind: 'model' }) && !isPdfComment({}));
  console.assert(commentSurface({ kind: 'pdf' }) === 'pdf' && commentSurface({}) === 'model');
  console.assert(commentSurfaceLabel({ kind: 'pdf' }) === '도면' && commentSurfaceLabel({}) === '모델');
  console.assert(commentWhere({ kind: 'pdf', page: 2 }) === '도면 p.2');
  console.assert(commentWhere({ element_name: '벽' }) === '모델 · 벽' && commentWhere({}) === '모델');
  console.assert(schemaGap('column kind does not exist') && !schemaGap('network down'));
  console.assert(schemaGap("Could not find the table 'public.events' in the schema cache"));
  console.assert(schemaGap("Could not find the 'status' column of 'comments' in the schema cache"));
  console.assert(lectureErr("Could not find the 'status' column of 'comments' in the schema cache") === 'DB에 저장 못 했어요');
  console.assert(lectureErr('invalid input syntax for type uuid: "local-sample-pdf"') === 'invalid input syntax for type uuid: "local-sample-pdf"');
  console.assert(schemaGap('permission denied for table comments') && schemaGap('new row violates row-level security policy'));
  console.assert(unitPos(null).x === 0.5 && unitPos({ x: 2, y: -1 }).x === 1 && unitPos({ x: 2, y: -1 }).y === 0);
  const el = { getBoundingClientRect: () => ({ left: 10, top: 20, width: 100, height: 200 }) };
  const ndc = ndcFromEvent({ clientX: 60, clientY: 70 }, el);
  console.assert(Math.abs(ndc.x) < 1e-9 && Math.abs(ndc.y - 0.5) < 1e-9);
  const unit = ndcToUnit(ndc);
  console.assert(Math.abs(unit.x - 0.5) < 1e-9 && Math.abs(unit.y - 0.25) < 1e-9);
  console.assert(pageTurn(-90) === 270 && pageTurn(450) === 90);
  const r90 = rotatedFromPageUnit(0, 0, 90);
  console.assert(r90.x === 1 && r90.y === 0);
  const back = pageUnitFromRotated(r90.x, r90.y, 90);
  console.assert(back.x === 0 && back.y === 0);
  const mid = pageUnitFromRotated(0.25, 0.1, 180);
  console.assert(mid.x === 0.75 && mid.y === 0.9);
  const cw270 = rotatedFromPageUnit(0, 0, 270);
  console.assert(cw270.x === 0 && cw270.y === 1);
  console.assert(clampPdfZoom(NaN) === 1 && clampPdfZoom(0) === 0.5 && clampPdfZoom(9) === 3);
  console.assert(clampPdfZoom(1.2) === 1.25);
  const flipped = rotatedFromPageUnit(0.2, 0.3, 0, true);
  console.assert(flipped.x === 0.8 && flipped.y === 0.3);
  const backF = pageUnitFromRotated(flipped.x, flipped.y, 0, true);
  console.assert(backF.x === 0.2 && backF.y === 0.3);
  const rf = rotatedFromPageUnit(0, 0, 90, true);
  console.assert(rf.x === 0 && rf.y === 0);
  const bf = pageUnitFromRotated(0, 0, 90, true);
  console.assert(bf.x === 0 && bf.y === 0);
  const pdfPeer = peersFromPresence({
    a: [{ name: '지훈', color: PRESENCE_PALETTE[2], x: 0.2, y: 0.3, surface: 'pdf', drawing_id: 'd1', page: 2 }],
  }, 'me')[0];
  console.assert(pdfPeer.surface === 'pdf' && pdfPeer.drawing_id === 'd1' && pdfPeer.page === 2);
  const poseA = walkPoseFromHit({ x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: -1 }, 80);
  console.assert(poseA.eye === 1.6 && poseA.y === 3.6 && poseA.lx === 0 && poseA.lz === -1 && poseA.x === 1 && poseA.z === 3);
  const poseB = walkPoseFromHit({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }, 10);
  console.assert(poseB.lx === 0 && poseB.lz === -1 && poseB.eye === 0.2);
  const poseC = walkPoseFromHit({ x: 0, y: 0, z: 0 }, { x: 3, y: 9, z: 4 }, 5);
  console.assert(Math.abs(poseC.lx - 0.6) < 1e-9 && Math.abs(poseC.lz - 0.8) < 1e-9 && poseC.eye === 0.15);
  console.assert(walkClickIntent(12, false, false) === 'select');
  console.assert(walkClickIntent(12, true, false) === 'teleport');
  console.assert(walkClickIntent(null, false, false) === 'teleport');
  console.assert(walkClickIntent(1, false, true) === 'teleport');
  console.assert(commentHotkeyBlocked({ closest: (s) => s.includes('textarea') }) === true);
  console.assert(commentHotkeyBlocked({ closest: () => null }) === false);
  console.assert(fileStem('1234567890123_Jeongrim3_3D_v2.ifc') === 'jeongrim3_3d');
  console.assert(fileKindLabel('photo') === '사진' && fileKindLabel('ifc') === 'IFC');
  const bundle = sampleBundle();
  const tree = groupProjects(bundle.models, bundle.drawings, []);
  console.assert(tree[0].label === SAMPLE_PROJECT && tree.some((p) => p.label === HLAB_PROJECT));
  console.assert(tree[0].latest.map((f) => f.kind).join(',') === 'ifc,dwg,pdf');
  console.assert(tree[0].back.length === 0);
  console.assert(tree[0].latest.map((f) => lectureFileName(f)).join(',') === '정X 3D.ifc,정X 2D.dwg,정X 도면.pdf');
  console.assert(SAMPLES.length >= 2 && SAMPLES.every(([href, label]) => href && label));
  console.assert(tree[0].head.id === 'local-sample-ifc');
  console.assert(projectKey({ id: 'x', project: 'sample_house' }) === 'p:sample_house');
  console.assert(projectLabel({ name: 'Jeongrim3_3D.ifc' }) === SAMPLE_PROJECT);
  console.assert(projectKey(HLAB_PROJECT) === `p:${HLAB_PROJECT}`);
  const mixed = mergeLectureModels([{ id: 'r1', name: 'other.glb', kind: 'glb', project: '업로드' }]);
  const lecture = groupProjects(mixed, bundle.drawings, []);
  console.assert(lecture.some((p) => p.label === SAMPLE_PROJECT) && lecture.some((p) => p.label === '업로드'));
  const jeongrim = lecture.find((p) => p.label === SAMPLE_PROJECT);
  console.assert(jeongrim && !jeongrim.latest.some((f) => f.id === 'r1'));
  console.assert(jeongrim.latest.map((f) => f.kind).join(',') === 'ifc,dwg,pdf');
  const splitRemote = groupProjects([
    { id: 'a', name: 'Jeongrim3_3D.ifc', kind: 'ifc', created_at: '2026-09-01T09:00:00.000Z' },
    { id: 'b', name: 'sample_house.ifc', kind: 'ifc', created_at: '2026-09-01T09:00:00.000Z' },
  ], [], []);
  console.assert(splitRemote.find((p) => p.label === SAMPLE_PROJECT)?.latest[0].id === 'a');
  console.assert(splitRemote.find((p) => p.label === 'sample_house')?.latest[0].id === 'b');
  const withOld = groupProjects([
    { id: 'new', name: 'Jeongrim3_3D.ifc', kind: 'ifc', created_at: '2026-09-01T09:00:00.000Z' },
    { id: 'old', name: 'Jeongrim3_3D.ifc', kind: 'ifc', created_at: '2026-03-01T09:00:00.000Z' },
  ], [], []);
  console.assert(withOld[0].latest[0].id === 'new' && withOld[0].back[0].id === 'old');
  console.assert(mergeLectureModels([{ id: 'local-sample-ifc' }]).filter((m) => m.id === 'local-sample-ifc').length === 1);
  console.assert(!mergeLectureModels([{ id: 'r-ifc', name: 'Jeongrim3_3D.ifc', kind: 'ifc' }]).some((m) => m.id === 'local-sample-ifc'));
  const noTable = mergeLectureDrawings([]);
  console.assert(noTable.some((d) => d.id === 'local-sample-pdf' && d.url === '/samples/sample_drawing.pdf'));
  console.assert(mergeLectureDrawings(noTable).filter((d) => d.id === 'local-sample-pdf').length === 1);
  const remoteOnly = groupProjects(mixed, [], []).find((p) => p.label === SAMPLE_PROJECT);
  console.assert(remoteOnly && !remoteOnly.latest.some((f) => f.kind === 'pdf'));
  const healed = groupProjects(mixed, mergeLectureDrawings([]), []).find((p) => p.label === SAMPLE_PROJECT);
  console.assert(healed && healed.latest.some((f) => f.kind === 'pdf' && f.name === 'sample_drawing.pdf'));
  const acts = projectActivity(tree[0], [], [], '');
  console.assert(acts[0] && new Date(acts[0].at) >= new Date(acts[acts.length - 1].at));
  console.assert(acts.some((e) => e.type === 'file_add' && e.name === 'Jeongrim3_2D.dwg'));
  console.assert(!acts.some((e) => e.type === 'file_replace'));
  const dxfRemote = groupProjects(mergeLectureModels([
    { id: 'r-dxf', name: 'sample_plan.dxf', kind: 'dxf', created_at: '2026-09-01T09:00:00.000Z' },
  ]), bundle.drawings);
  console.assert(dxfRemote[0].latest.map((f) => lectureFileName(f)).join(',') === '정X 3D.ifc,정X 2D.dwg,정X 도면.pdf');
  console.assert(!dxfRemote[0].latest.some((f) => f.kind === 'dxf'));
  const both = groupProjects(mergeLectureModels([]), mergeLectureDrawings([]));
  console.assert(both[0].label === SAMPLE_PROJECT && both[1].label === HLAB_PROJECT);
  const hlab = both.find((p) => p.label === HLAB_PROJECT);
  console.assert(hlab.latest.length === 7 && hlab.latest.every((f) => f.kind === 'pdf'));
  console.assert(HLAB_PDFS.every((n) => hlab.latest.some((f) => f.name === n)));
  console.assert(pickProject(both, '').label === SAMPLE_PROJECT);
  console.assert(pickProject(both, projectKey(HLAB_PROJECT)).label === HLAB_PROJECT);
  console.assert(readNamedProjects('["A","A",""]').join(',') === 'A');
  console.assert(addNamedProject(['A'], 'B').join(',') === 'A,B' && addNamedProject(['A'], 'A').join(',') === 'A');
  const named = groupProjects([], [], addNamedProject([], '내 프로젝트'));
  console.assert(named.some((p) => p.label === '내 프로젝트' && p.latest.length === 0));
  console.assert(activityTitle({ type: 'file_add', name: 'a.ifc' }) === 'a.ifc 올림');
  console.assert(activityTitle({ type: 'file_replace', name: 'a.ifc' }) === 'a.ifc 바꿈 · 이전');
  const doneActs = projectActivity(tree[0], [{
    id: 'c1', model_id: 'local-sample-ifc', author: '민수', body: '창호', created_at: '2026-09-02T09:00:00.000Z', status: 'done',
  }], []);
  console.assert(doneActs.some((e) => e.type === 'comment_add' && e.author === '민수' && e.surface === 'model'));
  console.assert(doneActs.some((e) => e.type === 'comment_done' && e.comment_id === 'c1'));
  const pdfActs = projectActivity(tree[0], [{
    id: 'p1', model_id: 'local-sample-ifc', kind: 'pdf', page: 1, body: '치수', created_at: '2026-09-03T09:00:00.000Z',
  }], []);
  console.assert(pdfActs.some((e) => e.type === 'comment_add' && e.surface === 'pdf' && e.comment_id === 'p1'));
  console.assert(activityTitle({ type: 'comment_add', name: '치수', surface: 'pdf' }) === '도면 코멘트 남김 · 치수');
  console.assert(activityTitle({ type: 'comment', name: '치수', surface: 'pdf' }) === '도면 코멘트 남김 · 치수');
  console.assert(activityTitle({ type: 'comment_done', name: '창호', surface: 'model' }) === '모델 코멘트 완료 · 창호');
  console.assert(activityTitle({ type: 'done', name: '창호', surface: 'model' }) === '모델 코멘트 완료 · 창호');
  console.assert(activityAuthor({ owner: '지훈' }, '나') === '지훈');
  console.assert(activityAuthor({}, '') === '이름 없음');
  console.assert(eventKind('comment_add') === 'comment' && eventKind('comment_done') === 'done');
  console.assert(activityKind('comment') === 'comment_add' && activityKind('done') === 'comment_done');
  console.assert(asActivityEvent({ type: 'comment', ref: 'c1', author: '민수', created_at: '2026-09-02T09:00:00.000Z' }).type === 'comment_add');
  console.assert(asActivityEvent({ type: 'done', ref: 'c1', project: SAMPLE_PROJECT }).project === projectKey());
  console.assert(fileEventType('Jeongrim3_3D.ifc', []) === 'file_add');
  console.assert(fileEventType('Jeongrim3_3D.ifc', [{ name: 'Jeongrim3_3D.ifc', kind: 'ifc' }]) === 'file_replace');
  const origin = { x: 0, y: 0, z: 0 };
  const vec = explodeVec(origin, { x: 4, y: -2, z: 6 });
  console.assert(vec.x === 4 && vec.y === -2 && vec.z === 6);
  const assembled = explodePos({ x: 1, y: 2, z: 3 }, vec, 0);
  console.assert(assembled.x === 1 && assembled.y === 2 && assembled.z === 3);
  const blown = explodePos({ x: 1, y: 2, z: 3 }, vec, 1);
  console.assert(blown.x === 5 && blown.y === 0 && blown.z === 9);
  console.assert(verticalExplodeY(10, 2, 3, 0.5) === 13);
  console.assert(verticalExplodeY(10, null, 3, 1) === 10);
  console.assert(clampFov(50) === 50 && clampFov(10) === 20 && clampFov(120) === 90);
  console.assert(clampFov('bad') === 50);
  console.log('format ok');
}
