// 전역 담당자(SV) 필터 — 카드 #168 확장 (담당자 지시 2026-09-09: "카테고리에서
// 매장 관련된 것들은 모두 담당자 필터로 볼 수 있게").
//
// 상단 헤더의 '담당자' 선택 하나가 모든 화면에 걸립니다. 화면마다 필터를 만들지
// 않고 DOM 층에서 공통으로 좁힙니다:
//   · 매장 이름 목록인 <select> — 담당 밖 매장 항목을 숨깁니다(hidden). 고른 값이
//     담당 밖이면 '전체'(빈 값)로 되돌리고 change 를 쏴서 화면이 다시 조회합니다.
//   · '매장'(또는 '매장명'·'지점') 머리글이 있는 <table> — 담당 밖 매장 행을 숨깁니다.
//   · 홈의 담당자별 카드 필터(#home-sv-filter)도 같은 값으로 맞춥니다.
// 화면이 다시 그릴 때마다(표·선택기 재생성) MutationObserver 가 다시 적용합니다.
//
// 담당 배정의 원본은 store_profiles.sv_name(api_store_profiles). 프로필이 없거나
// 담당이 빈 매장은 '미배정' 으로 묶입니다. 선택은 localStorage 에 남습니다.
//
// 한계(문서 docs/sv-daily-tasks.md 6절): 표·선택기가 아닌 카드형 목록(리뷰 카드,
// 방문 이력 카드)은 그 화면의 매장 선택기로만 좁혀집니다. 서버 합계(전사 매출 등)는
// 필터와 무관합니다 — 숨긴 행의 합이 아니라 회사 전체 값입니다.

const STORAGE_KEY = "mitaly.svFilter";
const UNASSIGNED = "미배정";
const STORE_HEADERS = new Set(["매장", "매장명", "지점", "매장 이름", "가맹점", "가맹점명"]);

let db = null;
let storeSv = new Map();        // 매장 이름 → 담당자
let svNames = [];               // 담당자 이름 목록 (미배정 제외)
let current = "";               // 선택된 담당자 ('' = 전체)
let allowed = null;             // 현재 담당의 매장 이름 Set (전체면 null)
let observer = null;
let applyTimer = 0;

export function svCurrent() { return current; }

// 이름이 담당 안인가. 필터 없음 → 항상 true. 모르는 이름(매장이 아닌 값)도 true —
// 매장 select 가 아닌 것을 잘못 숨기지 않기 위해서입니다.
export function svAllows(name) {
    if (!allowed) return true;
    const key = normalizeStoreText(name);
    if (!key) return true;
    if (allowed.has(key)) return true;
    if (!storeSv.has(key)) return true;     // 매장 이름이 아님 → 판정 안 함
    return false;
}

// 셀·옵션 글자에서 매장 이름만 남깁니다. "여수시청점 — 폐점" · "광주봉선점(폐업)"
// 같은 꼬리는 사전에 있는 이름을 앞부분 일치로 찾습니다.
function normalizeStoreText(text) {
    const t = String(text ?? "").replace(/\s+/g, " ").trim();
    if (!t) return "";
    if (storeSv.has(t)) return t;
    const head = t.split(" — ")[0].split(" · ")[0].trim();
    if (storeSv.has(head)) return head;
    // 앞부분 일치 — 가장 긴 이름
    let best = "";
    for (const name of storeSv.keys()) {
        if (t.startsWith(name) && name.length > best.length) best = name;
    }
    return best || t;
}

function selectLooksLikeStores(select) {
    const opts = [...select.options].filter((o) => o.value !== "");
    if (opts.length < 3) return false;
    let hit = 0;
    for (const o of opts) if (storeSv.has(normalizeStoreText(o.textContent))) hit += 1;
    return hit >= Math.max(3, Math.ceil(opts.length * 0.6));
}

function applyToSelect(select) {
    if (select.id === "sv-global" || select.id === "home-sv-filter") return;
    if (!selectLooksLikeStores(select)) return;
    let changed = false;
    for (const o of select.options) {
        if (o.value === "") { o.hidden = false; continue; }
        const hide = !svAllows(o.textContent);
        if (o.hidden !== hide) { o.hidden = hide; changed = true; }
    }
    const cur = select.options[select.selectedIndex];
    if (cur && cur.hidden) {
        select.value = "";
        select.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (changed && select.dataset.combo) {
        // 검색형 선택기는 목록을 자기 시점에 다시 그리므로 알림만 줍니다.
        select.dispatchEvent(new Event("mitaly:options-filtered"));
    }
}

function applyToTable(tbl) {
    const headRow = tbl.tHead ? tbl.tHead.rows[0] : tbl.rows[0];
    if (!headRow) return;
    const cells = [...headRow.cells];
    const col = cells.findIndex((c) => STORE_HEADERS.has(c.textContent.replace(/\s+/g, " ").trim()));
    if (col < 0) return;
    const bodies = tbl.tBodies.length ? [...tbl.tBodies] : [tbl];
    for (const body of bodies) {
        for (const tr of body.rows) {
            if (tr === headRow) continue;
            const cell = tr.cells[col];
            if (!cell) continue;
            const hide = !svAllows(cell.textContent);
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

function buildControl() {
    const meta = document.querySelector("header.top .meta");
    if (!meta || document.getElementById("sv-global")) return;
    const wrap = document.createElement("label");
    wrap.className = "sv-global-wrap";
    wrap.innerHTML = '담당자 <select id="sv-global" title="담당자를 고르면 모든 화면의 매장 목록·표가 그 담당 매장으로 좁혀집니다"><option value="">전체</option></select>';
    meta.insertBefore(wrap, meta.querySelector("#theme-toggle"));
    const select = wrap.querySelector("select");
    select.addEventListener("change", () => setCurrent(select.value));
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

export async function initSvFilter(client) {
    db = client;
    buildControl();
    let profiles = [];
    try {
        const { data, error } = await db.rpc("api_store_profiles", {});
        if (!error) profiles = Array.isArray(data) ? data : (data || []);
    } catch (e) { profiles = []; }
    storeSv = new Map();
    const seen = new Set();
    for (const p of profiles) {
        const name = String(p.store_name || "").trim();
        if (!name) continue;
        const who = String(p.sv_name || "").trim() || UNASSIGNED;
        storeSv.set(name, who);
        if (who !== UNASSIGNED) seen.add(who);
    }
    svNames = [...seen].sort((a, b) => a.localeCompare(b, "ko"));
    fillControl();

    let saved = "";
    try { saved = localStorage.getItem(STORAGE_KEY) || ""; } catch (e) { saved = ""; }
    if (saved && !svNames.includes(saved) && saved !== UNASSIGNED) saved = "";
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
