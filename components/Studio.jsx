'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ViewerEngine } from '@/lib/viewer-engine';
import { kindOf, is3d, isShareableId, sharePath, fmtDate, safeFileName, isPdfName, isImageFile, issueStatus, nextIssueStatus, lectureErr, hashColor, peersFromPresence, isPdfComment, is2dComment, commentSurface, commentWhere, schemaGap, unitPos, ndcFromEvent, ndcToUnit, pageTurn, clampPdfZoom, pageUnitFromRotated, rotatedFromPageUnit, groupProjects, sampleBundle, hlabBundle, mergeLectureModels, mergeLectureDrawings, SAMPLE_PROJECT, HLAB_PROJECT, rowProject, fileKindLabel, lectureFileName, commentHotkeyBlocked, projectKey, projectNameOf, projectActivity, activityTitle, fileEventType, asActivityEvent, eventKind, PROJECTS_KEY, readNamedProjects, addNamedProject, pickProject } from '@/lib/format';
import { paintPdfPage } from '@/lib/pdf-view';
import { supabase, hasSupabase, BUCKET, PHOTO_BUCKET, DRAWING_BUCKET, APP_TITLE, publicUrl } from '@/lib/supabase';

const AUTHOR_KEY = 'viewer-author';
// 좁은 화면(폰)에선 패널이 뷰어를 덮으므로 한 번에 하나만 엽니다
const narrow = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 960px)').matches;
const RIGHT_W_KEY = 'viewer-right-w';
const ACTIVITY_KEY = 'viewer-activity';
const PRESENCE_KEY = 'viewer-presence';
function readActivity() {
  try {
    const raw = JSON.parse(localStorage.getItem(ACTIVITY_KEY) || '[]');
    const rows = Array.isArray(raw) ? raw.filter((e) => e && e.type && e.at) : [];
    const next = rows.filter((e) => String(e.name || '').trim() !== '4');
    if (next.length !== rows.length) {
      try { localStorage.setItem(ACTIVITY_KEY, JSON.stringify(next)); } catch { /* quota */ }
    }
    return next;
  } catch {
    return [];
  }
}
function presenceSelfKey() {
  let id = sessionStorage.getItem(PRESENCE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(PRESENCE_KEY, id);
  }
  return id;
}
function Icon({ children }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

function Btn({ pressed, variant = 'outline', className = '', type = 'button', children, ...rest }) {
  return (
    <button
      type={type}
      className={`btn btn-${variant}${pressed ? ' on' : ''}${className ? ` ${className}` : ''}`}
      aria-pressed={pressed || undefined}
      {...rest}
    >
      {children}
    </button>
  );
}

function Cluster({ label, children }) {
  return (
    <div className="tg" role="group" aria-label={label}>
      <div className="tg-row">{children}</div>
      <span className="tg-lbl">{label}</span>
    </div>
  );
}

function Fly({ label, title, children, panelRef, summary, className = '' }) {
  return (
    <details
      className="tb-pop"
      ref={panelRef}
      onToggle={(e) => {
        if (!e.currentTarget.open) return;
        e.currentTarget.closest('.toolbar')?.querySelectorAll('details.tb-pop[open]').forEach((d) => {
          if (d !== e.currentTarget) d.open = false;
        });
      }}
    >
      <summary className={`btn icon-btn${className ? ` ${className}` : ''}`} title={title} aria-label={label}>{summary}</summary>
      <div className="tb-fly">{children}</div>
    </details>
  );
}

function Slot({ name, children }) {
  return (
    <span className="tb-slot">
      {children}
      <span className="tb-slot-lbl">{name}</span>
    </span>
  );
}

function isFileDrag(e) {
  return !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
}

function blockBrowserFileOpen(e) {
  e.preventDefault();
  e.stopPropagation();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
}

function noteEventsGapMsg(ok, missing, already) {
  return missing && !already ? '활동은 표가 생기면 남아요' : ok;
}

function noteStatusGapMsg(already) {
  return already ? '' : '완료는 supabase.sql을 실행하면 DB에 남아요.';
}

{
  const e = {
    dataTransfer: { types: ['Files'], files: [{ name: 'a.ifc' }], dropEffect: 'none' },
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; },
  };
  blockBrowserFileOpen(e);
  console.assert(e.prevented && e.stopped && e.dataTransfer.dropEffect === 'copy');
  console.assert(noteEventsGapMsg('남겼어요.', true, false) === '활동은 표가 생기면 남아요');
  console.assert(noteEventsGapMsg('남겼어요.', true, true) === '남겼어요.');
  console.assert(noteEventsGapMsg('남겼어요.', false, false) === '남겼어요.');
  console.assert(noteStatusGapMsg(false) === '완료는 supabase.sql을 실행하면 DB에 남아요.');
  console.assert(noteStatusGapMsg(true) === '');
  console.assert(!isShareableId('local-sample-pdf') && !isShareableId('local-sample-ifc'));
}

export default function Studio() {
  const params = useParams();
  const router = useRouter();
  const hostRef = useRef(null);
  const stageRef = useRef(null);
  const engRef = useRef(null);
  const localRef = useRef({ models: [], comments: {}, drawings: {} });
  const currentRef = useRef(null);
  const commentsRef = useRef([]);
  const modeRef = useRef('rendered');
  const openRef = useRef(null);
  const dragN = useRef(0);
  const presenceRef = useRef(null);
  const authorRef = useRef('');
  const cursorRef = useRef(null);
  const pdfRef = useRef(null);
  const pdfCanvasRef = useRef(null);
  const pdfStageRef = useRef(null);
  const rotRef = useRef(0);
  const flipRef = useRef(false);
  const drawingRef = useRef(null);
  const pageRef = useRef(1);
  const modelsRef = useRef([]);
  const drawingsAllRef = useRef([]);
  const photosRef = useRef([]);
  const projectIdsRef = useRef([]);
  const projectMapRef = useRef(new Map());
  const projectsOkRef = useRef(true);
  const commentsSeqRef = useRef(0);
  const osFileDropRef = useRef(null);
  const pendingFocusRef = useRef(null);
  const explodeFly = useRef(null);
  const eventsOkRef = useRef(true);
  const eventsGapNotedRef = useRef(false);
  const statusOkRef = useRef(true);
  const statusGapNotedRef = useRef(false);

  const [ready, setReady] = useState(false);
  const [models, setModels] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [view, setView] = useState(null);
  const [activeId, setActiveId] = useState('');
  const [fold, setFold] = useState({});
  const [backFold, setBackFold] = useState({});
  const [current, setCurrent] = useState(null);
  const [comments, setComments] = useState([]);
  const [pending, setPending] = useState(null);
  const [tool, setTool] = useState('select');
  const [displayMode, setDisplayMode] = useState('rendered');
  const [fov, setFov] = useState(50);
  const [shadows, setShadows] = useState(true);
  const [ambient, setAmbient] = useState(true);
  const [sunAz, setSunAz] = useState(45);
  const [sunAlt, setSunAlt] = useState(50);
  const [storeys, setStoreys] = useState([]);
  const [storey, setStorey] = useState('');
  const [section, setSection] = useState(1);
  const [explode, setExplode] = useState(0);
  const [explodeMode, setExplodeMode] = useState('vertical');
  const [isolated, setIsolated] = useState(false);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [rightW, setRightW] = useState(268); // 코멘트 패널 너비. 왼쪽 가장자리를 끌어 조절
  const [author, setAuthor] = useState('');
  const [extraEvents, setExtraEvents] = useState([]);
  const [body, setBody] = useState('');
  const [uploadStatus, setUploadStatus] = useState('');
  const [uploadErr, setUploadErr] = useState(false);
  const [commentStatus, setCommentStatus] = useState('');
  const [commentErr, setCommentErr] = useState(false);
  const [focusIdx, setFocusIdx] = useState(null);
  const [drawings, setDrawings] = useState([]);
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState(null);
  const [issueFilter, setIssueFilter] = useState('all');
  const [peers, setPeers] = useState([]);
  const [drawing, setDrawing] = useState(null);
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfPages, setPdfPages] = useState(1);
  const [pdfRot, setPdfRot] = useState(0);
  const [pdfZoom, setPdfZoom] = useState(1);
  const [pdfFlip, setPdfFlip] = useState(false);
  const [pdfErr, setPdfErr] = useState('');
  const [activeKey, setActiveKey] = useState(() => projectKey(SAMPLE_PROJECT));
  const [namedProjects, setNamedProjects] = useState([]);
  const [newName, setNewName] = useState('');
  const namedRef = useRef([]);
  const activeKeyRef = useRef(activeKey);
  authorRef.current = author;
  namedRef.current = namedProjects;
  activeKeyRef.current = activeKey;
  drawingRef.current = drawing;
  pageRef.current = pdfPage;
  rotRef.current = pdfRot;
  flipRef.current = pdfFlip;
  modelsRef.current = models;
  drawingsAllRef.current = drawings;
  photosRef.current = photos;

  const projects = groupProjects(models, drawings, namedProjects);
  const project = pickProject(projects, activeKey);
  const threeD = view ? is3d(view.kind) : false;

  function treeOf(list, draws) {
    return groupProjects(list || modelsRef.current, draws || drawingsAllRef.current, namedRef.current);
  }

  useEffect(() => {
    setAuthor(localStorage.getItem(AUTHOR_KEY) || '');
    if (narrow()) setRightOpen(false);
    const w = Number(localStorage.getItem(RIGHT_W_KEY));
    if (w >= 220 && w <= 720) setRightW(w);
    setExtraEvents(readActivity());
    loadProjects();
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const eng = new ViewerEngine(host, {
      onSelect: (sel) => setSelected(sel),
      onPin: (p) => {
        setPending(p);
        if (p) {
          setRightOpen(true);
          if (narrow()) setLeftOpen(false);
        }
      },
      onStoreys: (names) => {
        setStoreys(names);
        setStorey('');
      },
      onTool: (t) => setTool(t),
      onFocusComment: (i) => {
        const c = commentsRef.current[i];
        if (!c) return;
        setFocusIdx(i);
        eng.focusComment(c);
      },
      onVisibility: (v) => {
        setIsolated(v.isolated);
        setHiddenCount(v.hidden);
      },
    });
    eng.mount();
    engRef.current = eng;
    setReady(true);
    return () => {
      eng.dispose();
      engRef.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    const over = (e) => {
      if (!isFileDrag(e)) return;
      blockBrowserFileOpen(e);
    };
    const drop = (e) => osFileDropRef.current?.(e);
    window.addEventListener('dragover', over, true);
    window.addEventListener('drop', drop, true);
    return () => {
      window.removeEventListener('dragover', over, true);
      window.removeEventListener('drop', drop, true);
    };
  }, []);

  useEffect(() => {
    engRef.current?.setPins(comments, pending);
  }, [comments, pending]);

  useEffect(() => {
    if (focusIdx == null) return;
    document.querySelector(`[data-comment="${focusIdx}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [focusIdx]);

  useEffect(() => {
    if (!hasSupabase || !supabase) return;
    const ch = supabase
      .channel('review')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, (payload) => {
        const row = payload.new || payload.old || {};
        const pid = activeProjectId();
        if ((pid && row.project_id === pid) || projectIdsRef.current.includes(row.model_id)) loadComments(projectIdsRef.current);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, () => {
        loadProjects();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'drawings' }, (payload) => {
        if (modelsRef.current.some((m) => m.id === payload.new?.model_id)) loadAllDrawings(modelsRef.current);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'events' }, () => {
        loadEvents();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  useEffect(() => {
    if (!hasSupabase || !supabase || !current?.id) {
      setPeers([]);
      return;
    }
    const selfKey = presenceSelfKey();
    const ch = supabase.channel(`presence:model:${current.id}`, {
      config: { presence: { key: selfKey }, broadcast: { self: false } },
    });
    presenceRef.current = ch;
    const payload = () => {
      const name = authorRef.current.trim();
      const d = drawingRef.current;
      return {
        name,
        color: hashColor(name || selfKey),
        surface: d ? 'pdf' : 'model',
        drawing_id: d?.id || '',
        page: pageRef.current,
        ...cursorRef.current,
      };
    };
    const sync = () => {
      const state = ch.presenceState();
      const live = peersFromPresence(state, selfKey);
      const keys = new Set(Object.keys(state).filter((k) => k !== selfKey));
      setPeers((prev) => {
        const seen = new Set(live.map((p) => p.key));
        return [...live, ...prev.filter((p) => keys.has(p.key) && !seen.has(p.key))];
      });
    };
    const stage = stageRef.current;
    ch.on('presence', { event: 'sync' }, sync)
      .on('broadcast', { event: 'cursor' }, ({ payload: msg }) => {
        const row = peersFromPresence({ [msg?.key]: [msg] }, selfKey)[0];
        if (!row) return;
        setPeers((prev) => [...prev.filter((p) => p.key !== row.key), row]);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') ch.track(payload());
      });
    let last = 0;
    let timer = 0;
    const flush = () => {
      timer = 0;
      last = Date.now();
      if (!cursorRef.current) return;
      ch.send({ type: 'broadcast', event: 'cursor', payload: { key: selfKey, ...payload() } });
    };
    const onMove = (e) => {
      const el = drawingRef.current ? pdfRef.current : stage;
      if (!el) return;
      cursorRef.current = ndcToUnit(ndcFromEvent(e, el));
      const wait = 50 - (Date.now() - last);
      if (wait <= 0) flush();
      else if (!timer) timer = setTimeout(flush, wait);
    };
    stage?.addEventListener('pointermove', onMove);
    return () => {
      clearTimeout(timer);
      stage?.removeEventListener('pointermove', onMove);
      cursorRef.current = null;
      ch.untrack();
      supabase.removeChannel(ch);
      if (presenceRef.current === ch) presenceRef.current = null;
      setPeers([]);
    };
  }, [current?.id]);

  useEffect(() => {
    const ch = presenceRef.current;
    if (!ch) return;
    const name = author.trim();
    const selfKey = sessionStorage.getItem(PRESENCE_KEY) || name;
    const d = drawing;
    ch.track({
      name,
      color: hashColor(name || selfKey),
      surface: d ? 'pdf' : 'model',
      drawing_id: d?.id || '',
      page: pdfPage,
      ...cursorRef.current,
    });
  }, [author, drawing?.id, pdfPage]);

  useEffect(() => {
    const url = drawing?.url;
    const canvas = pdfCanvasRef.current;
    const stage = pdfStageRef.current;
    if (!url || !canvas || !stage) return;
    let dead = false;
    const paint = async () => {
      const box = stage.getBoundingClientRect();
      if (box.width < 8 || box.height < 8) return;
      const keep = {
        x: (stage.scrollLeft + stage.clientWidth / 2) / Math.max(1, stage.scrollWidth),
        y: (stage.scrollTop + stage.clientHeight / 2) / Math.max(1, stage.scrollHeight),
      };
      try {
        const info = await paintPdfPage(canvas, url, pdfPage, pdfRot, box.width - 48, box.height - 48, pdfZoom);
        if (dead || !info) return;
        setPdfPages(info.pages);
        setPdfErr('');
        stage.scrollLeft = keep.x * stage.scrollWidth - stage.clientWidth / 2;
        stage.scrollTop = keep.y * stage.scrollHeight - stage.clientHeight / 2;
      } catch (err) {
        if (dead || err?.name === 'RenderingCancelledException') return;
        console.error(err);
        setPdfErr('이 파일은 열 수 없어요.');
      }
    };
    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(stage);
    return () => {
      dead = true;
      ro.disconnect();
    };
  }, [drawing?.url, pdfPage, pdfRot, pdfZoom]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (preview) setPreview(null);
        else if (drawing && !pending) closeDrawing();
        return;
      }
      if (e.code !== 'Slash') return;
      if (commentHotkeyBlocked(e.target)) return;
      e.preventDefault();
      const d = drawingRef.current;
      if (d) {
        const shown = unitPos(cursorRef.current);
        const pos = unitPos(pageUnitFromRotated(shown.x, shown.y, rotRef.current, flipRef.current));
        setPending({ kind: 'pdf', x: pos.x, y: pos.y, page: pageRef.current, drawing_id: d.id });
        setRightOpen(true);
        return;
      }
      engRef.current?.commentAtPointer();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview, drawing, pending]);

  function seedLocal() {
    if (localRef.current.seeded) return localRef.current.models;
    localRef.current.seeded = true;
    const a = sampleBundle();
    const b = hlabBundle();
    localRef.current.models = [...a.models, ...b.models];
    for (const d of [...a.drawings, ...b.drawings]) (localRef.current.drawings[d.model_id] ||= []).push(d);
    return localRef.current.models;
  }

  function allLocalDrawings() {
    return Object.values(localRef.current.drawings).flat();
  }

  function photosFromComments(list) {
    return (list || []).filter((c) => c.photo_path || c.photo_url).map((c) => ({
      id: `photo-${c.id}`,
      model_id: c.model_id,
      name: c.body || '사진',
      kind: 'photo',
      created_at: c.created_at,
      url: c.photo_url || publicUrl(c.photo_path, PHOTO_BUCKET),
      path: c.photo_path,
      photo_path: c.photo_path,
      body: c.body,
    }));
  }

  // 프로젝트는 projects 표가 기준입니다. 표가 없으면(옛 스키마) 이 브라우저에만 남깁니다.
  async function loadProjects() {
    const fromLocal = () => setNamedProjects(readNamedProjects(localStorage.getItem(PROJECTS_KEY)));
    if (!hasSupabase || !projectsOkRef.current) {
      fromLocal();
      return;
    }
    const { data, error } = await supabase.from('projects').select('*').order('created_at', { ascending: true });
    if (error) {
      if (schemaGap(error.message)) projectsOkRef.current = false;
      fromLocal();
      return;
    }
    projectMapRef.current = new Map((data || []).map((p) => [p.name, p.id]));
    setNamedProjects((data || []).map((p) => p.name));
  }

  function projectIdOf(name) {
    return projectMapRef.current.get(String(name || '').trim()) || null;
  }

  function activeProjectId() {
    return projectIdOf(projectNameOf(activeKeyRef.current));
  }

  async function ensureProjectId(name) {
    const label = String(name || '').trim();
    if (!label || !hasSupabase || !projectsOkRef.current) return null;
    const known = projectMapRef.current.get(label);
    if (known) return known;
    let { data, error } = await supabase.from('projects').insert({ name: label, owner: authorRef.current?.trim() || null }).select().single();
    if (error && /duplicate|unique|23505/i.test(error.message || '')) {
      ({ data, error } = await supabase.from('projects').select('*').eq('name', label).maybeSingle());
    }
    if (error || !data) {
      if (error && schemaGap(error.message)) projectsOkRef.current = false;
      return null;
    }
    projectMapRef.current.set(label, data.id);
    setNamedProjects((list) => addNamedProject(list, label));
    return data.id;
  }

  async function listModels() {
    const local = seedLocal();
    if (!hasSupabase) return local;
    const { data, error } = await supabase.from('models').select('*').order('created_at', { ascending: false });
    if (error) {
      setUploadErr(true);
      setUploadStatus('목록을 불러오지 못했어요.');
      return local;
    }
    const remote = (data || []).map((r) => ({ ...r, url: publicUrl(r.path) }));
    return mergeLectureModels(remote);
  }

  async function fetchDrawings(ids) {
    const local = mergeLectureDrawings(allLocalDrawings());
    const remoteIds = ids.filter((id) => isShareableId(String(id)));
    if (!hasSupabase || !remoteIds.length) return local;
    const { data, error } = await supabase.from('drawings').select('*').in('model_id', remoteIds).order('created_at', { ascending: false });
    const remote = error || !data ? [] : data.map((r) => ({ ...r, url: publicUrl(r.path, DRAWING_BUCKET) }));
    return mergeLectureDrawings([...remote, ...local.filter((l) => !remote.some((r) => r.id === l.id))]);
  }

  async function fetchPhotos(ids) {
    if (!ids.length) return photosFromComments(Object.values(localRef.current.comments).flat());
    const remoteIds = ids.filter((id) => isShareableId(String(id)));
    if (!hasSupabase || !remoteIds.length) return ids.flatMap((id) => photosFromComments(localRef.current.comments[id] || []));
    const { data, error } = await supabase.from('comments').select('id, model_id, photo_path, created_at, body').in('model_id', remoteIds).not('photo_path', 'is', null);
    if (error || !data) return ids.flatMap((id) => photosFromComments(localRef.current.comments[id] || []));
    return photosFromComments(data);
  }

  async function loadAllDrawings(list) {
    const rows = await fetchDrawings((list || modelsRef.current).map((m) => m.id));
    drawingsAllRef.current = rows;
    setDrawings(rows);
  }

  async function loadComments(modelIds, projectId = activeProjectId()) {
    const seq = ++commentsSeqRef.current;
    const ids = (Array.isArray(modelIds) ? modelIds : [modelIds]).filter(Boolean);
    const remoteIds = ids.filter((id) => isShareableId(String(id)));
    let list = [];
    if (!hasSupabase || (!remoteIds.length && !projectId)) list = ids.flatMap((id) => (localRef.current.comments[id] || []).filter((c) => String(c.body || '').trim() !== '4'));
    else {
      // 이 프로젝트 것만: project_id가 같거나, 이 프로젝트 모델에 달린 코멘트
      let q = supabase.from('comments').select('*');
      if (projectId && remoteIds.length) q = q.or(`project_id.eq.${projectId},model_id.in.(${remoteIds.join(',')})`);
      else if (projectId) q = q.eq('project_id', projectId);
      else q = q.in('model_id', remoteIds);
      let { data, error } = await q.order('created_at', { ascending: true });
      if (error && projectId && remoteIds.length && schemaGap(error.message)) {
        ({ data, error } = await supabase.from('comments').select('*').in('model_id', remoteIds).order('created_at', { ascending: true }));
      }
      list = error || !data ? [] : data;
    }
    // 기다리는 사이 다른 프로젝트를 열었으면 이 결과는 버립니다
    if (seq !== commentsSeqRef.current) return;
    const locals = ids.flatMap((id) => localRef.current.comments[id] || []);
    list = list.map((r) => {
      const loc = locals.find((c) => c.id === r.id);
      if (!loc) return r;
      return { ...r, drawing_id: r.drawing_id || loc.drawing_id, status: loc.status || r.status };
    });
    const extra = locals.filter((c) => !list.some((r) => r.id === c.id) && String(c.body || '').trim() !== '4');
    list = extra.length ? [...list, ...extra] : list;
    for (const id of ids) {
      const rows = localRef.current.comments[id];
      if (rows) localRef.current.comments[id] = rows.filter((c) => String(c.body || '').trim() !== '4');
    }
    commentsRef.current = list;
    setComments(list);
    engRef.current?.setPins(list, pending);
    setPhotos((prev) => {
      const keep = prev.filter((p) => !ids.includes(p.model_id));
      const next = [...keep, ...photosFromComments(list)];
      photosRef.current = next;
      return next;
    });
  }

  function clearComments() {
    commentsSeqRef.current += 1;
    commentsRef.current = [];
    setComments([]);
    setFocusIdx(null);
    engRef.current?.setPins([], null);
  }

  function commentPhotoUrl(c) {
    if (c.photo_url) return c.photo_url;
    if (c.photo_path) return publicUrl(c.photo_path, PHOTO_BUCKET);
    return '';
  }

  function openDrawing(d, page = 1, pin = true) {
    if (!d) return;
    setDrawing(d);
    setPdfPage(page);
    setPdfPages(1);
    setPdfRot(0);
    setPdfZoom(1);
    setPdfFlip(false);
    setPdfErr('');
    setPreview(null);
    if (pin) setPending(null);
  }

  function closeDrawing() {
    setDrawing(null);
    setPending((p) => (p?.kind === 'pdf' ? null : p));
    setActiveId(view?.id || current?.id || '');
    engRef.current?.setTool('select');
  }

  function focusMark(c, i) {
    setFocusIdx(i);
    setRightOpen(true);
    if (isPdfComment(c)) {
      const id = String(c.drawing_id || '');
      const d = drawingsAllRef.current.find((x) => String(x.id) === id)
        || drawings.find((x) => String(x.id) === id)
        || (String(drawingRef.current?.id) === id ? drawingRef.current : null);
      if (d) openDrawing(d, c.page || 1, false);
      return;
    }
    if (is2dComment(c)) {
      const eng = engRef.current;
      if (eng && (eng.kind === 'dwg' || eng.kind === 'dxf')) {
        setDrawing(null);
        eng.focusComment(c);
        return;
      }
      // 3D가 열려 있으면 이 프로젝트의 2D 파일을 먼저 열고, 열린 뒤에 다시 포커스합니다
      const f = [...(project?.latest || []), ...(project?.back || [])].find((x) => x.kind === 'dwg' || x.kind === 'dxf');
      if (f && project) {
        pendingFocusRef.current = c.id;
        openFile(f, project);
      }
      return;
    }
    setDrawing(null);
    engRef.current?.focusComment(c);
  }

  function applyPendingFocus() {
    const want = pendingFocusRef.current;
    if (!want) return;
    pendingFocusRef.current = null;
    const i = commentsRef.current.findIndex((x) => x.id === want);
    if (i < 0) return;
    setRightOpen(true);
    focusMark(commentsRef.current[i], i);
  }

  function onPdfPointerUp(e) {
    if (e.button !== 0 || !drawing || !pdfRef.current) return;
    const shown = ndcToUnit(ndcFromEvent(e, pdfRef.current));
    const pos = unitPos(pageUnitFromRotated(shown.x, shown.y, rotRef.current, flipRef.current));
    cursorRef.current = shown;
    setPending({ kind: 'pdf', x: pos.x, y: pos.y, page: pdfPage, drawing_id: drawing.id });
    setRightOpen(true);
  }

  async function openFile(file, project) {
    if (!file || !project) return;
    const pdf = file.role === 'pdf' || file.kind === 'pdf' || isPdfName(file.name);
    const eng = engRef.current;
    if (!pdf && !eng) return;
    const head = project.head;
    const same = currentRef.current && head && currentRef.current.id === head.id && activeKeyRef.current === project.key;
    currentRef.current = head;
    projectIdsRef.current = project.models.map((m) => m.id);
    if (!same) {
      clearComments();
      setCurrent(head);
      setPending(null);
      setSelected(null);
      setFocusIdx(null);
      setSection(1);
      setExplode(0);
      setExplodeMode('vertical');
      setCommentStatus('');
      setCommentErr(false);
      setPhoto(null);
      setPreview(null);
      setIssueFilter('all');
      setView(null);
      setDrawing(null);
      setPdfPage(1);
      setPdfPages(1);
      setActiveKey(project.key);
      activeKeyRef.current = project.key;
      await loadComments(projectIdsRef.current);
    }
    setActiveId(file.id);
    setActiveKey(project.key);
    activeKeyRef.current = project.key;
    setFold((s) => ({ ...s, [project.key]: true }));
    if (narrow()) setLeftOpen(false);
    if (pdf) {
      const dest = file.source || file;
      const want = pendingFocusRef.current;
      const marked = want && commentsRef.current.find((x) => x.id === want);
      if (isPdfComment(marked) && String(marked.drawing_id) === String(dest.id)) {
        openDrawing(dest, marked.page || 1, false);
        applyPendingFocus();
      } else {
        openDrawing(dest, 1, true);
      }
      return;
    }
    if (file.role === 'photo') {
      const url = file.url || (file.path ? publicUrl(file.path, PHOTO_BUCKET) : '');
      if (url) setPreview({ kind: 'photo', url, name: file.name });
      return;
    }
    setDrawing(null);
    setPending((p) => (p?.kind === 'pdf' ? null : p));
    setLoading(true);
    try {
      const model = file.source || file;
      setView(model);
      await eng.open(model);
      eng.applySection(1);
      setExplode(0);
      setExplodeMode('vertical');
      eng.applyExplode(0, 'vertical');
      eng.setDisplayMode(modeRef.current);
      if (isShareableId(String(model.id))) router.prefetch(sharePath(model.id));
      applyPendingFocus();
    } catch (err) {
      console.error(err);
      setUploadErr(true);
      setUploadStatus('이 파일은 열 수 없어요.');
    } finally {
      setLoading(false);
    }
  }

  async function openProject(p) {
    if (!p) return;
    const ifc = (p.latest || []).find((f) => f.kind === 'ifc')
      || (p.back || []).find((f) => f.kind === 'ifc');
    if (ifc) {
      await openFile(ifc, p);
      return;
    }
    setActiveKey(p.key);
    activeKeyRef.current = p.key;
    const head = p.head;
    currentRef.current = head || null;
    projectIdsRef.current = (p.models || []).map((m) => m.id);
    clearComments();
    setCurrent(head || null);
    setPending(null);
    setSelected(null);
    setFocusIdx(null);
    setSection(1);
    setExplode(0);
    setExplodeMode('vertical');
    setCommentStatus('');
    setCommentErr(false);
    setPhoto(null);
    setPreview(null);
    setIssueFilter('all');
    setView(null);
    setDrawing(null);
    setPdfPage(1);
    setPdfPages(1);
    setActiveId('');
    engRef.current?.clearThree?.();
    engRef.current?.hideDxf?.();
    engRef.current?.hideSvg?.();
    await loadComments(projectIdsRef.current);
  }

  async function openByModel(model, list = modelsRef.current, draws = drawingsAllRef.current) {
    const tree = treeOf(list, draws);
    const next = tree.find((p) => p.models.some((m) => m.id === model.id));
    if (!next) return;
    setActiveKey(next.key);
    activeKeyRef.current = next.key;
    const file = [...next.latest, ...next.back].find((f) => f.id === model.id && f.role === 'model')
      || { id: model.id, name: model.name, kind: model.kind, role: 'model', created_at: model.created_at, source: model };
    await openFile(file, next);
  }
  openRef.current = openByModel;

  useEffect(() => {
    if (!ready) return;
    let dead = false;
    (async () => {
      const list = await listModels();
      const draws = await fetchDrawings(list.map((m) => m.id));
      const ph = await fetchPhotos(list.map((m) => m.id));
      if (dead) return;
      modelsRef.current = list;
      drawingsAllRef.current = draws;
      photosRef.current = ph;
      setModels(list);
      setDrawings(draws);
      setPhotos(ph);
      setFold((s) => (Object.keys(s).length ? s : Object.fromEntries(treeOf(list, draws).map((p) => [p.key, true]))));
      await loadEvents();
      const id = params?.id;
      if (!id || currentRef.current?.id === id) return;
      let m = list.find((x) => String(x.id) === String(id));
      if (!m && hasSupabase) {
        const { data } = await supabase.from('models').select('*').eq('id', id).maybeSingle();
        if (data) m = { ...data, url: publicUrl(data.path) };
      }
      if (dead) return;
      if (!m) {
        setUploadErr(true);
        setUploadStatus('모델을 찾을 수 없어요.');
        return;
      }
      await openRef.current(m, list, draws);
    })();
    return () => {
      dead = true;
    };
  }, [ready, params?.id]);

  function projectForUpload() {
    return projectNameOf(activeKeyRef.current);
  }

  function ensurePdfHost() {
    seedLocal();
    const list = modelsRef.current.length ? modelsRef.current : mergeLectureModels([]);
    if (list !== modelsRef.current) {
      modelsRef.current = list;
      setModels(list);
    }
    const draws = mergeLectureDrawings(drawingsAllRef.current);
    drawingsAllRef.current = draws;
    setDrawings(draws);
    let next = pickProject(treeOf(list, draws), activeKeyRef.current);
    if (!next?.head) {
      const label = projectForUpload();
      const m = {
        id: `local-${Date.now()}`,
        name: label,
        kind: 'glb',
        owner: author.trim(),
        project: label,
        created_at: new Date().toISOString(),
        url: '',
      };
      localRef.current.models.unshift(m);
      modelsRef.current = [m, ...modelsRef.current.filter((row) => row.id !== m.id)];
      setModels(modelsRef.current);
      next = pickProject(treeOf(modelsRef.current, draws), activeKeyRef.current);
    }
    const head = next?.head;
    if (!head) return null;
    currentRef.current = head;
    projectIdsRef.current = next.models.map((m) => m.id);
    setCurrent(head);
    setActiveKey(next.key);
    setFold((s) => ({ ...s, [next.key]: true }));
    return head;
  }

  async function handleFile(file) {
    setUploadErr(false);
    if (isPdfName(file.name)) {
      if (!ensurePdfHost()) {
        setUploadErr(true);
        setUploadStatus('프로젝트를 연 다음 PDF를 올려요.');
        return;
      }
      await handlePdf(file);
      return;
    }
    const kind = kindOf(file.name);
    if (!kind) {
      setUploadErr(true);
      setUploadStatus('IFC, DWG, DXF, GLB, DAE, 3DM, PDF만 열 수 있어요.');
      return;
    }
    const project = projectForUpload();
    const fileType = fileEventType(file.name, currentFiles());
    if (!hasSupabase) {
      const m = { id: `local-${Date.now()}`, name: file.name, kind, owner: author.trim(), project, created_at: new Date().toISOString(), file };
      localRef.current.models.unshift(m);
      modelsRef.current = [...localRef.current.models];
      setModels(modelsRef.current);
      setUploadStatus('이 브라우저에만 열려요.');
      await writeEvent({ type: fileType, model_id: m.id, file_id: m.id, ref: m.id, author: author.trim(), name: file.name });
      await openByModel(m);
      return;
    }
    setUploadStatus('올리는 중…');
    const path = `${Date.now()}_${safeFileName(file.name)}`;
    const up = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
    if (up.error) {
      setUploadErr(true);
      setUploadStatus(lectureErr(up.error.message));
      return;
    }
    const project_id = await ensureProjectId(project);
    if (current && !current.project) {
      const tagged = await supabase.from('models').update(project_id ? { project, project_id } : { project }).eq('id', current.id);
      if (!tagged.error) {
        currentRef.current = { ...current, project };
        setCurrent((c) => (c && c.id === current.id ? { ...c, project } : c));
        setModels((list) => list.map((row) => (row.id === current.id ? { ...row, project } : row)));
        modelsRef.current = modelsRef.current.map((row) => (row.id === current.id ? { ...row, project } : row));
      }
    }
    let ins = await supabase.from('models').insert({ name: file.name, path, kind, owner: author.trim(), project, ...(project_id ? { project_id } : {}) }).select().single();
    if (ins.error && /project|column|schema cache/i.test(ins.error.message || '')) {
      ins = await supabase.from('models').insert({ name: file.name, path, kind, owner: author.trim() }).select().single();
    }
    if (ins.error) {
      setUploadErr(true);
      setUploadStatus(lectureErr(ins.error.message));
      return;
    }
    const m = { ...ins.data, url: publicUrl(path), project: ins.data.project || project };
    const list = await listModels();
    modelsRef.current = list.length ? list : [m, ...modelsRef.current.filter((row) => row.id !== m.id)];
    if (!modelsRef.current.some((row) => row.id === m.id)) modelsRef.current = [m, ...modelsRef.current];
    setModels(modelsRef.current);
    await writeEvent({ type: fileType, model_id: m.id, file_id: m.id, ref: m.id, author: author.trim(), name: file.name });
    setUploadStatus(noteEventsGap('올렸어요.'));
    await openByModel(m);
  }

  function onFiles(list) {
    const file = list?.[0];
    if (file) handleFile(file);
  }

  function onOsFileOver(e) {
    if (!isFileDrag(e)) return;
    blockBrowserFileOpen(e);
  }

  function onOsFileDrop(e) {
    if (!isFileDrag(e)) return;
    blockBrowserFileOpen(e);
    dragN.current = 0;
    setDragging(false);
    const el = e.target;
    if (el && typeof el.closest === 'function' && el.closest('.composer-photo')) {
      const file = e.dataTransfer.files?.[0];
      if (file && isImageFile(file)) {
        setPhoto(file);
        return;
      }
    }
    onFiles(e.dataTransfer.files);
  }
  osFileDropRef.current = onOsFileDrop;

  function keepLocalComment(row, photoFile) {
    const host = row.model_id || currentRef.current?.id;
    const saved = {
      kind: row.kind || (row.drawing_id ? 'pdf' : 'model'),
      ...row,
      id: row.id || `local-${Date.now()}`,
      model_id: host,
      status: row.status || 'open',
      created_at: row.created_at || new Date().toISOString(),
      photo_url: photoFile ? URL.createObjectURL(photoFile) : (row.photo_url || ''),
    };
    if (host) (localRef.current.comments[host] ||= []).push(saved);
    return saved;
  }

  function patchLocalComment(c, patch) {
    for (const k of Object.keys(localRef.current.comments)) {
      localRef.current.comments[k] = (localRef.current.comments[k] || []).map((row) => (row.id === c.id ? { ...row, ...patch } : row));
    }
  }

  function dropLocalComment(c) {
    for (const k of Object.keys(localRef.current.comments)) {
      localRef.current.comments[k] = (localRef.current.comments[k] || []).filter((row) => row.id !== c.id);
    }
  }

  function codeErr(kind, msg) {
    return /wrong code|28000/i.test(msg || '') ? `${kind} 코드가 틀렸어요.` : lectureErr(msg);
  }

  // 코멘트 수정. 코드 확인은 DB 함수(update_comment)가 합니다. 이 브라우저에만 있는 코멘트는 그냥 고칩니다.
  async function onEditComment(c) {
    const remote = hasSupabase && isShareableId(String(c.id || ''));
    let code = '';
    if (remote) {
      code = window.prompt('수정 코드를 입력하세요.');
      if (code == null) return;
    }
    const body = window.prompt('내용을 고쳐요.', c.body || '');
    if (body == null || !body.trim()) return;
    if (remote) {
      const { error } = await supabase.rpc('update_comment', { p_comment_id: c.id, p_code: code.trim(), p_body: body.trim() });
      if (error) {
        setCommentErr(true);
        setCommentStatus(codeErr('수정', error.message));
        return;
      }
    }
    patchLocalComment(c, { body: body.trim() });
    setCommentErr(false);
    setCommentStatus('고쳤어요.');
    await loadComments(projectIdsRef.current);
  }

  // 코멘트 삭제. 코드 확인은 DB 함수(delete_comment)가 합니다.
  async function onDeleteComment(c) {
    const remote = hasSupabase && isShareableId(String(c.id || ''));
    if (remote) {
      const code = window.prompt('이 코멘트를 지웁니다. 삭제 코드를 입력하세요.');
      if (code == null) return;
      const { error } = await supabase.rpc('delete_comment', { p_comment_id: c.id, p_code: code.trim() });
      if (error) {
        setCommentErr(true);
        setCommentStatus(codeErr('삭제', error.message));
        return;
      }
    } else if (!window.confirm('이 코멘트를 지울까요?')) {
      return;
    }
    dropLocalComment(c);
    if (pending && pending.id === c.id) setPending(null);
    setCommentErr(false);
    setCommentStatus('지웠어요.');
    await loadComments(projectIdsRef.current);
    await loadEvents();
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (!current || saving || !body.trim()) return;
    if (photo && !isImageFile(photo)) {
      setCommentErr(true);
      setCommentStatus('이미지 파일만 붙일 수 있어요.');
      return;
    }
    const pdfPin = pending?.kind === 'pdf';
    const dwgPin = !pdfPin && pending != null && pending.x != null && pending.z == null; // DWG/DXF 위 핀
    const row = {
      author: author.trim(),
      body: body.trim(),
      pos_x: pending?.x ?? null,
      pos_y: pending?.y ?? null,
      pos_z: pdfPin || dwgPin ? null : pending?.z ?? null,
      element_id: pdfPin || dwgPin ? null : pending?.element_id ?? null,
      element_name: pdfPin || dwgPin ? null : pending?.element_name ?? null,
      ...(pdfPin ? { kind: 'pdf', drawing_id: pending.drawing_id, page: pending.page || 1 } : dwgPin ? { kind: 'dwg' } : {}),
    };
    setSaving(true);
    setCommentErr(false);
    const finishLocal = async (msg, err = false) => {
      const saved = keepLocalComment({ ...row, model_id: current.id }, photo);
      await writeEvent({ type: 'comment', model_id: current.id, comment_id: saved.id, ref: saved.id, author: saved.author, name: saved.body, surface: commentSurface(saved) });
      setBody('');
      setPhoto(null);
      setPending(null);
      setCommentErr(err);
      setCommentStatus(msg);
      await loadComments(projectIdsRef.current);
    };
    const failDb = (msg) => {
      setCommentErr(true);
      setCommentStatus(lectureErr(msg));
    };
    try {
      if (!hasSupabase) {
        await finishLocal(photo ? '이 브라우저에만 남아요. 사진은 공유되지 않아요.' : '이 브라우저에만 남아요.');
        return;
      }
      if (!isShareableId(String(current.id))) {
        await finishLocal(photo ? '이 브라우저에만 남아요. 사진은 공유되지 않아요.' : '이 브라우저에만 남아요.');
        return;
      }
      const payload = { model_id: current.id, ...row };
      const pid = current.project_id || activeProjectId();
      if (pid) payload.project_id = pid;
      if (pdfPin && !isShareableId(String(payload.drawing_id || ''))) delete payload.drawing_id;
      if (photo) {
        const path = `${current.id}/${Date.now()}_${safeFileName(photo.name)}`;
        const up = await supabase.storage.from(PHOTO_BUCKET).upload(path, photo, { upsert: false });
        if (up.error) {
          failDb(up.error.message);
          return;
        }
        payload.photo_path = path;
      }
      let { data, error } = await supabase.from('comments').insert(payload).select().single();
      if (error && payload.project_id && schemaGap(error.message)) {
        delete payload.project_id;
        ({ data, error } = await supabase.from('comments').insert(payload).select().single());
      }
      if (error) {
        failDb(error.message);
        return;
      }
      if (pdfPin && pending.drawing_id && !data.drawing_id) keepLocalComment({ ...data, drawing_id: pending.drawing_id, kind: 'pdf' });
      await writeEvent({ type: 'comment', model_id: current.id, comment_id: data.id, ref: data.id, author: data.author, name: data.body, surface: commentSurface(data) });
      setBody('');
      setPhoto(null);
      setPending(null);
      setCommentStatus(noteEventsGap('남겼어요.'));
      await loadComments(projectIdsRef.current);
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(c) {
    const prev = issueStatus(c);
    const next = nextIssueStatus(prev);
    const same = (row) => row === c || (c.id != null && row.id === c.id);
    const patch = (list, status) => (list || []).map((row) => (same(row) ? { ...row, status } : row));
    const apply = (status) => {
      for (const id of Object.keys(localRef.current.comments)) {
        localRef.current.comments[id] = patch(localRef.current.comments[id], status);
      }
      const host = c.model_id;
      if (host && !(localRef.current.comments[host] || []).some(same)) {
        (localRef.current.comments[host] ||= []).push({ ...c, status });
      }
      commentsRef.current = patch(commentsRef.current, status);
      setComments(commentsRef.current);
      engRef.current?.setPins(commentsRef.current, pending);
    };
    apply(next);
    if (hasSupabase && isShareableId(String(c.id || '')) && statusOkRef.current) {
      const { error } = await supabase.from('comments').update({ status: next }).eq('id', c.id);
      if (error) {
        if (error.code === 'PGRST204' || error.code === '42501' || error.code === 'PGRST301' || schemaGap(error.message)) statusOkRef.current = false;
        else {
          apply(prev);
          setCommentErr(true);
          setCommentStatus(lectureErr(error.message));
          return;
        }
      }
    }
    if (next === 'done') {
      await writeEvent({
        type: 'done',
        at: new Date().toISOString(),
        author: author.trim() || c.author || '이름 없음',
        comment_id: c.id,
        ref: c.id,
        name: c.body,
        model_id: c.model_id,
        surface: commentSurface(c),
      });
      if (statusOkRef.current) {
        const note = noteEventsGap('');
        if (note) setCommentStatus(note);
      }
    }
    if (!statusOkRef.current) {
      const hint = noteStatusGapMsg(statusGapNotedRef.current);
      if (hint) {
        statusGapNotedRef.current = true;
        setCommentErr(false);
        setCommentStatus(hint);
      }
    }
  }

  function currentFiles() {
    const p = pickProject(treeOf(), activeKeyRef.current);
    return p ? [...p.latest, ...p.back] : [];
  }

  function rememberActivity(ev) {
    const row = asActivityEvent({ ...ev, created_at: ev.at || new Date().toISOString() });
    setExtraEvents((list) => {
      const next = [row, ...list.filter((e) => e.id !== row.id)].slice(0, 200);
      try { localStorage.setItem(ACTIVITY_KEY, JSON.stringify(next)); } catch { /* quota */ }
      return next;
    });
  }

  async function loadEvents() {
    if (!hasSupabase || !eventsOkRef.current) return;
    const { data, error } = await supabase.from('events').select('*').order('created_at', { ascending: false }).limit(200);
    if (error) {
      if (schemaGap(error.message)) eventsOkRef.current = false;
      return;
    }
    setExtraEvents((local) => {
      const remote = (data || []).map((row) => asActivityEvent(row));
      const keyOf = (e) => `${e.type}:${e.file_id || e.comment_id || e.id}`;
      const map = new Map();
      for (const e of local) map.set(keyOf(e), e);
      for (const e of remote) {
        const prev = map.get(keyOf(e));
        map.set(keyOf(e), prev ? { ...e, name: e.name || prev.name, file: e.file || prev.file, comment: e.comment || prev.comment } : e);
      }
      const next = [...map.values()].sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0)).slice(0, 200);
      try { localStorage.setItem(ACTIVITY_KEY, JSON.stringify(next)); } catch { /* quota */ }
      return next;
    });
  }

  function noteEventsGap(ok) {
    const msg = noteEventsGapMsg(ok, !eventsOkRef.current, eventsGapNotedRef.current);
    if (msg !== ok) eventsGapNotedRef.current = true;
    return msg;
  }

  async function writeEvent(ev) {
    const at = ev.at || new Date().toISOString();
    rememberActivity({ ...ev, at, project: ev.project || projectKey(activeKeyRef.current) });
    if (!hasSupabase || !eventsOkRef.current) return true;
    const { error } = await supabase.from('events').insert({
      project: projectNameOf(activeKeyRef.current),
      model_id: ev.model_id && isShareableId(String(ev.model_id)) ? ev.model_id : null,
      type: eventKind(ev.type),
      author: ev.author || author.trim() || '이름 없음',
      ref: String(ev.ref || ev.file_id || ev.comment_id || ''),
    });
    if (!error) return true;
    if (schemaGap(error.message)) {
      eventsOkRef.current = false;
      return true;
    }
    return false;
  }

  function openActivity(ev, project) {
    if (ev.type === 'file_add' || ev.type === 'file_replace') {
      const file = ev.file || [...project.latest, ...project.back].find((f) => f.id === ev.file_id);
      if (file) openFile(file, project);
      return;
    }
    const c = ev.comment || comments.find((x) => x.id === ev.comment_id);
    if (c) {
      const i = comments.findIndex((x) => x.id === c.id);
      if (i >= 0) {
        setRightOpen(true);
        focusMark(c, i);
        return;
      }
    }
    pendingFocusRef.current = ev.comment_id || c?.id || null;
    const host = project.models.find((m) => m.id === (ev.comment?.model_id || c?.model_id)) || project.head;
    if (host) openByModel(host);
  }

  function openPdfRow(row) {
    const tree = treeOf();
    const hostId = row.model_id || currentRef.current?.id;
    const project = tree.find((p) => p.models.some((m) => m.id === hostId))
      || tree.find((p) => p.head?.id === currentRef.current?.id)
      || pickProject(tree, activeKeyRef.current)
      || tree[0];
    const file = project && [...project.latest, ...project.back].find((f) => f.id === row.id);
    if (project && file) openFile(file, project);
    else if (row.url) openDrawing(row);
  }

  function keepLocalDrawing(file, msg, err = false) {
    const host = currentRef.current;
    if (!host) return;
    const fileType = fileEventType(file.name, currentFiles());
    const url = URL.createObjectURL(file);
    const row = { id: `local-${Date.now()}`, name: file.name, url, created_at: new Date().toISOString(), model_id: host.id, owner: author.trim() };
    (localRef.current.drawings[host.id] ||= []).unshift(row);
    const next = mergeLectureDrawings([row, ...drawingsAllRef.current.filter((d) => d.id !== row.id)]);
    drawingsAllRef.current = next;
    setDrawings(next);
    setUploadErr(err);
    setUploadStatus(msg);
    writeEvent({ type: fileType, model_id: host.id, file_id: row.id, ref: row.id, author: author.trim(), name: file.name });
    openPdfRow(row);
  }

  async function handlePdf(file) {
    const host = currentRef.current || ensurePdfHost();
    if (!host) return;
    setUploadErr(false);
    if (!isPdfName(file.name)) {
      setUploadErr(true);
      setUploadStatus('PDF만 올릴 수 있어요.');
      return;
    }
    const fileType = fileEventType(file.name, currentFiles());
    if (!hasSupabase) {
      keepLocalDrawing(file, '이 브라우저에만 열려요. 공유되지 않아요.');
      return;
    }
    if (!isShareableId(String(host.id))) {
      keepLocalDrawing(file, '이 브라우저에만 열려요. 공유되지 않아요.');
      return;
    }
    setUploadStatus('올리는 중…');
    const path = `${host.id}/${Date.now()}_${safeFileName(file.name)}`;
    const up = await supabase.storage.from(DRAWING_BUCKET).upload(path, file, { contentType: file.type || 'application/pdf', upsert: false });
    if (up.error) {
      setUploadErr(true);
      setUploadStatus(lectureErr(up.error.message));
      return;
    }
    const ins = await supabase.from('drawings').insert({ model_id: host.id, name: file.name, path }).select().single();
    if (ins.error) {
      setUploadErr(true);
      setUploadStatus(lectureErr(ins.error.message));
      return;
    }
    const row = { ...ins.data, url: publicUrl(path, DRAWING_BUCKET) };
    await writeEvent({ type: fileType, model_id: host.id, file_id: row.id, ref: row.id, author: author.trim(), name: file.name });
    setUploadStatus(noteEventsGap('도면을 올렸어요.'));
    await loadAllDrawings(modelsRef.current);
    openPdfRow(row);
  }

  function applyMode(mode) {
    modeRef.current = mode;
    setDisplayMode(mode);
    engRef.current?.setDisplayMode(mode);
  }

  function pickExplode(mode) {
    setExplodeMode(mode);
    engRef.current?.applyExplode(explode, mode);
    if (explodeFly.current) explodeFly.current.open = true;
  }

  async function share() {
    if (!current || !isShareableId(current.id)) return;
    const url = `${location.origin}${sharePath(current.id)}`;
    await navigator.clipboard.writeText(url);
    setCommentErr(false);
    setCommentStatus('링크를 복사했어요.');
  }

  function onAuthor(v) {
    setAuthor(v);
    localStorage.setItem(AUTHOR_KEY, v);
  }

  function onPickProject(key) {
    const next = pickProject(projects, key);
    if (next) openProject(next);
  }

  async function onCreateProject(e) {
    e.preventDefault();
    const label = String(newName || '').trim();
    if (!label) return;
    const next = addNamedProject(namedProjects, label);
    setNamedProjects(next);
    if (hasSupabase && projectsOkRef.current) {
      const id = await ensureProjectId(label);
      if (!id) {
        setUploadErr(true);
        setUploadStatus('프로젝트를 저장하지 못했어요.');
      }
    } else {
      try { localStorage.setItem(PROJECTS_KEY, JSON.stringify(next)); } catch { /* quota */ }
    }
    setNewName('');
    setActiveKey(projectKey(label));
    activeKeyRef.current = projectKey(label);
    currentRef.current = null;
    projectIdsRef.current = [];
    setCurrent(null);
    setView(null);
    setDrawing(null);
    setActiveId('');
    clearComments();
  }

  function onRightResizeStart(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = rightW;
    const onMove = (ev) => {
      const w = Math.max(220, Math.min(720, startW + (startX - ev.clientX)));
      setRightW(w);
    };
    const onUp = (ev) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const w = Math.max(220, Math.min(720, startW + (startX - ev.clientX)));
      try { localStorage.setItem(RIGHT_W_KEY, String(w)); } catch { /* quota */ }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function isBuiltinProject(label) {
    return label === SAMPLE_PROJECT || label === HLAB_PROJECT;
  }

  // 프로젝트 삭제. 코드 확인은 DB 함수(delete_project)가 합니다. anon 키로는 표를 직접 못 지웁니다.
  async function onDeleteProject() {
    const p = project;
    if (!p || isBuiltinProject(p.label)) return;
    const pid = projectIdOf(p.label);
    if (hasSupabase && !pid) {
      setUploadErr(true);
      setUploadStatus('이 프로젝트는 표에 없어 지울 수 없어요.');
      return;
    }
    if (hasSupabase) {
      const code = window.prompt(`"${p.label}" 프로젝트를 지웁니다. 모델·도면·코멘트가 함께 지워져요.\n삭제 코드를 입력하세요.`);
      if (code == null) return;
      const { data, error } = await supabase.rpc('delete_project', { p_project_id: pid, p_code: code.trim() });
      if (error) {
        setUploadErr(true);
        setUploadStatus(/wrong code|28000/i.test(error.message || '') ? '삭제 코드가 틀렸어요.' : lectureErr(error.message));
        return;
      }
      projectMapRef.current.delete(p.label);
      const n = Number(data?.models || 0) + Number(data?.drawings || 0);
      setUploadErr(false);
      setUploadStatus(n ? `"${p.label}" 지웠어요. 파일 ${n}개는 Storage에 남아 있어요.` : `"${p.label}" 지웠어요.`);
    } else {
      if (!window.confirm(`"${p.label}" 프로젝트를 이 브라우저에서 지울까요?`)) return;
      const next = namedProjects.filter((name) => name !== p.label);
      setNamedProjects(next);
      try { localStorage.setItem(PROJECTS_KEY, JSON.stringify(next)); } catch { /* quota */ }
      localRef.current.models = localRef.current.models.filter((m) => rowProject(m) !== p.label);
      setUploadErr(false);
      setUploadStatus(`"${p.label}" 지웠어요.`);
    }
    await loadProjects();
    const list = await listModels();
    modelsRef.current = list;
    setModels(list);
    const draws = await fetchDrawings(list.map((m) => m.id));
    drawingsAllRef.current = draws;
    setDrawings(draws);
    const next = pickProject(treeOf(list, draws), SAMPLE_PROJECT);
    if (next) await openProject(next);
    await loadEvents();
  }

  const visibleComments = comments
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => issueFilter === 'done' ? issueStatus(c) === 'done' : issueStatus(c) !== 'done');
  const acts = project ? projectActivity(project, comments, extraEvents, author) : [];
  const modelPeers = peers.filter((p) => p.surface !== 'pdf');
  const pdfPeers = peers.filter((p) => p.surface === 'pdf' && p.drawing_id === String(drawing?.id || '') && p.page === pdfPage);

  return (
    <div
      className={`studio${leftOpen ? ' is-models' : ''}${rightOpen ? ' is-comments' : ''}`}
      style={{ '--right-w': `${rightW}px` }}
      onDragEnter={(e) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        dragN.current += 1;
        setDragging(true);
      }}
      onDragOver={onOsFileOver}
      onDragLeave={(e) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        dragN.current -= 1;
        if (dragN.current <= 0) {
          dragN.current = 0;
          setDragging(false);
        }
      }}
      onDrop={onOsFileDrop}
    >
      <header className="app-bar">
        <p className="app-word">{APP_TITLE}</p>
        <label className="field app-bar-field">
          <span className="vh">프로젝트</span>
          <select value={project?.key || ''} onChange={(e) => onPickProject(e.target.value)} aria-label="프로젝트">
            {projects.map((p) => (
              <option key={p.key} value={p.key}>{p.label}</option>
            ))}
          </select>
        </label>
        <label className="field app-bar-field">
          <span className="vh">이름</span>
          <input value={author} onChange={(e) => onAuthor(e.target.value)} maxLength={20} placeholder="이름" aria-label="이름" />
        </label>
        <p className="app-bar-line">여러 명이 남긴 설계가 DB에 쌓인다</p>
        <p className={`mode${hasSupabase ? '' : ' local'}`}>{hasSupabase ? '연결됨' : '로컬'}</p>
      </header>
      <div className="studio-body">
      <div className="stage" ref={stageRef} onDragOver={onOsFileOver} onDrop={onOsFileDrop}>
        <div ref={hostRef} className="canvas" />
        {drawing && (
          <div className="pdf-stage" ref={pdfStageRef} aria-label="도면">
            {!drawing.url && <p className="empty-kicker">PDF 주소를 찾지 못했어요.</p>}
            {drawing.url && pdfErr && <p className="empty-kicker">{pdfErr}</p>}
            {drawing.url && !pdfErr && (
              <div className="pdf-sheet">
                <canvas ref={pdfCanvasRef} className={`pdf-page-canvas${pdfFlip ? ' is-flip' : ''}`} />
                <div
                  ref={pdfRef}
                  className="pdf-overlay is-pin"
                  onPointerUp={onPdfPointerUp}
                >
              {comments.map((c, i) => {
                if (!isPdfComment(c) || String(c.drawing_id) !== String(drawing.id) || (c.page || 1) !== pdfPage || c.pos_x == null || issueStatus(c) === 'done') return null;
                const mark = rotatedFromPageUnit(c.pos_x, c.pos_y, pdfRot, pdfFlip);
                return (
                  <button
                    key={c.id || i}
                    type="button"
                    className={`pdf-pin${focusIdx === i ? ' on' : ''}`}
                    style={{ '--x': mark.x, '--y': mark.y, '--c': hashColor(c.author || c.id) }}
                    aria-label={`핀 ${i + 1}`}
                    onPointerUp={(e) => {
                      e.stopPropagation();
                      focusMark(c, i);
                    }}
                  >
                    {i + 1}
                  </button>
                );
              })}
              {pending?.kind === 'pdf' && pending.page === pdfPage && (() => {
                const mark = rotatedFromPageUnit(pending.x, pending.y, pdfRot, pdfFlip);
                return <span className="pdf-pin pending" style={{ '--x': mark.x, '--y': mark.y, '--c': '#1c1c21' }}>+</span>;
              })()}
              {pdfPeers.length > 0 && (
                <div className="presence" aria-hidden="true">
                  {pdfPeers.map((p) => (
                    <div key={p.key} className="presence-cursor" style={{ '--x': p.x, '--y': p.y, '--c': p.color }}>
                      <svg viewBox="0 0 16 20" width="16" height="20">
                        <path fill="currentColor" stroke="#fff" strokeWidth="1.1" strokeLinejoin="round" d="M1.2 1.2l.2 16.2 4.2-4.6 3.2 7.2 2.2-1-3.2-7.1 5.8-.6z" />
                      </svg>
                      {p.name ? <span className="presence-chip">{p.name}</span> : null}
                    </div>
                  ))}
                </div>
              )}
                </div>
              </div>
            )}
          </div>
        )}
        {!drawing && modelPeers.length > 0 && (
          <div className="presence" aria-hidden="true">
            {modelPeers.map((p) => (
              <div key={p.key} className="presence-cursor" style={{ '--x': p.x, '--y': p.y, '--c': p.color }}>
                <svg viewBox="0 0 16 20" width="16" height="20">
                  <path fill="currentColor" stroke="#fff" strokeWidth="1.1" strokeLinejoin="round" d="M1.2 1.2l.2 16.2 4.2-4.6 3.2 7.2 2.2-1-3.2-7.1 5.8-.6z" />
                </svg>
                {p.name ? <span className="presence-chip">{p.name}</span> : null}
              </div>
            ))}
          </div>
        )}
        {!current && !loading && (
          <div className="empty">
            <p>모델 없음</p>
          </div>
        )}
        {loading && (
          <div className="loading" role="status">
            <span className="spin" />
            <p>불러오는 중</p>
          </div>
        )}
        {tool === 'placeWalk' && !drawing && (
          <p className="hint-bar" role="status">모델을 클릭해 걷기 위치를 정해요. Esc로 취소해요.</p>
        )}
        {tool === 'walk' && !drawing && (
          <p className="hint-bar" role="status">WASD 이동, Q 오르기 E 내리기, 드래그 시선, 클릭 선택, Shift+클릭 이동, / 코멘트, Esc 종료</p>
        )}
        {drawing && !pending && (
          <p className="hint-bar" role="status">/ 또는 클릭으로 위치를 지정해요</p>
        )}
        {current && (
          <div className="toolbar" role="toolbar" aria-label="뷰어">
            {drawing && (
              <Cluster label="도면">
                <Btn className="icon-btn" disabled={pdfPage <= 1} onClick={() => setPdfPage((p) => Math.max(1, p - 1))} title="이전 쪽" aria-label="이전 쪽">
                  <Icon><path d="M15 6l-6 6 6 6" /></Icon>
                </Btn>
                <span className="pdf-page">{pdfPage}/{pdfPages}</span>
                <Btn className="icon-btn" disabled={pdfPage >= pdfPages} onClick={() => setPdfPage((p) => Math.min(pdfPages, p + 1))} title="다음 쪽" aria-label="다음 쪽">
                  <Icon><path d="M9 6l6 6-6 6" /></Icon>
                </Btn>
                <Btn className="icon-btn" disabled={pdfZoom <= 0.5} onClick={() => setPdfZoom((z) => clampPdfZoom(z - 0.25))} title="축소" aria-label="축소">
                  <Icon><path d="M5 12h14" /></Icon>
                </Btn>
                <span className="pdf-page">{Math.round(pdfZoom * 100)}%</span>
                <Btn className="icon-btn" disabled={pdfZoom >= 3} onClick={() => setPdfZoom((z) => clampPdfZoom(z + 0.25))} title="확대" aria-label="확대">
                  <Icon><path d="M12 5v14M5 12h14" /></Icon>
                </Btn>
                <Btn className="icon-btn" onClick={() => setPdfRot((r) => pageTurn(r - 90))} title="회전" aria-label="회전">
                  <Icon><path d="M4 12a8 8 0 1 0 2.3-5.6" /><path d="M4 4v5h5" /></Icon>
                </Btn>
                <Btn className="icon-btn" pressed={pdfFlip} onClick={() => setPdfFlip((f) => !f)} title="좌우 반전" aria-label="좌우 반전">
                  <Icon><path d="M8 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h3" /><path d="M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3" /><path d="M12 20v2M12 14v2M12 8v2M12 2v2" /></Icon>
                </Btn>
                <Btn onClick={closeDrawing}>닫기</Btn>
              </Cluster>
            )}
            {!drawing && view && (
              <Cluster label="코멘트">
                <Btn
                  className="icon-btn"
                  pressed={tool === 'pin'}
                  onClick={() => engRef.current?.setTool(tool === 'pin' ? 'select' : 'pin')}
                  title="위치 찍기 — 켜고 모델이나 도면을 클릭 (키보드: /)"
                  aria-label="위치 찍기"
                >
                  <Icon><path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z" /><circle cx="12" cy="11" r="2" /></Icon>
                </Btn>
              </Cluster>
            )}
            {!drawing && (
              <Cluster label="카메라">
                <Btn className="icon-btn" onClick={() => engRef.current?.fit()} title="맞춤" aria-label="맞춤">
                  <Icon><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></Icon>
                </Btn>
                {threeD && (
                  <>
                    <Fly
                      className="lens-btn"
                      label="원근"
                      title="원근 — 화각"
                      summary={(
                        <>
                          <Icon><path d="M7 4h10l3 16H4z" /><path d="M9 12h6" /></Icon>
                          <span className="lens-deg">{fov}</span>
                        </>
                      )}
                    >
                      <label className="field-inline" title="화각">
                        <span>화각</span>
                        <input type="range" min="20" max="90" step="1" value={fov} aria-label="원근" onChange={(e) => { const v = Number(e.target.value); setFov(v); engRef.current?.setFov(v); }} />
                        <span className="tb-val">{fov}</span>
                      </label>
                      <Btn onClick={() => { setFov(50); engRef.current?.setFov(50); }}>50</Btn>
                    </Fly>
                    <Btn className="icon-btn" pressed={tool === 'walk' || tool === 'placeWalk'} onClick={() => { const t = engRef.current?.tool; engRef.current?.setTool(t === 'walk' || t === 'placeWalk' ? 'select' : 'placeWalk'); }} title="걷기 위치" aria-label="걷기 위치">
                      <Icon><circle cx="12" cy="5" r="2" /><path d="M8 22l2-8-3-3 1-4 4 3 4-3 1 4-3 3 2 8" /></Icon>
                    </Btn>
                  </>
                )}
              </Cluster>
            )}
            {threeD && !drawing && (
              <Cluster label="표시">
                <Btn className="icon-btn" pressed={displayMode === 'rendered'} onClick={() => applyMode('rendered')} title="렌더" aria-label="렌더">
                  <Icon><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M4 7.5l8 4.5 8-4.5M12 12v9" /></Icon>
                </Btn>
                <Btn className="icon-btn" pressed={displayMode === 'sketch'} onClick={() => applyMode('sketch')} title="스케치" aria-label="스케치">
                  <Icon><path d="M4 17l10-10 3 3-10 10H4z" /><path d="M12 9l3 3" /></Icon>
                </Btn>
                <Btn className="icon-btn" pressed={shadows} onClick={() => { const n = !shadows; setShadows(n); engRef.current?.setShadows(n); }} title="그림자" aria-label="그림자">
                  <Icon><circle cx="12" cy="7" r="2.5" /><path d="M12 11v3M4 19h16M8 16l4 3 4-3" /></Icon>
                </Btn>
                <Btn className="icon-btn" pressed={ambient} onClick={() => { const n = !ambient; setAmbient(n); engRef.current?.setAmbient(n); }} title="앰비언트" aria-label="앰비언트">
                  <Icon><path d="M4 12a8 8 0 0 1 16 0" /><path d="M20 12a8 8 0 0 1-16 0" /><path d="M4 12h16" /></Icon>
                </Btn>
              </Cluster>
            )}
            {threeD && !drawing && (
              <Cluster label="태양">
                <Fly
                  label="태양"
                  title="태양 — 방위와 고도"
                  summary={<Icon><circle cx="12" cy="12" r="3.2" /><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6.1 6.1l1.6 1.6M16.3 16.3l1.6 1.6M6.1 17.9l1.6-1.6M16.3 7.7l1.6-1.6" /></Icon>}
                >
                  <label className="field-inline" title="태양이 오는 방향">
                    <span>방위</span>
                    <input type="range" min="0" max="360" step="1" value={sunAz} aria-label="태양 방위" onChange={(e) => { const v = Number(e.target.value); setSunAz(v); engRef.current?.setSun(v, sunAlt); }} />
                  </label>
                  <label className="field-inline" title="태양이 떠 있는 높이">
                    <span>고도</span>
                    <input type="range" min="5" max="85" step="1" value={sunAlt} aria-label="태양 고도" onChange={(e) => { const v = Number(e.target.value); setSunAlt(v); engRef.current?.setSun(sunAz, v); }} />
                  </label>
                </Fly>
              </Cluster>
            )}
            {threeD && !drawing && (
              <Cluster label="분해">
                <Slot name="위아래">
                  <Btn
                    className="icon-btn"
                    pressed={explodeMode === 'vertical'}
                    onClick={() => pickExplode('vertical')}
                    title="위아래 분해 — 층을 위아래로 벌려요. 0은 조립."
                    aria-label="위아래 분해"
                  >
                    <Icon><path d="M12 20V4" /><path d="M8 8l4-4 4 4" /><path d="M8 16l4 4 4-4" /></Icon>
                  </Btn>
                </Slot>
                <Slot name="사방">
                  <Btn
                    className="icon-btn"
                    pressed={explodeMode === 'xyz'}
                    onClick={() => pickExplode('xyz')}
                    title="사방 분해 — 가운데에서 사방으로 벌려요. 0은 조립."
                    aria-label="사방 분해"
                  >
                    <Icon><path d="M12 12V4M12 12v8M12 12H4M12 12h8" /><path d="M9 7l3-3 3 3M9 17l3 3 3-3M7 9l-3 3 3 3M17 9l3 3-3 3" /></Icon>
                  </Btn>
                </Slot>
                <Slot name="정도">
                  <Fly
                    label="정도"
                    title="층, 단면, 벌어짐"
                    panelRef={explodeFly}
                    summary={<Icon><path d="M4 7h16M4 17h16M9 4v6M15 14v6" /></Icon>}
                  >
                    <label className="field-inline" title="층만 보기">
                      <span>층</span>
                      <select value={storey} onChange={(e) => { const v = e.target.value; setStorey(v); engRef.current?.setStorey(v); }} aria-label="층">
                        <option value="">전체</option>
                        {storeys.map((n, i) => (
                          <option key={i} value={i}>{n}</option>
                        ))}
                      </select>
                    </label>
                    <label className="field-inline" title="단면">
                      <span>단면</span>
                      <input type="range" min="0" max="1" step="0.01" value={section} aria-label="단면" onChange={(e) => { const v = Number(e.target.value); setSection(v); engRef.current?.applySection(v); }} />
                    </label>
                    <label className="field-inline" title="0은 조립">
                      <span>벌어짐</span>
                      <input type="range" min="0" max="1" step="0.01" value={explode} aria-label="벌어짐" onChange={(e) => { const v = Number(e.target.value); setExplode(v); engRef.current?.applyExplode(v); }} />
                      <span className="tb-val">{explode === 0 ? '조립' : Math.round(explode * 100)}</span>
                    </label>
                  </Fly>
                </Slot>
              </Cluster>
            )}
            <Cluster label="공유">
              <Btn
                className="icon-btn"
                variant="primary"
                disabled={!current || !isShareableId(current.id)}
                onClick={share}
                title={current && !isShareableId(current.id) ? '로컬 모델은 공유할 수 없어요' : '공유'}
                aria-label="공유"
              >
                <Icon><path d="M8 12h8M16 8l4 4-4 4M8 8L4 12l4 4" /></Icon>
              </Btn>
            </Cluster>
          </div>
        )}
        {current && (
          <div className="statusbar">
            <span className="kind">{drawing ? 'PDF' : (view?.kind || current.kind)}</span>
            <span className="status-name">{drawing ? drawing.name : (view?.name || current.name)}</span>
            {drawing && <span className="status-sel">p.{pdfPage}</span>}
            {!drawing && selected?.name && <span className="status-sel">{selected.name}</span>}
            {(isolated || hiddenCount > 0) && <span className="status-vis">{isolated ? '분리' : `숨김 ${hiddenCount}`}</span>}
          </div>
        )}
      </div>

      <nav className="rail" aria-label="패널">
        <Btn pressed={leftOpen} className="rail-btn" onClick={() => { setLeftOpen((v) => !v); if (narrow() && !leftOpen) setRightOpen(false); }} aria-label="프로젝트">
          <Icon><path d="M4 8h6l2 2h8v10H4z" /><path d="M4 8V6h5l2 2" /></Icon>
          <span className="rail-lbl">프로젝트</span>
        </Btn>
        <Btn pressed={rightOpen} className="rail-btn" onClick={() => { setRightOpen((v) => !v); if (narrow() && !rightOpen) setLeftOpen(false); }} aria-label="코멘트">
          <Icon><path d="M5 5h14v10H8l-3 3z" /></Icon>
          <span className="rail-lbl">코멘트</span>
        </Btn>
      </nav>

      {leftOpen && (
        <aside className="panel panel-left" aria-label="프로젝트">
          <header className="panel-head">
            <h1>{project?.label || '프로젝트'}</h1>
            {project && !isBuiltinProject(project.label) && (
              <button type="button" className="proj-del" onClick={onDeleteProject} title="프로젝트 삭제 (코드 필요)">삭제</button>
            )}
          </header>
          <div className="panel-block">
            <form className="proj-new" onSubmit={onCreateProject}>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={40} placeholder="새 프로젝트 이름" aria-label="새 프로젝트 이름" />
              <Btn type="submit">만들기</Btn>
            </form>
            <label className={`file${dragging ? ' is-drop' : ''}`} onDragOver={onOsFileOver} onDrop={onOsFileDrop}>
              <input
                type="file"
                accept=".ifc,.dxf,.dwg,.glb,.gltf,.dae,.3dm,.pdf,application/pdf"
                onDragOver={onOsFileOver}
                onDrop={onOsFileDrop}
                onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }}
              />
              <span>파일 열기</span>
            </label>
            {uploadStatus && <p className={`status${uploadErr ? ' err' : ''}`}>{uploadStatus}</p>}
          </div>
          <ul className="tree">
            {(!project || project.latest.length === 0) && <li className="quiet">파일 없음</li>}
            {project?.latest.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  className={`tree-file${activeId === f.id ? ' on' : ''}`}
                  onClick={() => openFile(f, project)}
                >
                  <span className="tree-ico" aria-hidden="true">
                    <Icon><path d="M8 4h6l4 4v12H8z" /><path d="M14 4v4h4" /></Icon>
                  </span>
                  <span className="name">{lectureFileName(f)}</span>
                  <span className="meta"><span className="kind">{fileKindLabel(f.kind)}</span>{fmtDate(f.created_at)}</span>
                </button>
              </li>
            ))}
          </ul>
          {project && (
            <ul className="tree-kids tree-tail">
              {project.back.length > 0 && (
                <li className="tree-back">
                  <button
                    type="button"
                    className="tree-folder"
                    aria-expanded={!!backFold[project.key]}
                    onClick={() => setBackFold((s) => ({ ...s, [project.key]: !s[project.key] }))}
                  >
                    <span className="tree-ico" aria-hidden="true">
                      <Icon>{backFold[project.key] ? <path d="M8 10l4 4 4-4" /> : <path d="M10 8l4 4-4 4" />}</Icon>
                    </span>
                    <span className="tree-ico" aria-hidden="true">
                      <Icon><path d="M4 8h6l2 2h8v10H4z" /><path d="M4 8V6h5l2 2" /></Icon>
                    </span>
                    <span className="name">이전</span>
                    <span className="tree-count">{project.back.length}</span>
                  </button>
                  {backFold[project.key] && (
                    <ul className="tree-kids">
                      {project.back.map((f) => (
                        <li key={f.id}>
                          <button
                            type="button"
                            className={`tree-file${activeId === f.id ? ' on' : ''}`}
                            onClick={() => openFile(f, project)}
                          >
                            <span className="tree-ico" aria-hidden="true">
                              <Icon><path d="M8 4h6l4 4v12H8z" /><path d="M14 4v4h4" /></Icon>
                            </span>
                            <span className="name">{lectureFileName(f)}</span>
                            <span className="meta"><span className="kind">{fileKindLabel(f.kind)}</span>{fmtDate(f.created_at)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )}
              <li className="tree-activity">
                <button
                  type="button"
                  className="tree-folder"
                  aria-expanded={!!fold[`act:${project.key}`]}
                  onClick={() => setFold((s) => ({ ...s, [`act:${project.key}`]: !s[`act:${project.key}`] }))}
                >
                  <span className="tree-ico" aria-hidden="true">
                    <Icon>{fold[`act:${project.key}`] ? <path d="M8 10l4 4 4-4" /> : <path d="M10 8l4 4-4 4" />}</Icon>
                  </span>
                  <span className="tree-ico" aria-hidden="true">
                    <Icon><path d="M5 7h14M5 12h10M5 17h14" /></Icon>
                  </span>
                  <span className="name">활동</span>
                  <span className="tree-count">{acts.length}</span>
                </button>
                {fold[`act:${project.key}`] && (
                  <ul className="tree-kids">
                    {acts.length === 0 && <li className="quiet">없음</li>}
                    {acts.map((ev) => (
                      <li key={ev.id}>
                        <button type="button" className="tree-file" onClick={() => openActivity(ev, project)}>
                          <span className="name">{activityTitle(ev)}</span>
                          <span className="meta">{ev.author || '이름 없음'} · {fmtDate(ev.at)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            </ul>
          )}
        </aside>
      )}

      {rightOpen && (
        <aside className="panel panel-right" aria-label="코멘트">
          <div className="panel-resize" onPointerDown={onRightResizeStart} title="끌어서 너비 조절" />
          <header className="panel-head">
            <h2>코멘트</h2>
            {current && <p className="quiet">{comments.length}</p>}
          </header>
          {current && (
            <div className="filters" role="group" aria-label="상태">
              {[['all', '전체'], ['open', '열림'], ['done', '완료']].map(([v, label]) => (
                <button key={v} type="button" className={`tab${issueFilter === v ? ' on' : ''}`} onClick={() => setIssueFilter(v)}>{label}</button>
              ))}
            </div>
          )}
          <ul className="comments">
            {!current && <li className="quiet">모델 없음</li>}
            {current && comments.length === 0 && <li className="quiet">코멘트 없음</li>}
            {current && comments.length > 0 && visibleComments.length === 0 && <li className="quiet">없음</li>}
            {visibleComments.map(({ c, i }) => {
              const st = issueStatus(c);
              const src = commentPhotoUrl(c);
              const who = c.author || '이름 없음';
              return (
                <li key={c.id || i} data-comment={i} className={`thread${focusIdx === i ? ' on' : ''}${st === 'done' ? ' done' : ''}`}>
                  <button
                    type="button"
                    className={`thread-mark${c.pos_x == null ? ' none' : ''}`}
                    style={{ '--pin': hashColor(who) }}
                    onClick={() => focusMark(c, i)}
                    aria-label={c.pos_x != null ? `핀 ${i + 1}` : who}
                  >
                    {c.pos_x != null ? i + 1 : who.slice(0, 1)}
                  </button>
                  <div className="thread-body">
                    <div className="thread-meta">
                      <button type="button" className="who" onClick={() => focusMark(c, i)}>{who}</button>
                      <span className="when">· {fmtDate(c.created_at)}</span>
                      <button type="button" className="where" onClick={() => focusMark(c, i)}>· {commentWhere(c)}</button>
                      <label className={`done-check${st === 'done' ? ' on' : ''}`}>
                        <input type="checkbox" checked={st === 'done'} onChange={() => toggleStatus(c)} />
                        완료
                      </label>
                      <span className="thread-acts">
                        <button type="button" className="thread-act" onClick={() => onEditComment(c)} title="수정 (코드 필요)">수정</button>
                        <button type="button" className="thread-act" onClick={() => onDeleteComment(c)} title="삭제 (코드 필요)">삭제</button>
                      </span>
                    </div>
                    <p className="text" onClick={() => focusMark(c, i)}>{c.body}</p>
                    {src && (
                      <button type="button" className="thumb-btn" onClick={() => setPreview({ kind: 'photo', url: src, name: c.body })} aria-label="사진 크게 보기">
                        <img className="thumb" src={src} alt="" />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {current && (
            <form className="composer" onSubmit={onSubmit}>
              {pending && (
                <div className="pin-state">
                  <span>
                    {pending.kind === 'pdf'
                      ? `도면 p.${pending.page} · ${pending.x.toFixed(2)}, ${pending.y.toFixed(2)}`
                      : pending.element_name || `${pending.x.toFixed(1)}, ${pending.y.toFixed(1)}${pending.z != null ? `, ${pending.z.toFixed(1)}` : ''}`}
                  </span>
                  <Btn onClick={() => setPending(null)}>해제</Btn>
                </div>
              )}
              <div className="compose-box">
                <span className="compose-who" style={{ '--pin': hashColor(author || '이름') }} aria-hidden="true">{(author || '?').slice(0, 1)}</span>
                <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} required maxLength={500} placeholder="위치 찍기(또는 /)로 자리를 찍은 뒤 남겨요" />
              </div>
              <div className="compose-bar">
                <label className="field field-name">
                  <span className="vh">이름</span>
                  <input value={author} onChange={(e) => onAuthor(e.target.value)} maxLength={20} required placeholder="이름" />
                </label>
                <label className="file file-sm">
                  <input
                    type="file"
                    accept="image/*,.heic,.heif"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      if (!isImageFile(f)) {
                        setCommentErr(true);
                        setCommentStatus('이미지 파일만 붙일 수 있어요.');
                        e.target.value = '';
                        return;
                      }
                      setPhoto(f);
                      e.target.value = '';
                    }}
                  />
                  <span>{photo ? photo.name : '현장 사진'}</span>
                </label>
                {photo && <Btn onClick={() => setPhoto(null)}>빼기</Btn>}
                <Btn type="submit" variant="primary" disabled={saving || !body.trim()}>{saving ? '저장 중…' : '남기기'}</Btn>
              </div>
              {commentStatus && <p className={`status${commentErr ? ' err' : ''}`}>{commentStatus}</p>}
            </form>
          )}
        </aside>
      )}

      {dragging && (
        <div className="drop" role="status">
          <p>여기에 놓아요</p>
        </div>
      )}

      {preview && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label={preview.name || '보기'} onClick={() => setPreview(null)}>
          <div className="lightbox-card" onClick={(e) => e.stopPropagation()}>
            <header className="lightbox-head">
              <h3>현장 사진</h3>
              <Btn onClick={() => setPreview(null)}>닫기</Btn>
            </header>
            <img className="lightbox-photo" src={preview.url} alt="" />
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
