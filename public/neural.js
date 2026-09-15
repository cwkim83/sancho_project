// 산초 뇌 그래프 — 파이스(PAIS) neural.js 를 그대로 옮김(2026-09-13). PAIS cognitive core — 옵시디언 그래프 뷰를 그대로 옮긴 상호작용 그래프.
// 볼트의 노트가 노드, [[링크]]가 엣지. 힘 기반 배치라 실제로 출렁이고,
// 마우스로 끌고(팬) 휠로 확대하고 노드를 집어 옮길 수 있다. 아이폰에서는 두 손가락 확대.
//
// 외부 API(기존 그대로 유지): PAISNeural.setActive() / setIdle() / pulse() / stats() / refreshVault()
//
// 왜 라이브러리를 안 쓰나: 이 프로젝트는 외부 패키지 0개가 원칙이고,
// 노드 수십 개 규모에서는 O(n²) 힘 계산이 충분히 싸다(18노드면 153쌍/틱).
// force-graph 200KB 를 들이는 대신 필요한 물리만 200줄로 쓴다.
(function () {
  const canvas = document.getElementById('neural');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const DPR = Math.min(window.devicePixelRatio || 1, 2);

  let W = 0, H = 0, mode = 'idle', t = 0, sigCount = 0;
  let nodes = [], links = [], byId = new Map(), neighbors = new Map();
  let signals = [];                    // 사고 중 링크를 타고 흐르는 점
  let view = { x: 0, y: 0, k: 1 };     // 화면 = 월드 * k + (x,y)
  let hover = null, drag = null, pan = null, moved = 0, fitted = false;
  let note = '뇌를 읽는 중…';
  let ghost = false;                   // 볼트가 비어도 화면이 죽지 않게 채우는 익명 노드
  let C = [15, 126, 168];

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rgba = (a) => `rgba(${C[0]},${C[1]},${C[2]},${a})`;

  // 밤낮은 OS 설정이 아니라 <html data-theme> 가 진실이다(hud.js 의 수동/시간 전환).
  // media 쿼리는 JS 가 아직 지정 안 했을 때의 폴백.
  function isDark() {
    const th = document.documentElement.dataset.theme;
    if (th === 'dark') return true;
    if (th === 'light') return false;
    return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
  }
  let dark = isDark();

  function readAccent() {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(v);
    if (m) C = [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  }
  const onTheme = () => { dark = isDark(); readAccent(); };
  if (window.matchMedia) {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener ? mq.addEventListener('change', onTheme) : mq.addListener(onTheme);
  }
  new MutationObserver(onTheme)
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  function resize() {
    const r = canvas.getBoundingClientRect();
    W = r.width; H = r.height;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (!fitted) center();
  }
  const center = () => { view.x = W / 2; view.y = H / 2; };

  // ---- 데이터 ----------------------------------------------------
  // 커뮤니티(폴더) → 색. graphify 뷰어처럼 무리마다 다른 색을 준다 — CODE 모드에서만.
  // 해시라서 같은 커뮤니티는 새로고침해도 늘 같은 색이다.
  function hueOf(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h % 360;
  }

  // graphify 의 핵심: 폴더가 아니라 **실제 연결 모양**으로 무리를 찾아 색을 나눈다(라벨 전파).
  // 이웃들이 가장 많이 단 이름표를 자기 이름표로 삼기를 되풀이하면, 촘촘히 이어진 덩어리끼리 같은 이름표로 모인다.
  // 훑는 순서를 섞지 않아서 같은 그래프면 늘 같은 색이 나온다 — 새로고침마다 색이 바뀌면 눈이 피곤하다.
  function findCommunities() {
    const label = new Map(nodes.map((n) => [n.id, n.id]));
    for (let it = 0; it < 12; it++) {
      let changed = 0;
      for (const n of nodes) {
        const nb = neighbors.get(n.id);
        if (!nb || !nb.size) continue;
        const cnt = new Map();
        for (const m of nb) { const l = label.get(m); cnt.set(l, (cnt.get(l) || 0) + 1); }
        let best = label.get(n.id), bn = 0;
        for (const [l, c] of cnt) if (c > bn || (c === bn && l < best)) { best = l; bn = c; }
        if (best !== label.get(n.id)) { label.set(n.id, best); changed++; }
      }
      if (!changed) break;
    }
    return label;
  }

  // 폴더(무리) 필터 — 색인을 왕창 넣으면 그래프가 털뭉치가 된다.
  // 🛰️ 메뉴에서 최상위 폴더 단위로 껐다 켠다. 끈 목록은 기억된다.
  let excluded = new Set();
  try { excluded = new Set(JSON.parse(localStorage.getItem('sancho_graph_excl') || '[]')); } catch {}
  const topFolder = (f) => String(f || '').split('/')[0] || '(루트)';
  const MAX_DRAW = 800;   // O(n²) 물리가 버티는 선 — 넘으면 연결 많은 순으로 자른다
  let lastRaw = null, capped = 0;

  function setData(d) {
    lastRaw = d;
    const prev = new Map(nodes.map((n) => [n.id, n]));   // 갱신 때 위치를 유지해 화면이 튀지 않게
    byId = new Map();
    let src_nodes = (d.nodes || []).filter((n) => !excluded.has(topFolder(n.folder)));
    capped = 0;
    if (src_nodes.length > MAX_DRAW) {
      src_nodes = [...src_nodes].sort((a, b) => (b.deg || 0) - (a.deg || 0)).slice(0, MAX_DRAW);
      capped = (d.nodes || []).length - src_nodes.length;
    }
    d = { ...d, nodes: src_nodes };
    nodes = (d.nodes || []).map((n) => {
      const p = prev.get(n.id);
      const node = {
        id: n.id, name: n.name || n.id, folder: n.folder || '', deg: n.deg || 0,
        file: n.file || '', loc: n.loc || '',
        // CODE 는 커뮤니티, NOTES 는 폴더 — 무리가 있으면 색을 준다(없으면 액센트 단색)
        hue: n.folder ? hueOf(n.folder) : null,
        x: p ? p.x : (Math.random() - 0.5) * 180,
        y: p ? p.y : (Math.random() - 0.5) * 180,
        vx: 0, vy: 0,
        r: 3.2 + Math.min(9, Math.sqrt(n.deg || 1) * 2.1),   // 허브일수록 크게
      };
      byId.set(node.id, node);
      return node;
    });
    links = (d.links || [])
      .map((l) => ({ a: byId.get(l.source), b: byId.get(l.target) }))
      .filter((l) => l.a && l.b && l.a !== l.b);
    neighbors = new Map(nodes.map((n) => [n.id, new Set()]));
    for (const l of links) { neighbors.get(l.a.id).add(l.b.id); neighbors.get(l.b.id).add(l.a.id); }
    // graphify 처럼: 크기는 **실제** 연결 수, 색은 **무리(community)** — 서버가 준 deg 는 어림값이라 쓰지 않는다
    for (const n of nodes) n.deg = neighbors.get(n.id).size;
    const comm = findCommunities();
    for (const n of nodes) {
      n.comm = comm.get(n.id) || n.id;
      n.hue = hueOf(n.comm);
      n.r = 3.4 + Math.min(11, Math.sqrt(n.deg || 1) * 2.4);   // 허브일수록 크게
    }
    note = nodes.length ? '' : '아직 기억이 없어요';
    if (calm) layBrain();   // 잠든 사이 데이터가 갈리면 새 노드에도 뇌 자리를 준다
    if (!fitted && nodes.length) { setTimeout(fit, 600); fitted = true; }   // 몇 틱 안정된 뒤 맞춘다
  }

  // 뇌 재료: orb(자비스 대기 화면, 기본) / vault(노트 그래프) / code(PAIS 코드 구조).
  // 기본을 orb 로 두는 이유: 그래프는 늘 떠 있기엔 무겁다(O(n²) 물리 + 페이지마다 볼트 fetch —
  // 사용자가 "화면에 계속 띄우면 느리다"고 지적). 오브는 입자 ~90개 O(n) 이라
  // 볼트가 몇만 노트로 커져도 비용이 똑같고, 그래프는 칩을 눌러 부를 때만 읽는다.
  //
  // orb 도입(2026-08-09) 전에 그래프를 쓰던 사람은 localStorage 에 이미 vault/code 가 있어서
  // "기본 orb"를 못 만난다. 그래서 딱 한 번 orb 로 옮겨준다 — 그 뒤 사용자가 고른 값은 존중한다.
  if (!localStorage.getItem('sancho_orb_migrated')) {
    localStorage.setItem('sancho_orb_migrated', '1');
    localStorage.setItem('sancho_graph_src', 'orb');
  }
  let src = localStorage.getItem('sancho_graph_src') || 'orb';

  async function fetchVault() {
    if (src === 'orb') return;   // 오브 모드에선 그래프를 아예 읽지 않는다(주기 갱신 포함)
    try {
      const tok = (localStorage.getItem('sancho_token') || '').replace(/[^\x20-\x7E]/g, '');  // 헤더는 ASCII 만
      const res = await fetch(src === 'code' ? '/api/graph' : '/api/graph', {
        headers: tok ? { 'x-token': tok } : {},
        cache: 'no-store',
      });
      if (res.status === 401) { note = '접속 토큰을 입력하면 뇌 그래프가 보여요'; return fallback(); }
      if (!res.ok) { note = `뇌 재료를 읽지 못했어요 (${res.status})`; return fallback(); }
      const d = await res.json();
      if (!(d.nodes || []).length) return fallback();
      ghost = false;
      setData(d);
    } catch (e) { note = '뇌 재료 연결 실패'; fallback(); }
  }

  // 볼트를 못 읽어도 코어가 빈 화면이면 안 된다 — 이름 없는 유령 노드로 형태를 유지한다.
  // 진짜 데이터가 오면 다음 fetch 에서 통째로 교체된다.
  function fallback() {
    if (nodes.length && !ghost) return;   // 진짜 그래프가 이미 있으면 덮지 않는다
    if (ghost) return;
    const N = 46, ns = [], ls = [];
    for (let i = 0; i < N; i++) ns.push({ id: 'g' + i, name: '', deg: 1 + (i % 4) });
    for (let i = 1; i < N; i++) ls.push({ source: 'g' + i, target: 'g' + ((Math.random() * i) | 0) });
    for (let i = 0; i < 12; i++) ls.push({ source: 'g' + ((Math.random() * N) | 0), target: 'g' + ((Math.random() * N) | 0) });
    ghost = true;
    setData({ nodes: ns, links: ls });
  }

  // 전체가 화면에 들어오도록 배율·위치를 맞춘다(옵시디언의 "그래프 맞춤"과 같은 동작)
  function fit() {
    if (!nodes.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); }
    const pad = 42;
    const k = clamp(Math.min((W - pad * 2) / Math.max(1, x1 - x0), (H - pad * 2) / Math.max(1, y1 - y0)), 0.25, 2.2);
    view.k = k;
    view.x = W / 2 - ((x0 + x1) / 2) * k;
    view.y = H / 2 - ((y0 + y1) / 2) * k;
  }

  // ---- 대기 화면: 뇌 실루엣 ---------------------------------------
  // 한동안 아무 일이 없으면 노드들이 옆모습 뇌 모양으로 모여 숨쉰다.
  // 말을 걸거나 마우스가 움직이면 힘 기반 그래프로 다시 풀린다 — 별도 전환 코드 없이
  // 물리가 알아서 morph 한다(뇌 자리에서 출발해 스프링·반발로 제자리를 찾아간다).
  const CALM_AFTER = 45000;
  let lastTouch = Date.now(), calm = false, brainDone = false;
  const wake = () => { lastTouch = Date.now(); };
  window.addEventListener('pointermove', wake, { passive: true });
  window.addEventListener('pointerdown', wake, { passive: true });
  window.addEventListener('keydown', wake);

  // 옆모습 뇌 윤곽(왼쪽을 보는 대뇌 + 소뇌 + 아랫면), [-1,1] 좌표. y 는 화면 아래가 +.
  const BRAIN = [
    [-0.80, 0.05], [-0.88, -0.15], [-0.84, -0.38], [-0.66, -0.56], [-0.42, -0.68],
    [-0.14, -0.72], [0.14, -0.70], [0.40, -0.62], [0.62, -0.46], [0.76, -0.24],
    [0.80, 0.00], [0.76, 0.22], [0.66, 0.40], [0.52, 0.42], [0.60, 0.58],
    [0.44, 0.68], [0.24, 0.64], [0.14, 0.50], [-0.02, 0.46], [-0.22, 0.42],
    [-0.42, 0.38], [-0.60, 0.28], [-0.74, 0.18],
  ];
  const seeded = (s) => { const x = Math.sin(s * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  function brainAt(s) {   // 윤곽 폴리라인 위의 위치 (s: 0~1, 닫힌 곡선)
    const n = BRAIN.length, f = s * n, i = Math.floor(f) % n, j = (i + 1) % n, t = f - Math.floor(f);
    return [BRAIN[i][0] + (BRAIN[j][0] - BRAIN[i][0]) * t, BRAIN[i][1] + (BRAIN[j][1] - BRAIN[i][1]) * t];
  }
  function layBrain() {   // 각 노드에 뇌 위의 목표 자리를 배정 — 75% 윤곽, 25% 속살
    const R = 170;        // 월드 좌표 크기 (calm 중 view 가 화면에 맞게 따라온다)
    nodes.forEach((n, i) => {
      const h = seeded(i + 1);
      if (i % 4 === 3) {  // 속을 채우는 노드
        const [px, py] = brainAt(h);
        n.bx = px * R * (0.25 + 0.55 * seeded(i + 50));
        n.by = py * R * (0.25 + 0.55 * seeded(i + 90)) + 6;
      } else {            // 윤곽을 따라 고르게 + 약간의 흐트러짐
        const [px, py] = brainAt((i * 0.61803) % 1);
        n.bx = px * R + (h - 0.5) * 14;
        n.by = py * R + (seeded(i + 7) - 0.5) * 14;
      }
    });
    brainDone = true;
  }

  // ---- 오브: 자비스 대기 화면 --------------------------------------
  // 링+호+입자로 된 "가슴의 원자로" 느낌. 대기 중엔 천천히 숨쉬고,
  // 생각 중(active)엔 빨라지고, 말할 때(setTalking)는 목소리처럼 출렁인다.
  let talking = false;
  let rings = [];                       // pulse() 가 만드는 확장 링
  const ORB_P = [...Array(26)].map((_, i) => ({
    a: seeded(i + 3) * Math.PI * 2,
    r: 0.58 + seeded(i + 31) * 0.34,    // 궤도 반지름 (R 배수)
    v: (0.002 + seeded(i + 57) * 0.004) * (i % 2 ? 1 : -1),
    s: 1 + seeded(i + 83) * 1.6,
  }));
  // 심장박동 파형 — "두근-둥" 이중 박동. 사인은 출렁임이지 박동이 아니다(부장님: 두근두근).
  // 첫 박(수축) + 0.16 위상 뒤 작은 둘째 박. pow³ 로 봉우리를 좁혀 심전도처럼 만든다.
  function beatWave(phase) {
    const x = phase % 1;
    const b1 = Math.pow(Math.max(0, Math.sin(x * 6.283)), 3);
    const b2 = 0.55 * Math.pow(Math.max(0, Math.sin((x - 0.16) * 6.283)), 3);
    return b1 + b2;
  }
  // 심박 상한을 숫자 하나로 못박는다 — 계수를 코드에 흩뿌리면 상한이 조용히 깨진다.
  const 심박평소 = 25, 심박최대 = 80;                       // 분당 회수 (부장님 확정)
  const 심박계수 = 심박평소 / 3600;                          // 60fps × 60초
  const 심박가중 = 심박최대 / 심박평소 - 1;                  // load=1 에서 심박최대가 되게
  // 부하(0~1) — 두뇌 라우터의 실제 통행량. 상태판이 2.5초마다 setLoad 로 먹인다.
  // 심박이 장식이 아니라 계기가 된다: 호출이 겹칠수록 빠르고 크게 뛴다(~95 → ~140회/분).
  let load = 0, loadTarget = 0;
  // 위상은 **적분**으로 쌓는다 — beatWave(t × 속도) 곱셈식이었을 때는 load 가
  // 변하는 순간 위상이 t 에 비례해 점프했다(위상 = t×계수×(1+가중×load) 이므로
  // ∂위상/∂load = t×계수×가중 — 켜둔 지 1시간이면 t≈216,000 이라 load 가 0.06 만
  // 움직여도 한 프레임에 심장이 ~200번 지나간다). 상한 80회는 "속도"에만 걸려 있어
  // 이 점프를 못 막았다 — 2026-08-27 새벽 부장님 영상의 "파파팍"이 정확히 이것.
  // 오래 켜둘수록 심해지는 것도 t 비례라서다. 적분이면 속도가 변해도 위상은 연속이다.
  let 심박위상 = 0, 숨위상 = 0, 지난t = 0;

  // ── 오브 영상 몸체 (2026-09-08 부장님 지시) ─────────────────────────
  // Higgsfield 렌더(테슬라 플라즈마 — 금색 링 회전·구체 역회전·내부 번개)가 캔버스 구체를 대신한다.
  // 부장님 조건 두 가지를 그대로 코드로: ① 크기는 절대 변하지 않는다(숨쉬기·두근두근 없음)
  // ② 반응은 **재생 속도**로만 — 대기 0.6× · 사고 1+부하(최대 2×) · 말할 때 1.2×.
  // 눈금 링·회전 호·궤도 입자·pulse 파동은 캔버스가 그대로 위에 그린다(캔버스가 영상 위 층).
  // 영상이 없거나 못 열리면(hidden 그대로) 예전 캔버스 구체로 자연히 되돌아간다.
  let vidEl = null, fx = null;   // fx: 루마 키 렌더러 { canvas, draw(gain) } — 번개 영상(orb-tesla)
  let calmEl = null, fx2 = null; // 대기용 잔잔한 영상(orb-calm: 번개 없음, 링·구체·볼만 천천히). 없거나 못 열리면 번개 영상만으로 돈다
  function coreVideo() {
    if (vidEl === null) { vidEl = document.getElementById('coreVideo') || false; if (vidEl) vidEl.addEventListener('error', () => { if (fx) fx.canvas.hidden = true; vidEl = false; }); }
    return vidEl || null;
  }
  function calmVideo() {
    if (calmEl === null) { calmEl = document.getElementById('coreCalmVideo') || false; if (calmEl) calmEl.addEventListener('error', () => { if (fx2) fx2.canvas.hidden = true; calmEl = false; }); }
    return calmEl || null;
  }
  // ── 루마 키: 밝기 = 투명도 ──────────────────────────────────────────
  // 부장님(2026-09-08): "흰 배경이 아니라 **투명** — 밤이건 낮이건 뒤에 어떤 이미지든 붙일 수 있게."
  // mp4 는 알파 채널을 못 담는다. 그래서 검은 배경 영상을 WebGL 로 그리면서 픽셀 밝기를 알파로 쓴다:
  // 검은 배경 = 완전 투명, 빛나는 플라즈마 = 불투명. 진짜 알파라 카드·사진·낮·밤 어떤 배경 위에도 얹힌다.
  // (CSS mix-blend-mode 는 어두운 배경에서만 통하고, 낮 테마에선 검은 원이 비쳤다.)
  function makeLumaKey(video, id = 'coreFx') {
    const canvas = document.createElement('canvas'); canvas.id = id;
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!gl) return null;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, 'attribute vec2 p;varying vec2 t;void main(){t=vec2(p.x*.5+.5,.5-p.y*.5);gl_Position=vec4(p,0.,1.);}'));
    // a = 밝기×이득. 프리멀티플라이드 출력이라 색은 a/밝기 비율로 맞춘다(색 ≤ 알파 보장)
    // 바닥값 0.07: 압축 영상의 "거의 검정"(rgb 8~18)은 완전 투명으로 — 안 그러면 정사각형 경계가 옅게 비친다
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, 'precision mediump float;uniform sampler2D u;uniform float g;varying vec2 t;void main(){vec3 c=texture2D(u,t).rgb;float l=max(c.r,max(c.g,c.b));float a=clamp((l-.07)/.93*g,0.,1.);gl_FragColor=vec4(c*min(1.,a/max(l,1e-4)),a);}'));
    gl.linkProgram(prog); gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const p = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(p); gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const gLoc = gl.getUniformLocation(prog, 'g');
    video.parentNode.insertBefore(canvas, video.nextSibling);   // 영상 바로 위, #neural 캔버스 아래
    return { canvas, draw(gain) {
      if (video.readyState < 2) return;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform1f(gLoc, gain);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    } };
  }
  // 매 프레임: 크기 맞추고(고정 — 숨쉬기 없음) 영상 한 장을 투명 캔버스에 그린다. 성공하면 true.
  function fitVideo(v, R) {
    if (fx === null) fx = makeLumaKey(v) || false;
    if (!fx) return false;                                     // WebGL 이 없으면 예전 캔버스 오브로
    // 영상 속 구체 반지름 ≈ 프레임의 0.315 → 구체가 눈금 링(R×1.06) 바로 안쪽에 오게 프레임 = 3R.
    // HUD 모드에선 코어가 화면 가운데 크게 서므로 4/5 로 줄인다(부장님: "조금만 더 줄여줘").
    const S = Math.round(R * (document.body.classList.contains('hud') ? 2.4 : 3));
    const gain = dark ? 1.3 : 1.9;   // ponytail: 밝기→알파 이득 상수. 낮 테마엔 몸통을 더 불투명하게. 불만 나오면 여기만 조절
    const 한장 = (f, video) => {
      if (f.canvas.dataset.s !== String(S)) {
        f.canvas.dataset.s = S;
        f.canvas.style.width = f.canvas.style.height = S + 'px';
        f.canvas.width = f.canvas.height = Math.min(1080, Math.round(S * Math.min(window.devicePixelRatio || 1, 2)));
      }
      if (f.canvas.hidden) f.canvas.hidden = false;
      if (video.paused && !document.hidden) video.play().catch(() => {});
      f.draw(gain);
    };
    한장(fx, v);
    // 대기용 잔잔한 영상은 있을 때만 — 같은 크기로 같은 자리에 겹쳐 두고 CSS opacity 로 교차한다.
    // ponytail: 둘 다 매 프레임 그린다(1080p 텍스처 2장). 폰에서 버벅이면 숨은 쪽 draw 를 건너뛰는 것부터.
    const c = calmVideo();
    if (c) { if (fx2 === null) fx2 = makeLumaKey(c, 'coreFxCalm') || false; if (fx2) 한장(fx2, c); }
    return true;
  }
  function drawOrb() {
    const cx = W / 2, cy = H / 2;
    const small = Math.min(W, H) < 520;                       // 폰 — 몸집·광량을 키워야 보인다
    const R = Math.min(W, H) * (small ? 0.36 : 0.30);
    const speed = mode === 'active' ? 3.4 + load : 1;
    const vidSrc = coreVideo();
    const vid = !!(vidSrc && fitVideo(vidSrc, R));   // 영상 몸체가 실제로 그려졌나
    if (vid) {
      // 부장님(2026-09-08, 세 번째 정리): 대기 = 링·구체·가운데 에너지 볼은 **그대로**, 번개만 없음 → 잔잔한 영상(orb-calm)으로 교차.
      // 사고/작업/응답 = 번개 영상(orb-tesla). "회전" 은 영상 속 링·구체가 도는 그 움직임 — 빠르고 느린 건 재생 속도로만.
      // (앞선 두 판 — 캔버스 360° 스핀, 가운데만 남기고 검게 지우기 — 는 둘 다 오해였다.)
      const calm = fx2 && !fx2.canvas.hidden ? calmVideo() : null;
      const idle = !!calm && mode !== 'active' && !talking;
      const rate = mode === 'active' ? Math.min(2, 1 + load) : (talking ? 1.2 : (calm ? 1 : 0.6));
      if (Math.abs(vidSrc.playbackRate - rate) > 0.01) vidSrc.playbackRate = rate;
      if (calm) {                                             // 대기 영상도 부하를 따라 조금 빨라진다(0.7× ~ 1.5×)
        const cr = Math.min(1.5, 0.7 + load);
        if (Math.abs(calm.playbackRate - cr) > 0.01) calm.playbackRate = cr;
      }
      if (fx.canvas.classList.contains('idle') !== idle) { fx.canvas.classList.toggle('idle', idle); if (fx2) fx2.canvas.classList.toggle('idle', idle); }
    }
    load += (loadTarget - load) * 0.06;                       // 심박수가 덜컥 안 바뀌게 스르륵
    // t 는 frame() 이 실제 시간으로 올린다(60fps 한 프레임 = 1). 그 증분만 받는다.
    const 단위 = 지난t ? Math.min(6, t - 지난t) : 1;
    지난t = t;
    // 사고 중: 심장박동. 부하가 클수록 빠르다. 대기: 느린 숨쉬기만.
    // 분당 회수 = 60 × 계수 × 60. 평소 25회 → 부하 최대 80회 (2026-08-22 부장님 확정).
    // load 는 setLoad 에서 0~1 로 묶이므로 80회가 **절대 상한**이다. 그 위로는 못 간다.
    if (mode === 'active') 심박위상 += 단위 * 심박계수 * (1 + 심박가중 * load);
    else 심박위상 = 0;                                        // 대기로 오면 첫 박부터 깨끗하게
    숨위상 += 단위 * (mode === 'active' ? 0.02 * speed : 0.0192);
    const beat = mode === 'active' ? beatWave(심박위상) : 0;
    const beatK = (small ? 1 : 1.2) * (1 + 0.6 * load);       // 데스크탑 두근둥 +20% · 부하 가중
    // 광량 +30% (0.55 → 0.72) — 박동이 느려진 만큼 한 번 뛸 때 확실히 밝아지게
    const glow = (mode === 'active' ? 1.25 + 0.72 * beat * beatK : 1) * (small ? 1.2 : 1);
    // 말할 때의 출렁임 — 실제 오디오 분석 없이 사인 합으로 충분히 목소리처럼 보인다
    const amp = talking ? 0.07 + 0.07 * Math.abs(Math.sin(t * 0.21) + 0.6 * Math.sin(t * 0.083)) : 0;
    // 대기 숨: 0.0192 → 분당 11회. 사고 중엔 숨을 얕게 하고 심박이 주인공이 되게 한다.
    // 진폭 0.13 = 예전 0.10 의 +30% — 느린 박동을 크게 보이게 하려고 키웠다.
    // 숨도 같은 이유로 적분 위상 — sin(t × 속도) 는 speed(=3.4+load)가 변할 때마다 튀었다
    let breathe = 1
      + (mode === 'active' ? 0.018 : 0.055) * Math.sin(숨위상)
      + 0.13 * beat * beatK                                               // 두근두근 (+30%)
      + amp;
    if (vid) breathe = 1;   // 영상 몸체일 땐 링·입자도 숨쉬지 않는다 — 크기 고정이 부장님 조건

    // 영상 몸체가 있으면 예전 오브(눈금 링·회전 호·궤도 입자·코어)는 그리지 않는다 —
    // 겹쳐 그리면 "뒤에 옛 오브가 남아 있다"로 보인다(2026-09-08 부장님 신고). 도구 실행 파동만 남긴다.
    if (!vid) {
    // 눈금 링 (다이얼)
    ctx.lineWidth = 1;
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2 + t * 0.0012 * speed;
      const r1 = R * 1.06, r2 = R * (i % 5 ? 1.09 : 1.13);
      ctx.strokeStyle = rgba((i % 5 ? 0.10 : 0.22) * glow);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      ctx.stroke();
    }
    // 회전 호 3개 — 서로 다른 속도·방향
    for (const A of [
      { r: 0.52, w: 2.4, len: 2.1, sp: 0.010, ph: 0 },
      { r: 0.72, w: 1.6, len: 3.4, sp: -0.006, ph: 2.1 },
      { r: 0.92, w: 1.1, len: 1.2, sp: 0.017, ph: 4.4 },
    ]) {
      const a0 = A.ph + t * A.sp * speed;
      ctx.strokeStyle = rgba(0.5 * glow);
      ctx.lineWidth = A.w;
      ctx.beginPath(); ctx.arc(cx, cy, R * A.r * breathe, a0, a0 + A.len); ctx.stroke();
    }
    // 궤도 입자
    for (const p of ORB_P) {
      p.a += p.v * speed;
      const rr = R * (p.r + 0.015 * Math.sin(t * 0.03 + p.s * 7)) * breathe;
      ctx.fillStyle = rgba(0.55 * glow);
      ctx.beginPath(); ctx.arc(cx + Math.cos(p.a) * rr, cy + Math.sin(p.a) * rr, p.s, 0, 7); ctx.fill();
    }
    // 코어 (숨쉬는 빛)
    const cr = R * 0.34 * breathe;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr * 2.4);
    g.addColorStop(0, rgba(0.65 * glow));
    g.addColorStop(0.55, rgba(0.18 * glow));
    g.addColorStop(1, rgba(0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, cr * 2.4, 0, 7); ctx.fill();
    ctx.fillStyle = rgba(0.9);
    ctx.beginPath(); ctx.arc(cx, cy, cr * 0.45, 0, 7); ctx.fill();
    }   // !vid
    // 확장 링 (pulse — 도구 실행 때 한 번씩 퍼진다)
    for (let i = rings.length - 1; i >= 0; i--) {
      const ring = rings[i];
      ring.r += R * 0.02; ring.a *= 0.94;
      if (ring.a < 0.03) { rings.splice(i, 1); continue; }
      ctx.strokeStyle = rgba(ring.a); ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(cx, cy, ring.r, 0, 7); ctx.stroke();
    }
  }

  // ---- 물리 ------------------------------------------------------
  // 반발(모든 쌍) + 링크 스프링 + 중심 인력 + 감쇠. 옵시디언 그래프와 같은 구성이다.
  function physics() {
    if (calm) {           // 대기: 힘 대신 뇌 자리로 스르륵 + 숨쉬기
      const breathe = 1 + 0.03 * Math.sin(t * 0.016);
      for (const n of nodes) {
        n.vx = n.vy = 0;
        n.x += (n.bx * breathe - n.x) * 0.045;
        n.y += (n.by * breathe - n.y) * 0.045;
      }
      // 화면 중앙·기본 배율로 천천히 복귀 (사용자가 움직이면 이미 calm 이 풀린 뒤다)
      const kT = clamp(Math.min(W, H) / 420, 0.6, 1.6);
      view.k += (kT - view.k) * 0.03;
      view.x += (W / 2 - view.x) * 0.03;
      view.y += (H / 2 - view.y) * 0.03;
      return;
    }
    const REP = 1400, SPRING = 0.018, LEN = 74, GRAV = 0.008, DAMP = 0.85;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
        if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }   // 완전 겹침 방지
        const d = Math.sqrt(d2), f = REP / d2;
        const fx = (dx / d) * f, fy = (dy / d) * f;
        a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy;
      }
    }
    for (const l of links) {
      const dx = l.b.x - l.a.x, dy = l.b.y - l.a.y;
      const d = Math.hypot(dx, dy) || 1, f = (d - LEN) * SPRING;
      const fx = (dx / d) * f, fy = (dy / d) * f;
      l.a.vx += fx; l.a.vy += fy; l.b.vx -= fx; l.b.vy -= fy;
    }
    for (const n of nodes) {
      if (n === drag) { n.vx = n.vy = 0; continue; }   // 잡고 있는 노드는 손을 따른다
      n.vx -= n.x * GRAV; n.vy -= n.y * GRAV;
      n.vx *= DAMP; n.vy *= DAMP;
      n.x += clamp(n.vx, -12, 12); n.y += clamp(n.vy, -12, 12);
    }
  }

  // ---- 그리기 ----------------------------------------------------
  const sx = (x) => x * view.k + view.x;
  const sy = (y) => y * view.k + view.y;

  function draw() {
    ctx.clearRect(0, 0, W, H);
    if (src === 'orb') return drawOrb();
    // 그래프 모드(NOTES·CODE)에선 영상 몸체를 숨기고 멈춘다 — 안 보이는 영상이 폰 배터리를 먹는다
    const v = coreVideo();
    if (v && fx && !fx.canvas.hidden) { fx.canvas.hidden = true; v.pause(); }
    const c = calmVideo();
    if (c && fx2 && !fx2.canvas.hidden) { fx2.canvas.hidden = true; c.pause(); }
    if (!nodes.length) {
      ctx.fillStyle = dark ? 'rgba(255,255,255,.35)' : 'rgba(0,0,0,.32)';
      ctx.font = '12px "IBM Plex Sans KR", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(note || '…', W / 2, H / 2);
      return;
    }

    const near = hover ? neighbors.get(hover.id) : null;
    const dim = (n) => (hover && n !== hover && !near.has(n.id) ? 0.18 : 1);

    const hsla = (h, a) => `hsla(${h},${dark ? 68 : 62}%,${dark ? 62 : 45}%,${a})`;
    const colOf = (n, al) => (n.hue == null ? rgba(al) : hsla(n.hue, al));

    // 엣지 — graphify 처럼 살짝 휜 선에, 양 끝 무리 색이 번지는 그러데이션.
    // 곡선이면 두 노드를 잇는 길이 겹쳐도 각각이 보인다(직선은 한 줄로 뭉친다).
    // 선이 많으면 그러데이션을 포기한다 — 링크마다 gradient 를 만드는 값이 비싸다.
    const 색선 = links.length <= 400;
    ctx.lineWidth = Math.max(0.7, 1.1 * view.k);
    for (const l of links) {
      const on = hover && (l.a === hover || l.b === hover);
      let alpha = (hover ? (on ? 0.75 : 0.05) : (dark ? 0.30 : 0.24));
      if (calm) alpha *= 0.45;
      const x1 = sx(l.a.x), y1 = sy(l.a.y), x2 = sx(l.b.x), y2 = sy(l.b.y);
      if (색선) {
        const g = ctx.createLinearGradient(x1, y1, x2, y2);
        g.addColorStop(0, colOf(l.a, alpha)); g.addColorStop(1, colOf(l.b, alpha));
        ctx.strokeStyle = g;
      } else ctx.strokeStyle = rgba(alpha);
      // 중점을 선에 수직으로 살짝 밀어 이차 곡선을 만든다(휨 12%)
      const dx = x2 - x1, dy = y2 - y1;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo((x1 + x2) / 2 - dy * 0.12, (y1 + y2) / 2 + dx * 0.12, x2, y2);
      ctx.stroke();
    }

    // 사고 중 신호 — 링크를 타고 흐르는 점. 선이 휘었으니 점도 같은 곡선을 탄다.
    for (const s of signals) {
      const x1 = sx(s.l.a.x), y1 = sy(s.l.a.y), x2 = sx(s.l.b.x), y2 = sy(s.l.b.y);
      const dx = x2 - x1, dy = y2 - y1;
      const cx = (x1 + x2) / 2 - dy * 0.12, cy = (y1 + y2) / 2 + dx * 0.12;
      const u = 1 - s.p;
      const x = u * u * x1 + 2 * u * s.p * cx + s.p * s.p * x2;
      const y = u * u * y1 + 2 * u * s.p * cy + s.p * s.p * y2;
      ctx.fillStyle = colOf(s.l.b, 0.95);
      ctx.beginPath(); ctx.arc(x, y, 2 * Math.max(0.7, view.k), 0, 7); ctx.fill();
    }

    // 노드 — 무리(community)마다 다른 색, 허브일수록 크고 밝게. 빛번짐은 어두울 때만(낮에는 지저분하다).
    const 빛번짐 = dark && nodes.length <= 400;
    for (const n of nodes) {
      const a = dim(n);
      const x = sx(n.x), y = sy(n.y);
      const pulse = mode === 'active' ? 1 + 0.12 * Math.sin(t * 0.09 + n.x) : 1;
      const r = n.r * view.k * pulse;
      const col = (al) => colOf(n, al);
      const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(r * 3.4, 7));
      g.addColorStop(0, col(0.34 * a)); g.addColorStop(1, col(0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, Math.max(r * 3.4, 7), 0, 7); ctx.fill();
      if (빛번짐) { ctx.shadowBlur = Math.min(22, r * 2.4); ctx.shadowColor = col(0.85 * a); }
      ctx.fillStyle = col((n === hover ? 1 : 0.85) * a);
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      ctx.shadowBlur = 0;

      // 허브는 먼저 이름이 뜬다 — 멀리서 봐도 무리의 중심이 뭔지 읽힌다(graphify 의 라벨 규칙)
      const showLabel = view.k > 0.62 || (n.deg >= 3 && view.k > 0.35);
      if (n.name && !calm && (showLabel || n === hover || (near && near.has(n.id)))) {
        ctx.fillStyle = dark ? `rgba(235,240,245,${0.72 * a})` : `rgba(20,30,40,${0.72 * a})`;
        ctx.font = `${Math.min(13, Math.max(9, 10 * view.k))}px "IBM Plex Sans KR", sans-serif`;
        ctx.textAlign = 'center';
        const label = n.name.length > 22 ? n.name.slice(0, 21) + '…' : n.name;
        ctx.fillText(label, x, y + r + 11);
      }
    }
  }

  // ⚠️ t 는 "60fps 로 세는 시계"다. 프레임마다 1 씩 올리면 화면 주사율에 끌려간다 —
  // ProMotion 120Hz 맥북에서는 심박이 **정확히 두 배**로 뛴다(2026-08-22 부장님이
  // "파파팍 튄다"고 잡아낸 그 현상: 상한 70회로 맞춰놨는데 실제로 140회가 나왔다).
  // 그래서 실제 흐른 시간으로 센다. 어떤 화면이든 분당 회수가 같아지고 상한이 지켜진다.
  let 지난시각 = 0;
  function frame(now) {
    const 밀리초 = 지난시각 ? Math.min(100, now - 지난시각) : 16.67;   // 탭 복귀 시 폭주 방지
    지난시각 = now || 0;
    t += 밀리초 / 16.67;                                              // 60fps 한 프레임 = 1
    // 대기 판정 — 작업 중(active)이거나 방금 만졌으면 절대 잠들지 않는다
    const wantCalm = mode !== 'active' && Date.now() - lastTouch > CALM_AFTER && nodes.length > 0;
    if (wantCalm && !calm) { layBrain(); calm = true; hover = null; }
    else if (!wantCalm && calm) { calm = false; }
    physics();
    // 신호 진행
    if (mode === 'active' && links.length && t % 4 === 0) spawn();
    if (calm && links.length && t % 90 === 0) spawn();   // 대기 중에도 가끔 한 점이 흐른다 — 살아있다는 표시
    for (let i = signals.length - 1; i >= 0; i--) {
      signals[i].p += signals[i].v;
      if (signals[i].p >= 1) { signals.splice(i, 1); sigCount++; }
    }
    draw();
    requestAnimationFrame(frame);
  }
  function spawn() {
    if (!links.length || signals.length > 40) return;
    signals.push({ l: links[(Math.random() * links.length) | 0], p: 0, v: 0.02 + Math.random() * 0.02 });
  }

  // ---- 조작(팬·줌·노드 끌기·호버) ---------------------------------
  const toWorld = (px, py) => [(px - view.x) / view.k, (py - view.y) / view.k];
  function pick(px, py) {
    const [wx, wy] = toWorld(px, py);
    let best = null, bd = Infinity;
    for (const n of nodes) {
      const d = Math.hypot(n.x - wx, n.y - wy);
      const hit = n.r + 8 / view.k;              // 작은 노드도 집기 쉽게 여유
      if (d < hit && d < bd) { bd = d; best = n; }
    }
    return best;
  }
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const [px, py] = pos(e);
    moved = 0;
    const n = pick(px, py);
    if (n) { drag = n; }
    else { pan = { px, py, vx: view.x, vy: view.y }; }
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', (e) => {
    const [px, py] = pos(e);
    if (drag) {
      const [wx, wy] = toWorld(px, py);
      drag.x = wx; drag.y = wy; moved++;
    } else if (pan) {
      view.x = pan.vx + (px - pan.px); view.y = pan.vy + (py - pan.py); moved++;
    } else {
      const n = pick(px, py);
      if (n !== hover) { hover = n; canvas.style.cursor = n ? 'pointer' : 'grab'; }
    }
  });
  const release = () => { drag = null; pan = null; canvas.style.cursor = hover ? 'pointer' : 'grab'; };
  canvas.addEventListener('pointerup', (e) => {
    // 끌지 않고 그냥 눌렀다 뗐으면 = 클릭. 노드면 내용 미리보기, 빈 곳이면 닫기.
    if (moved < 3) {
      const [px, py] = pos(e);
      const n = pick(px, py);
      if (n && n.name) showInfo(n, px, py); else hideInfo();
    }
    release();
  });
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', () => { hover = null; release(); });

  // ---- 노드 클릭 미리보기 -------------------------------------------
  // NOTES: 볼트의 .md 내용 앞부분. CODE: 커뮤니티·연결수·파일:줄.
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const info = document.createElement('div');
  info.className = 'ninfo hidden';
  canvas.parentElement.appendChild(info);
  info.addEventListener('pointerdown', (e) => e.stopPropagation());   // 팝업 스크롤이 팬으로 새지 않게
  function hideInfo() { info.classList.add('hidden'); }
  function placeInfo(px, py) {
    const r = canvas.getBoundingClientRect();
    info.style.left = Math.min(px + 14, r.width - 340) + 'px';
    info.style.top = Math.min(py + 10, r.height - 240) + 'px';
  }
  async function showInfo(n, px, py) {
    const conns = neighbors.get(n.id)?.size || 0;
    const meta = [n.folder, `연결 ${conns}`, n.file ? n.file + (n.loc ? ' ' + n.loc : '') : '']
      .filter(Boolean).map(esc).join(' · ');
    const isNote = src !== 'code';
    info.innerHTML = `<b>${esc(n.name)}</b><div class="ni-meta">${meta}</div>` +
      (isNote ? '<div class="ni-body">읽는 중…</div>' : '');
    placeInfo(px, py);
    info.classList.remove('hidden');
    if (!isNote) return; if (n.text) { const b0 = info.querySelector('.ni-body'); if (b0) b0.textContent = n.text; return; }
    try {
      const tok = (localStorage.getItem('sancho_token') || '').replace(/[^\x20-\x7E]/g, '');  // 헤더는 ASCII 만
      const r = await fetch('/api/file?path=' + encodeURIComponent(n.id),
        { headers: tok ? { 'x-token': tok } : {} });
      const d = await r.json();
      let t = (d.text || '');
      t = t.replace(/^---[\s\S]*?---\s*/, '');          // frontmatter 제거
      t = t.replace(/[#*`>\[\]]/g, '').replace(/\n{3,}/g, '\n\n').trim();
      const body = info.querySelector('.ni-body');
      if (body) body.textContent = t ? t.slice(0, 600) + (t.length > 600 ? ' …' : '') : (d.error || '(빈 노트)');
    } catch {
      const body = info.querySelector('.ni-body');
      if (body) body.textContent = '내용을 읽지 못했어요';
    }
  }

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [px, py] = pos(e);
    const k2 = clamp(view.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 0.2, 6);
    view.x = px - (px - view.x) * (k2 / view.k);   // 커서 위치를 기준으로 확대
    view.y = py - (py - view.y) * (k2 / view.k);
    view.k = k2;
  }, { passive: false });

  // 두 손가락 확대(아이폰·아이패드)
  const touches = new Map();
  let pinch = null;
  canvas.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') touches.set(e.pointerId, pos(e)); });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'touch' || !touches.has(e.pointerId)) return;
    touches.set(e.pointerId, pos(e));
    if (touches.size !== 2) return;
    const [p1, p2] = [...touches.values()];
    const d = Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
    const mid = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
    if (pinch) {
      const k2 = clamp(view.k * (d / pinch.d), 0.2, 6);
      view.x = mid[0] - (mid[0] - view.x) * (k2 / view.k);
      view.y = mid[1] - (mid[1] - view.y) * (k2 / view.k);
      view.k = k2;
      drag = null; pan = null;                    // 확대 중엔 끌지 않는다
    }
    pinch = { d };
  });
  const endTouch = (e) => { touches.delete(e.pointerId); if (touches.size < 2) pinch = null; };
  canvas.addEventListener('pointerup', endTouch);
  canvas.addEventListener('pointercancel', endTouch);

  // 더블클릭 — 크게 보기 토글(작은 칸에서는 그래프를 다루기 답답하다)
  canvas.addEventListener('dblclick', () => {
    const core = canvas.closest('.core');
    if (!core) return fit();
    core.classList.toggle('expanded');
    setTimeout(() => { resize(); fit(); }, 240);   // CSS 전환이 끝난 뒤 맞춘다
  });

  // ---- 외부 API(기존 유지) ----------------------------------------
  window.PAISNeural = {
    setActive() { mode = 'active'; },
    // 두뇌 통행 강도(0~1) — 상태판이 먹인다. 심박수·박동 크기가 이걸 따른다.
    setLoad(x) { loadTarget = Math.max(0, Math.min(1, Number(x) || 0)); },
    setIdle() { mode = 'idle'; },
    // 말하는 동안 오브가 목소리처럼 출렁인다 — app.js 의 TTS 가 켜고 끈다
    setTalking(on) { talking = !!on; },
    pulse() {
      if (src === 'orb') { rings.push({ r: Math.min(W, H) * 0.12, a: 0.7 }); return; }
      for (let k = 0; k < 8; k++) spawn();
    },
    refreshVault() { fetchVault(); },
    fit,
    // 폴더(무리) 필터 — hud.js 의 🛰️ 메뉴가 쓴다
    folders() {
      const all = (lastRaw?.nodes || []).map((n) => topFolder(n.folder));
      const cnt = {};
      for (const f of all) cnt[f] = (cnt[f] || 0) + 1;
      return Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([f, c]) => ({ folder: f, count: c }));
    },
    excluded: () => [...excluded],
    setExcluded(arr) {
      excluded = new Set(arr || []);
      localStorage.setItem('sancho_graph_excl', JSON.stringify([...excluded]));
      hideInfo();
      if (lastRaw) { setData(lastRaw); setTimeout(fit, 500); }
    },
    capped: () => capped,
    stats() { const n = sigCount; sigCount = 0; return { nodes: nodes.length, signals: n, active: mode === 'active', vault: nodes.length > 0 && !ghost }; },
  };

  // ORB → NOTES → CODE 전환 칩 (코어 왼쪽 위). 기본은 오브 — 그래프는 부를 때만.
  const srcBtn = document.getElementById('graphSrc');
  const SRC_ORDER = ['orb', 'vault'];
  const updateSrcBtn = () => {
    if (srcBtn) srcBtn.textContent = src === 'code' ? 'CODE' : src === 'vault' ? 'GRAPH' : 'ORB';
  };
  srcBtn && srcBtn.addEventListener('click', () => {
    src = SRC_ORDER[(SRC_ORDER.indexOf(src) + 1) % SRC_ORDER.length];
    localStorage.setItem('sancho_graph_src', src);
    updateSrcBtn();
    nodes = []; links = []; byId = new Map(); neighbors = new Map();
    signals = []; rings = []; hover = null; ghost = false; fitted = false;
    hideInfo();   // 다른 재료의 미리보기가 남지 않게
    if (src === 'orb') { note = ''; return; }   // 오브는 읽을 것이 없다
    note = '그래프를 읽는 중…';
    fetchVault();
  });
  updateSrcBtn();

  // graphify 전용 뷰어(검색·노드 정보·커뮤니티 필터) — 새 탭. 토큰은 쿼리로 넘긴다.
  const viewBtn = document.getElementById('graphViewer');
  viewBtn && viewBtn.addEventListener('click', () => {
    const tok = localStorage.getItem('sancho_token') || '';
    window.open('/api/code/viewer' + (tok ? '?token=' + encodeURIComponent(tok) : ''), '_blank');
  });

  readAccent();
  resize();
  canvas.style.cursor = 'grab';
  if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
  window.addEventListener('resize', resize);
  requestAnimationFrame(frame);
  fetchVault();
  setInterval(fetchVault, 120000);
})();
