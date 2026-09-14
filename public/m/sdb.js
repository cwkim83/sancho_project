// sdb.js — 산초 저장소 클라이언트. 세종 플랫폼 모듈이 쓰던 Firebase(Firestore·Auth) 의 함수 이름을 그대로 흉내 낸다.
// 실제 저장은 산초 서버의 /api/db/<컬렉션> (data/db/<컬렉션>.json 파일). 로그인은 없다 — 주인 한 사람이다.
// 쓰는 법(모듈 안): <script src="/m/sdb.js"></script> 뒤에 const { db, doc, getDocs, ... } = window.fb;
// 플랫폼 원본의 import { doc, getDocs … } from 'firebase-firestore.js' 줄을 이걸로 바꾸면 나머지 코드는 거의 그대로 돈다.
(function () {
  const tok = () => { try { return localStorage.sancho_token || ''; } catch { return ''; } };
  const withTok = (path) => tok() ? path + (path.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(tok()) : path;
  async function api(path, opt = {}) {
    const r = await fetch(withTok(path), { ...opt, headers: { 'content-type': 'application/json', ...(opt.headers || {}) } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `${r.status} ${path}`);
    return j;
  }
  const enc = encodeURIComponent;
  const colName = (name) => String(name).replace(/[^A-Za-z0-9_\-]/g, '_');   // 하위 컬렉션 'a/b/c' → 'a_b_c'
  const clone = (v) => v == null ? v : JSON.parse(JSON.stringify(v));
  const autoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  // ---- 참조 ----
  const db = { __sdb: true };
  function collection(parent, ...segs) {   // collection(db,'t_x') · collection(db,'a','id','b') · collection(docRef,'sub')
    const base = parent && parent.__id ? `${parent.__col}_${parent.__id}` : parent && parent.__col ? parent.__col : '';
    const name = [base, ...segs].filter(Boolean).join('_');
    return { __col: colName(name), id: colName(name), path: name };
  }
  function doc(parent, ...segs) {          // doc(db,'col','id') · doc(db,'col') (자동 id) · doc(colRef,'id') · doc(colRef) · doc(db,'col/id')
    let col, id;
    if (parent && parent.__col && !parent.__id) { col = parent.__col; if (segs.length === 1) id = segs[0]; else if (segs.length > 1) { col = colName([parent.__col, ...segs.slice(0, -1)].join('_')); id = segs[segs.length - 1]; } }
    else if (parent && parent.__id) { col = colName([parent.__col, parent.__id, ...segs.slice(0, -1)].join('_')); id = segs[segs.length - 1]; }
    else { const parts = segs.flatMap((s) => String(s).split('/')).filter(Boolean); if (parts.length % 2 === 1) { col = colName(parts.join('_')); } else { id = parts.pop(); col = colName(parts.join('_')); } }
    id = id == null ? autoId() : String(id);
    return { __col: col, __id: id, id, path: `${col}/${id}`, parent: { __col: col, id: col } };
  }
  const snap = (col, id, data) => ({ id, ref: { __col: col, __id: id, id, path: `${col}/${id}` }, exists: () => data != null, data: () => clone(data) ?? undefined, get: (f) => data ? String(f).split('.').reduce((o, k) => o == null ? o : o[k], data) : undefined });

  // ---- 질의 ----
  const documentId = () => '__name__';
  const where = (f, op, v) => ({ type: 'where', f, op, v });
  const orderBy = (f, dir = 'asc') => ({ type: 'orderBy', f, dir });
  const limit = (n) => ({ type: 'limit', n });
  const startAfter = () => ({ type: 'noop' }), startAt = startAfter, endAt = startAfter, endBefore = startAfter;
  function query(base, ...cs) { return { __q: true, __col: base.__col, cs: [...(base.cs || []), ...cs] }; }
  const fieldOf = (d, f) => f === '__name__' ? d.id : String(f).split('.').reduce((o, k) => o == null ? o : o[k], d.data() || {});
  const cmp = (a, b) => (a == null) - (b == null) || (a > b ? 1 : a < b ? -1 : 0);
  function applyQuery(docs, cs = []) {
    for (const c of cs) if (c.type === 'where') docs = docs.filter((d) => { const x = fieldOf(d, c.f), v = c.v; switch (c.op) {
      case '==': return x === v || (x != null && v != null && String(x) === String(v)); case '!=': return x !== v; case '<': return x < v; case '<=': return x <= v; case '>': return x > v; case '>=': return x >= v;
      case 'in': return (v || []).some((y) => y === x || String(y) === String(x)); case 'not-in': return !(v || []).some((y) => y === x || String(y) === String(x));
      case 'array-contains': return Array.isArray(x) && x.includes(v); case 'array-contains-any': return Array.isArray(x) && (v || []).some((y) => x.includes(y)); default: return true; } });
    const ords = cs.filter((c) => c.type === 'orderBy');
    if (ords.length) docs = [...docs].sort((a, b) => { for (const o of ords) { const r = cmp(fieldOf(a, o.f), fieldOf(b, o.f)); if (r) return o.dir === 'desc' ? -r : r; } return 0; });
    const lim = cs.find((c) => c.type === 'limit'); if (lim) docs = docs.slice(0, lim.n);
    return docs;
  }
  const qsnap = (docs) => ({ docs, size: docs.length, empty: !docs.length, forEach: (fn) => docs.forEach(fn), docChanges: () => docs.map((d) => ({ type: 'added', doc: d })) });

  // ---- 읽기 · 쓰기 ----
  async function getDoc(ref) { const r = await api(`/api/db/${ref.__col}/${enc(ref.__id)}`); return snap(ref.__col, ref.__id, r.exists === false ? null : r.data); }
  async function getDocs(q) { const col = q.__col; const arr = await api(`/api/db/${col}`); return qsnap(applyQuery(arr.map((d) => snap(col, d.id, d.data)), q.cs)); }
  async function setDoc(ref, data, opts) { await api(`/api/db/${ref.__col}/${enc(ref.__id)}`, { method: 'PUT', body: JSON.stringify({ data, merge: !!(opts && opts.merge) }) }); }
  async function updateDoc(ref, ...patch) {   // updateDoc(ref,{a:1,'b.c':2}) 또는 updateDoc(ref,'a',1,'b',2)
    const data = patch.length === 1 && typeof patch[0] === 'object' ? patch[0] : Object.fromEntries(patch.reduce((o, v, i, a) => (i % 2 ? o : [...o, [v, a[i + 1]]]), []));
    await api(`/api/db/${ref.__col}/${enc(ref.__id)}`, { method: 'PUT', body: JSON.stringify({ data, merge: 'deep' }) });
  }
  async function deleteDoc(ref) { await api(`/api/db/${ref.__col}/${enc(ref.__id)}`, { method: 'DELETE' }); }
  async function addDoc(colRef, data) { const r = await api(`/api/db/${colRef.__col}`, { method: 'POST', body: JSON.stringify({ data }) }); return { __col: colRef.__col, __id: r.id, id: r.id, path: `${colRef.__col}/${r.id}` }; }
  function writeBatch() { const ops = []; return { set: (ref, data, o) => ops.push({ op: 'set', col: ref.__col, id: ref.__id, data, merge: !!(o && o.merge) }), update: (ref, data) => ops.push({ op: 'update', col: ref.__col, id: ref.__id, data }), delete: (ref) => ops.push({ op: 'delete', col: ref.__col, id: ref.__id }), commit: () => api('/api/db/_batch', { method: 'POST', body: JSON.stringify({ ops }) }) }; }
  const runTransaction = async (_db, fn) => fn({ get: getDoc, set: setDoc, update: updateDoc, delete: deleteDoc });
  const serverTimestamp = () => new Date().toISOString();
  const deleteField = () => null;
  const increment = (n) => ({ __inc: n });
  const arrayUnion = (...v) => ({ __union: v }), arrayRemove = (...v) => ({ __remove: v });
  const Timestamp = { now: () => tsOf(new Date()), fromDate: (d) => tsOf(d), fromMillis: (ms) => tsOf(new Date(ms)) };
  const tsOf = (d) => ({ seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0, toDate: () => new Date(d), toMillis: () => d.getTime(), toJSON: () => d.toISOString() });

  // ---- 실시간(onSnapshot): 서버 SSE 로 "어느 컬렉션이 바뀌었다" 만 받고, 그 컬렉션을 다시 읽어 콜백한다 ----
  const subs = new Set(); let es = null;
  function ensureES() {
    if (es) return;
    try { es = new EventSource(withTok('/api/db/_events')); } catch { return; }
    es.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } for (const s of subs) if (!m.col || s.col === m.col) s.run(); };
    es.onerror = () => { try { es.close(); } catch {} es = null; setTimeout(ensureES, 3000); };
  }
  function onSnapshot(target, next, error) {
    const cb = typeof next === 'function' ? next : (next && next.next) || (() => {}), eb = typeof next === 'function' ? error : (next && next.error);
    const sub = { col: target.__col, run: async () => { try { cb(target.__id ? await getDoc(target) : await getDocs(target)); } catch (e) { eb && eb(e); } } };
    subs.add(sub); sub.run(); ensureES();
    return () => subs.delete(sub);
  }

  // ---- 로그인 흉내: 주인 한 사람 (/api/me) ----
  const auth = { currentUser: { uid: 'owner', email: '', displayName: '주인', photoURL: '' }, app: {} };
  const authCbs = [];
  const me = api('/api/auth/me').then((u) => { auth.currentUser = { uid: u.uid || 'owner', email: u.email || '', displayName: u.name || '주인', photoURL: '', ...u }; return auth.currentUser; }).catch(() => auth.currentUser);
  function onAuthStateChanged(_auth, cb) { me.then((u) => cb(u)); authCbs.push(cb); return () => {}; }
  class GoogleAuthProvider { setCustomParameters() {} addScope() {} }
  const signIn = async () => ({ user: await me });
  const signOut = async () => {};
  const getAuth = () => auth, getFirestore = () => db, initializeApp = () => ({});

  window.fb = { db, auth, doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, onSnapshot, query, where, orderBy, limit, startAfter, startAt, endAt, endBefore, documentId,
    writeBatch, runTransaction, serverTimestamp, deleteField, increment, arrayUnion, arrayRemove, Timestamp, getFirestore, getAuth, initializeApp,
    onAuthStateChanged, signOut, GoogleAuthProvider, signInWithPopup: signIn, signInWithRedirect: signIn, signInWithCredential: signIn, getRedirectResult: async () => null, me: () => me };

  // ---- 산초 다리: 모듈 → 껍데기(부모) ----
  const post = (m) => { try { (window.parent !== window ? window.parent : window).postMessage({ sancho: true, ...m }, '*'); } catch {} };
  window.SANCHO = {
    ask: (text, send = false) => post({ act: 'ask', text, send }),   // 채팅창에 지시를 채우거나(send=false) 바로 보낸다(send=true)
    open: (view, param) => post({ act: 'open', view, param }),      // 다른 메뉴로 이동
    title: (text) => post({ act: 'title', text }),                  // 헤더 제목 바꾸기(빵부스러기)
    toast: (text, kind) => post({ act: 'toast', text, kind }),
    me: () => me, api, tok, dl: (p) => withTok('/api/download?path=' + enc(p)),
  };
  // 부모 화면의 밝게/어둡게를 따라간다
  try { const t = localStorage.sancho_theme; if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch {}
})();
