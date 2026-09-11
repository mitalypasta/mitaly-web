// 전역 매장 필터 — 담당자(SV) · 운영/폐점 두 조건을 DOM 층에서 한 번에 겁니다.
//   · 담당자(SV): 카드 #168 확장 (담당자 지시 2026-09-09: "카테고리에서 매장
//     관련된 것들은 모두 담당자 필터로 볼 수 있게").
//   · 운영/폐점: 담당자 지시 2026-09-11 ("운영 중인 매장 / 폐점 매장을 구분해서
//     조회할 수 있는 기능, 매장을 검색하는 모든 플로우에서").
//     명세 docs/store-status-filter-2026-09-11.md — 139곳 중 폐점이 45곳이라
//     모든 매장 드롭다운의 3분의 1이 죽은 항목이었습니다.
//
// 상단 헤더의 선택 두 개가 모든 화면에 걸립니다. 화면마다 필터를 만들지 않고
// DOM 층에서 공통으로 좁힙니다:
//   · 매장 이름 목록인 <select> — 조건 밖 매장 항목을 숨깁니다(hidden). 고른 값이
//     담당 밖이면 '전체'(빈 값)로 되돌리고 change 를 쏴서 화면이 다시 조회합니다.
//   · '매장'(또는 '매장명'·'지점') 머리글이 있는 <table> — 담당 밖 매장 행을
//     숨깁니다. **폐점은 표에 안 겁니다** — 아래 참조.
//   · 홈의 담당자별 카드 필터(#home-sv-filter)도 같은 값으로 맞춥니다.
// 화면이 다시 그릴 때마다(표·선택기 재생성) MutationObserver 가 다시 적용합니다.
//
// 조건은 둘이고, 선택기에서는 **둘 다 통과해야** 보입니다:
//     allows(name) = svAllows(name) && statusAllows(name)
//   · svAllows     — api_store_profiles 의 sv_name 이 고른 담당자인가.
//   · statusAllows — api_store_lifecycle_status(103) 의 state 가 'closed' 가
//                    아닌가. '폐점 포함' 을 고르면 항상 통과.
//
// 폐점을 **표에는 안 거는 이유**: 표의 행을 숨기면 과거 매출이 조용히
// 사라집니다. 작년 매출을 조회하는 것은 정상적인 일이고, 담당자 지시도 "매장을
// **검색하는** 플로우" 였습니다. 담당자 필터는 성격이 달라서('내 담당이 아닌
// 것') 표에도 겁니다 — 같은 기계지만 거는 자리가 다릅니다.
//
// 폐점 조건이 **안 숨기는 것** (숨기는 실수가 더 비쌉니다):
//   · planned_close(폐점 예정) — 아직 운영 중입니다.
//   · unknown(기록 없음) — 운영 중일 수도 있는 매장을 감추는 쪽이 더 위험합니다
//     (lifecycle.js 머리: "운영/폐점 판정은 사람 몫").
//   · 상태 조회에 실패하면 아무것도 안 숨기고 컨트롤을 비활성으로 둡니다.
//   · 지금 고르고 있는 매장 — 폐점이어도 보던 화면에서 튕겨 나가지 않게.
//
// 제외 화면은 **표식으로** 정합니다 — `data-no-closed-filter` 가 달린 요소
// (또는 그 안의 select)에는 폐점 조건을 안 겁니다. id 를 여기 박아 넣으면 다음
// 사람이 못 찾습니다. 지금 붙어 있는 곳: 오픈·폐점 화면(폐점을 다루는 것이
// 본업), 매장 정보 화면(자체 상태 필터가 이미 있음). 담당자 조건은 그 화면에도
// 그대로 걸립니다 — 표식은 폐점 조건만 끕니다.
//
// 담당 배정의 원본은 store_profiles.sv_name(api_store_profiles). 프로필이 없거나
// 담당이 빈 매장은 '미배정' 으로 묶입니다. 선택은 localStorage 에 남습니다.
//
// 한계(문서 docs/sv-daily-tasks.md 6절): 표·선택기가 아닌 카드형 목록(리뷰 카드,
// 방문 이력 카드)은 그 화면의 매장 선택기로만 좁혀집니다. 서버 합계(전사 매출 등)는
// 필터와 무관합니다 — 숨긴 행의 합이 아니라 회사 전체 값입니다.

import { fetchStores } from "./client.js";

const STORAGE_KEY = "mitaly.svFilter";
const CLOSED_KEY = "mitaly.includeClosed";
const UNASSIGNED = "미배정";
const STORE_HEADERS = new Set(["매장", "매장명", "지점", "매장 이름", "가맹점", "가맹점명"]);
// 폐점 조건을 끄는 선언적 표식. 이 속성이 달린 요소 안의 select 는 담당자
// 조건만 받습니다.
const NO_CLOSED = "[data-no-closed-filter]";
// 이름에 이미 붙어 있는 폐점 꼬리 — map.js·store_dash.js 가 "(폐점)" 을 붙이고,
// 매장 이름 자체에 "(폐업)"·"(사용x)" 가 달린 곳도 있습니다(103 머리주석 [0]).
// 이미 붙어 있으면 덧붙이지 않습니다.
const CLOSED_TAIL = /(\(\s*(폐점|폐업|사용\s*x)\s*\)|[—–-]\s*폐점)\s*$/i;
const CLOSED_SUFFIX = " — 폐점";

let db = null;
let storeSv = new Map();        // 매장 이름 → 담당자
let storeState = new Map();     // 매장 이름 → 103 의 state 5값
let storeNames = new Set();     // 아는 매장 이름 전부(프로필 ∪ 상태 ∪ stores)
let svNames = [];               // 담당자 이름 목록 (미배정 제외)
let current = "";               // 선택된 담당자 ('' = 전체)
let allowed = null;             // 현재 담당의 매장 이름 Set (전체면 null)
let includeClosed = false;      // '폐점 포함' 인가
let statusOk = false;           // 상태를 실제로 받았나 — 못 받으면 안 겁니다
let storeTotal = 0;             // 전 매장 수(컨트롤의 개수 표시용)
let observer = null;
let applyTimer = 0;

export function svCurrent() { return current; }
export function closedIncluded() { return includeClosed; }

// 이름이 담당 안인가. 필터 없음 → 항상 true. 모르는 이름(매장이 아닌 값)도 true —
// 매장 select 가 아닌 것을 잘못 숨기지 않기 위해서입니다.
// ⚠️ 이 함수는 **담당자 조건만** 봅니다. 표(dom.js 의 엑셀 내보내기 포함)가
//    이것을 그대로 쓰기 때문입니다 — 폐점은 표에 안 겁니다(머리주석).
export function svAllows(name) {
    if (!allowed) return true;
    const key = normalizeStoreText(name);
    if (!key) return true;
    if (allowed.has(key)) return true;
    if (!storeSv.has(key)) return true;     // 매장 이름이 아님 → 판정 안 함
    return false;
}

// 이름이 '운영 중' 쪽인가. 상태를 못 받았거나 '폐점 포함' 이면 항상 true.
// 모르는 이름도 true — 상태를 모르는데 숨기면 매장이 통째로 사라집니다.
export function statusAllows(name) {
    if (!statusOk || includeClosed) return true;
    const key = normalizeStoreText(name);
    if (!key) return true;
    return storeState.get(key) !== "closed";
}

// 셀·옵션 글자에서 매장 이름만 남깁니다. "여수시청점 — 폐점" · "광주봉선점(폐업)"
// 같은 꼬리는 사전에 있는 이름을 앞부분 일치로 찾습니다.
function normalizeStoreText(text) {
    const t = String(text ?? "").replace(/\s+/g, " ").trim();
    if (!t) return "";
    if (storeNames.has(t)) return t;
    const head = t.split(" — ")[0].split(" · ")[0].trim();
    if (storeNames.has(head)) return head;
    // 앞부분 일치 — 가장 긴 이름
    let best = "";
    for (const name of storeNames) {
        if (t.startsWith(name) && name.length > best.length) best = name;
    }
    return best || t;
}

function selectLooksLikeStores(select) {
    const opts = [...select.options].filter((o) => o.value !== "");
    if (opts.length < 3) return false;
    let hit = 0;
    for (const o of opts) if (storeNames.has(normalizeStoreText(o.textContent))) hit += 1;
    return hit >= Math.max(3, Math.ceil(opts.length * 0.6));
}

// 폐점 매장임을 화면에만 알립니다. **textContent 는 안 건드립니다** —
// option.label 은 '보이는 글자'이고 textContent 는 값입니다(HTML 표준: label
// 속성이 있으면 브라우저가 그것을 그립니다). 매장 이름을 textContent 에서 읽어
// 서버로 보내는 코드가 있어서(방문 기록의 vs-store 등) 거기에 꼬리가 섞이면
// 조회가 통째로 어긋납니다. 검색형 콤보는 dom.js 가 label 을 그립니다.
function markClosed(option, closed) {
    const want = closed && !CLOSED_TAIL.test(option.textContent)
        ? option.textContent.trim() + CLOSED_SUFFIX : "";
    if ((option.getAttribute("label") || "") === want) return false;
    if (want) option.setAttribute("label", want);
    else option.removeAttribute("label");
    return true;
}

function applyToSelect(select) {
    if (select.id === "sv-global" || select.id === "store-closed-global") return;
    if (select.id === "home-sv-filter") return;
    if (!selectLooksLikeStores(select)) return;
    // 폐점 조건만 끄는 표식(오픈·폐점 화면, 매장 정보 화면). 담당자 조건은 걸립니다.
    const closedOff = !!select.closest(NO_CLOSED);
    // 지금 고른 항목은 미리 잡아 둡니다 — 폐점이어도 숨기지 않으려고(명세
    // '놓치기 쉬운 것' 1). 숨기면 보던 화면에서 사용자가 튕겨 나갑니다.
    const cur = select.options[select.selectedIndex] || null;
    let changed = false;
    for (const o of select.options) {
        if (o.value === "") { o.hidden = false; continue; }
        const key = normalizeStoreText(o.textContent);
        const closed = !closedOff && statusOk && storeState.get(key) === "closed";
        const hide = !svAllows(key) || (closed && !includeClosed && o !== cur);
        if (o.hidden !== hide) { o.hidden = hide; changed = true; }
        if (markClosed(o, closed)) changed = true;
    }
    if (cur && cur.hidden) {
        // 담당 밖 매장만 여기 걸립니다(폐점은 위에서 예외로 남겼습니다).
        select.value = "";
        select.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (changed && select.dataset.combo) {
        // 검색형 선택기는 목록을 자기 시점에 다시 그리므로 알림만 줍니다.
        select.dispatchEvent(new Event("mitaly:options-filtered"));
    }
}

function applyToTable(tbl) {
    // 표에는 담당자 조건만 겁니다 — 폐점 행을 숨기면 과거 매출이 조용히
    // 사라집니다(머리주석).
    const headRow = tbl.tHead ? tbl.tHead.rows[0] : tbl.rows[0];
    if (!headRow) return;
    const cells = [...headRow.cells];
    const col = cells.findIndex((c) => STORE_HEADERS.has(c.textContent.replace(/\s+/g, " ").trim()));
    const bodies = tbl.tBodies.length ? [...tbl.tBodies] : [tbl];
    for (const body of bodies) {
        for (const tr of body.rows) {
            if (tr === headRow) continue;
            // '매장' 열이 없는 표(다우 게시판 모양 등)는 행의 data-store 로 판정합니다.
            const name = col >= 0 ? (tr.cells[col] ? tr.cells[col].textContent : null) : tr.dataset.store;
            if (name == null) continue;
            const hide = !svAllows(name);
            if (tr.hidden !== hide) tr.hidden = hide;
        }
    }
}

export function applySvFilter(root = document) {
    for (const s of root.querySelectorAll("select")) applyToSelect(s);
    for (const t of root.querySelectorAll("table")) applyToTable(t);
}

function scheduleApply() {
    if (applyTimer) return;
    applyTimer = window.setTimeout(() => { applyTimer = 0; applySvFilter(); }, 120);
}

function setCurrent(sv, { silent = false } = {}) {
    current = sv || "";
    if (!current) {
        allowed = null;
    } else {
        allowed = new Set();
        for (const [name, who] of storeSv) if (who === current) allowed.add(name);
    }
    try { localStorage.setItem(STORAGE_KEY, current); } catch (e) { /* 저장 못 해도 동작 */ }
    const global = document.getElementById("sv-global");
    if (global && global.value !== current) global.value = current;
    const home = document.getElementById("home-sv-filter");
    if (home && home.value !== current && [...home.options].some((o) => o.value === current)) {
        home.value = current;
        home.dispatchEvent(new Event("change"));
    }
    applySvFilter();
    if (!silent) document.dispatchEvent(new CustomEvent("mitaly:sv-changed", { detail: { sv: current } }));
}

function setIncludeClosed(value, { silent = false } = {}) {
    includeClosed = !!value;
    try {
        localStorage.setItem(CLOSED_KEY, includeClosed ? "1" : "");
    } catch (e) { /* 저장 못 해도 동작 */ }
    const select = document.getElementById("store-closed-global");
    const want = includeClosed ? "closed" : "";
    if (select && !select.disabled && select.value !== want) select.value = want;
    applySvFilter();
    if (!silent) {
        document.dispatchEvent(new CustomEvent("mitaly:closed-changed",
            { detail: { includeClosed } }));
    }
}

function buildControl() {
    const meta = document.querySelector("header.top .meta");
    if (!meta) return;
    const anchor = meta.querySelector("#theme-toggle");
    if (!document.getElementById("sv-global")) {
        const wrap = document.createElement("label");
        wrap.className = "sv-global-wrap";
        wrap.setAttribute("data-no-closed-filter", "");   // 담당자 목록 — 매장 목록이 아닙니다
        wrap.innerHTML = '담당자 <select id="sv-global" title="담당자를 고르면 모든 화면의 매장 목록·표가 그 담당 매장으로 좁혀집니다"><option value="">전체</option></select>';
        meta.insertBefore(wrap, anchor);
        const select = wrap.querySelector("select");
        select.addEventListener("change", () => setCurrent(select.value));
    }
    if (!document.getElementById("store-closed-global")) {
        const wrap = document.createElement("label");
        wrap.className = "sv-global-wrap";
        wrap.setAttribute("data-no-closed-filter", "");   // 상태 선택기 자신
        // 개수를 항상 같이 보여 줍니다 — 필터가 걸려 있는데 그게 안 보이면
        // 사용자는 매장이 없어졌다고 생각합니다.
        wrap.innerHTML = '매장 <select id="store-closed-global" title="매장 선택기에 폐점 매장을 넣을지 정합니다. 표의 행은 그대로 나옵니다"><option value="">운영 중</option></select>';
        meta.insertBefore(wrap, anchor);
        const select = wrap.querySelector("select");
        select.addEventListener("change", () => setIncludeClosed(select.value === "closed"));
    }
}

function fillControl() {
    const select = document.getElementById("sv-global");
    if (!select) return;
    const counts = new Map();
    for (const who of storeSv.values()) counts.set(who, (counts.get(who) || 0) + 1);
    const names = [...svNames];
    if (counts.has(UNASSIGNED)) names.push(UNASSIGNED);
    select.innerHTML = '<option value="">전체</option>'
        + names.map((n) => `<option value="${n.replace(/"/g, "&quot;")}">${n} (${counts.get(n) || 0})</option>`).join("");
}

function fillClosedControl() {
    const select = document.getElementById("store-closed-global");
    if (!select) return;
    if (!statusOk) {
        // 상태를 모르면 전 매장을 보여주고 컨트롤을 잠급니다 — 모르는 채로
        // 숨기면 매장이 통째로 사라집니다.
        select.innerHTML = '<option value="closed">전체</option>';
        select.value = "closed";
        select.disabled = true;
        select.title = "매장 상태를 불러오지 못해 전 매장을 보여 줍니다";
        return;
    }
    let closed = 0;
    for (const state of storeState.values()) if (state === "closed") closed += 1;
    const total = Math.max(storeTotal, storeState.size);
    select.disabled = false;
    select.innerHTML =
        `<option value="">운영 중 ${total - closed}곳</option>`
        + `<option value="closed">폐점 포함 ${total}곳</option>`;
    select.value = includeClosed ? "closed" : "";
}

// 103 의 state 5값. 103 적용 전 환경(27 응답: status 만, 기록 있는 매장만)도
// 그리도록 status 에서 채웁니다 — lifecycle.js 와 같은 규칙.
function stateOfRow(row) {
    if (row.state) return String(row.state);
    if (row.status === "open") return "operating";
    if (row.status === "close") return "closed";
    return String(row.status || "unknown");
}

async function rpcRows(name) {
    try {
        const { data, error } = await db.rpc(name, {});
        if (error) return null;
        return Array.isArray(data) ? data : (data ? [data] : []);
    } catch (e) {
        return null;
    }
}

export async function initSvFilter(client) {
    db = client;
    buildControl();
    // 매장 목록은 client.js 가 한 번만 조회해 나눠 씁니다(추가 호출 아님).
    const [profiles, statusRows, storeRes] = await Promise.all([
        rpcRows("api_store_profiles"),
        rpcRows("api_store_lifecycle_status"),
        fetchStores().then((r) => r, () => ({ error: true })),
    ]);

    storeSv = new Map();
    const seen = new Set();
    for (const p of (profiles || [])) {
        const name = String(p.store_name || "").trim();
        if (!name) continue;
        const who = String(p.sv_name || "").trim() || UNASSIGNED;
        storeSv.set(name, who);
        if (who !== UNASSIGNED) seen.add(who);
    }
    svNames = [...seen].sort((a, b) => a.localeCompare(b, "ko"));

    storeState = new Map();
    for (const r of (statusRows || [])) {
        const name = String(r.store_name || "").trim();
        if (!name) continue;
        storeState.set(name, stateOfRow(r));
    }
    // 빈 응답은 '상태를 모른다' 로 봅니다 — 그래야 필터를 안 겁니다.
    statusOk = storeState.size > 0;

    const stores = (storeRes && !storeRes.error && Array.isArray(storeRes.data))
        ? storeRes.data : [];
    storeTotal = stores.length;

    // 아는 매장 이름 = 세 출처의 합집합. 프로필이 없는 매장도 선택기 판정
    // (selectLooksLikeStores)·이름 정리(normalizeStoreText)에 들어와야 합니다.
    storeNames = new Set();
    for (const name of storeSv.keys()) storeNames.add(name);
    for (const name of storeState.keys()) storeNames.add(name);
    for (const s of stores) {
        const name = String(s.name || "").trim();
        if (name) storeNames.add(name);
    }

    fillControl();
    fillClosedControl();

    let saved = "";
    try { saved = localStorage.getItem(STORAGE_KEY) || ""; } catch (e) { saved = ""; }
    if (saved && !svNames.includes(saved) && saved !== UNASSIGNED) saved = "";
    let savedClosed = "";
    try { savedClosed = localStorage.getItem(CLOSED_KEY) || ""; } catch (e) { savedClosed = ""; }
    setIncludeClosed(savedClosed === "1", { silent: true });
    setCurrent(saved, { silent: true });

    // 홈 카드 필터를 바꾸면 전역도 따라갑니다(둘이 같은 축).
    document.addEventListener("change", (e) => {
        if (e.target && e.target.id === "home-sv-filter" && e.target.value !== current) {
            setCurrent(e.target.value);
        }
    });

    if (!observer) {
        observer = new MutationObserver((muts) => {
            for (const m of muts) {
                if (m.type === "childList" && m.addedNodes.length) { scheduleApply(); return; }
            }
        });
        observer.observe(document.getElementById("app") || document.body, { childList: true, subtree: true });
    }
}
