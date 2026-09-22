// 상권 진단 — 122_store_diagnosis.sql(api_store_diagnosis) 위의 화면 (큐 #185).
// 9/16 마케팅팀 보고서(92곳 × 300m 프랜차이즈)를 매달 자동으로 보는 자리입니다.
//
// · 매장 × 두 축: 상권 크기(300m 전체 가게 홀 추정 합계) · 매장 위치(미태리 홀매출
//   ÷ 주변 가게 중앙값). 점수·등급 없이, 그 달 전 매장 중앙값으로 가른 4분면만
//   보입니다(명세 P1). 문턱은 서버(diag_rules·그 달 중앙값)가 정합니다.
// · 홀매출은 브랜드 수집월의 **전월**입니다(9/16 담당자 결정 ③) — meta 에
//   두 달을 나란히 적습니다. 마이프차 응답에는 기준월이 없어 '수집' 이라 씁니다.
// · 판정 안 한 매장(홀매출 0·주변 가게 0)은 칩이 회색 '판정 없음'(결정 ①).
// · 규칙 문장은 tradearea_diag_text.js(순수 모듈)가 만듭니다.
// · 자기 탭('상권 진단', area=tradediag — 9/17 상권 분석에서 분리)입니다.
//   조회는 그 탭에 처음 들어올 때 한 번, 달을 바꿀 때만 다시(명세 7.1).
//   담당자 전역 필터는 행을 거르고 요약·4분면도 거른 매장으로 다시 셉니다
//   (진단 카드 #115 가 세기 전에 거르는 것과 같은 규칙). 중앙값·판정 자체는
//   전 매장 기준 그대로입니다 — 담당자를 바꿔도 매장의 칸이 바뀌면 안 됩니다.
import { db } from "./client.js";
import { escape } from "./util.js";
import { $ } from "./dom.js";
import { svFilterRows, onSvChange } from "./svfilter.js";
import { diagSentences, signalLabel, signalWhy, SIGNAL_DESC } from "./tradearea_diag_text.js";
import { fetchAnalysis } from "./tradearea.js";

const QUADS = [
    // [서버 값, 칩 문구, 칩 클래스, 칸 설명]
    ["상권강·매장약", "매장 점검", "tag h-fail", "상권은 크고 미태리는 낮음"],
    ["상권강·매장강", "유지", "tag up", "상권도 크고 미태리도 높음"],
    ["상권약·매장약", "입지 한계", "tag h-warn", "상권도 작고 미태리도 낮음"],
    ["상권약·매장강", "선전", "tag st-partial", "상권은 작은데 미태리는 높음"],
];
const QUAD = new Map(QUADS.map((q) => [q[0], q]));
// 산점도 점 색 — 칩과 같은 뜻의 상태 토큰(다크에서도 토큰이 바뀝니다).
const QUAD_COLOR = {
    "상권강·매장약": "var(--status-critical)",
    "상권강·매장강": "var(--status-good)",
    "상권약·매장약": "var(--status-attn)",
    "상권약·매장강": "var(--action-primary)",
};
const CATS = ["커피", "음료·디저트", "패스트푸드", "외식", "도시락"];
// 동네 유형(127 mitaly_area_signal) — 서버 값·칩 색. 순서는 표·칸 순서. 화면 이름은
// tradearea_diag_text.js 의 SIGNAL_LABEL(서버 값은 안 바꿉니다 — data-signal 에 그대로).
const SIGNALS = [
    ["직장형만", "tag up"],
    ["둘 다", "tag"],
    ["둘 다 없음", "tag"],
    ["주거형만", "tag h-warn"],
];
const SIGNAL_CLS = new Map(SIGNALS);
const signalChip = (key) => key
    ? `<span class="${SIGNAL_CLS.get(key) || "tag"}" data-signal="${escape(key)}" title="${escape(SIGNAL_DESC[key] || "")}">${escape(signalLabel(key))}</span>`
    : "—";

// 유형 설명 한 줄 — 표지 브랜드 예시는 자료에서 뽑습니다(사전이 바뀌어도 화면이 따라오게).
function signalLegend(stores) {
    const top = (pick) => {
        const cnt = new Map();
        for (const s of stores) for (const b of (pick(s) || [])) cnt.set(b, (cnt.get(b) || 0) + 1);
        return [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([b]) => b);
    };
    const w = top((s) => s.work_brands), h = top((s) => s.home_brands);
    return `300m 안에 어떤 프랜차이즈가 있는지로 동네를 넷으로 나눕니다. `
        + `점심·직장형 표지(${w.length ? w.join("·") + " 등" : "써브웨이·투썸 등"})가 있으면 '직장', `
        + `주거·배달형 표지(${h.length ? h.join("·") + " 등" : "치킨 등"})가 있으면 '주거'입니다.`;
}

const man = (won) => (won == null ? "—" : Math.round(Number(won) / 10000).toLocaleString("ko-KR"));
const eok = (won) => (won == null ? "—" : `${(Number(won) / 1e8).toFixed(1)}억`);
const x2 = (v) => (v == null ? "—" : Number(v).toFixed(2));
const ymText = (ym) => `${String(ym).slice(0, 4)}-${String(ym).slice(4, 6)}`;
const median = (xs) => {
    const a = xs.filter((v) => v != null).map(Number).sort((p, q) => p - q);
    if (!a.length) return null;
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

let data = null;
let loaded = false;
let seq = 0;
let sortKey = "hall";
let sortAsc = false;
let quadFilter = "";
let signalFilter = "";
const open = new Set();

async function load(ym) {
    const my = ++seq;
    $("tad-meta").textContent = "불러오는 중…";
    const { data: d, error } = await db.rpc("api_store_diagnosis", { p_ym: ym || null });
    if (my !== seq) return;
    if (error || !d || d.ok === false) {
        data = null;
        $("tad-meta").textContent = "";
        $("tad-body").hidden = true;
        $("tad-status").textContent = "상권 진단을 불러오지 못했습니다"
            + (error ? ` — ${error.message}` : d && d.reason ? ` — ${d.reason}` : "");
        $("tad-status").hidden = false;
        return;
    }
    data = Array.isArray(d) ? d[0] : d;
    const sel = $("tad-ym");
    const yms = data.yms || [];
    sel.innerHTML = yms.map((y) =>
        `<option value="${y}"${Number(y) === Number(data.ym) ? " selected" : ""}>브랜드 수집 ${ymText(y)}</option>`).join("");
    sel.disabled = yms.length < 2;
    $("tad-status").hidden = true;
    $("tad-body").hidden = false;
    render();
}

function visibleStores() {
    return svFilterRows((data && data.stores) || [], (s) => s.store_name);
}

function render() {
    if (!data) return;
    const stores = visibleStores();
    const judged = stores.filter((s) => s.quad);
    $("tad-meta").textContent =
        `브랜드 수집 ${ymText(data.ym)} · 홀매출 ${ymText(data.hall_ym)} · 매장 ${stores.length}곳`;

    renderTiles(stores, judged);
    renderQuads(judged);
    renderSignals();
    renderScatter(judged);
    renderTable(stores);
}

function tile(label, value, sub) {
    return `<div class="tile"><div class="label">${escape(label)}</div>`
        + `<div class="value">${value}</div>`
        + (sub ? `<div class="sub">${escape(sub)}</div>` : "") + "</div>";
}

function renderTiles(stores, judged) {
    // 중앙값은 서버 값(전 매장 기준)을 씁니다 — 필터로 줄인 목록의 중앙값을 보이면
    // 4분면 칸을 가른 선과 타일 숫자가 달라집니다.
    $("tad-tiles").innerHTML =
        tile("판정 매장", `${judged.length}곳`, `전체 ${stores.length}곳 중`)
        + tile("상권 합계 중앙값", eok(data.S_med), "300m 전체 가게 홀 추정")
        + tile("주변 대비 미태리 중앙값", `${x2(data.ratio_med)}배`, "홀매출 ÷ 주변 가게 중앙값")
        + tile("마이프차 추정 대비 실제", `${x2(data.pos_med)}배`, `중앙값 · ${data.n_self || 0}곳`);
}

function renderQuads(judged) {
    const box = $("tad-quads");
    box.innerHTML = QUADS.map(([key, chip, cls, desc]) => {
        const rows = judged.filter((s) => s.quad === key)
            .sort((a, b) => (Number(b.hall) || 0) - (Number(a.hall) || 0));
        const hallMed = median(rows.map((s) => s.hall));
        const on = quadFilter === key;
        return `<button type="button" class="tad-quad${on ? " on" : ""}" data-quad="${escape(key)}" aria-pressed="${on}">
            <div class="tad-quad-head"><span class="${cls}">${escape(chip)}</span>
                <strong>${rows.length}곳</strong>
                <span class="tad-quad-med">미태리 중앙 ${man(hallMed)}만</span></div>
            <div class="tad-quad-desc">${escape(desc)}</div>
            <div class="tad-quad-names">${rows.map((s) => escape(s.store_name)).join(" · ") || "—"}</div>
        </button>`;
    }).join("");
}

// 동네 신호 조합 4칸 — 조합별 우리 매장 수·홀매출 중앙(서버 signal_groups, 전 매장 기준).
// 누르면 아래 목록이 그 조합 매장만 남습니다(4분면 칸과 겹쳐 걸립니다).
function renderSignals() {
    const groups = new Map((data.signal_groups || []).map((g) => [g.signal, g]));
    const legend = $("tad-signals-legend");
    if (legend) legend.textContent = signalLegend(data.stores || []);
    $("tad-signals").innerHTML = SIGNALS.map(([key]) => {
        const g = groups.get(key) || { n: 0 };
        const on = signalFilter === key;
        return `<button type="button" class="tad-quad${on ? " on" : ""}" data-signal="${escape(key)}" aria-pressed="${on}">
            <div class="tad-quad-head">${signalChip(key)}
                <strong>${g.n || 0}곳</strong>
                <span class="tad-quad-med">홀매출 중앙 ${man(g.hall_med)}만</span></div>
            <div class="tad-quad-desc">${escape(SIGNAL_DESC[key] || "")} · 절반이 ${man(g.hall_q25)}~${man(g.hall_q75)}만 사이</div>
        </button>`;
    }).join("");
}

function renderScatter(judged) {
    const svg = $("c-tad-scatter");
    const width = svg.clientWidth || 640;
    const height = 280;
    const pad = { top: 12, right: 16, bottom: 36, left: 56 };
    const pts = judged.filter((s) => Number(s.S) > 0 && Number(s.hall) > 0);
    if (!pts.length) { svg.innerHTML = ""; return; }

    // x 는 로그 눈금 — 상권 합계가 0.6억~260억으로 수백 배 벌어져, 선형이면
    // 대부분의 매장이 왼쪽 끝에 뭉칩니다.
    const lx = pts.map((s) => Math.log10(Number(s.S)));
    const xmin = Math.floor(Math.min(...lx) * 2) / 2;
    const xmax = Math.ceil(Math.max(...lx) * 2) / 2;
    // 세로 눈금은 1·2·5 × 10ⁿ 간격 — 최댓값을 그대로 4등분하면 '4,514만' 같은 눈금이 됩니다.
    const rawStep = Math.max(...pts.map((s) => Number(s.hall))) / 4;
    const mag = 10 ** Math.floor(Math.log10(rawStep));
    const step = [1, 2, 5, 10].map((k) => k * mag).find((v) => v >= rawStep);
    const ymax = Math.ceil(Math.max(...pts.map((s) => Number(s.hall))) / step) * step;
    const X = (v) => pad.left + (Math.log10(v) - xmin) / Math.max(0.1, xmax - xmin) * (width - pad.left - pad.right);
    const Y = (v) => height - pad.bottom - v / ymax * (height - pad.top - pad.bottom);

    const parts = [];
    const xticks = [];
    for (let e = Math.floor(xmin); e <= Math.ceil(xmax); e += 1) xticks.push(10 ** e, 3 * 10 ** e);
    for (const v of xticks.filter((t) => Math.log10(t) >= xmin && Math.log10(t) <= xmax)) {
        parts.push(`<line x1="${X(v)}" x2="${X(v)}" y1="${pad.top}" y2="${height - pad.bottom}" style="stroke:var(--data-grid)"/>`,
            `<text x="${X(v)}" y="${height - pad.bottom + 16}" text-anchor="middle" font-size="11" style="fill:var(--text-secondary)">${eok(v)}</text>`);
    }
    for (let v = 0; v <= ymax + 1; v += step) {
        parts.push(`<line x1="${pad.left}" x2="${width - pad.right}" y1="${Y(v)}" y2="${Y(v)}" style="stroke:var(--data-grid)"/>`,
            `<text x="${pad.left - 6}" y="${Y(v) + 4}" text-anchor="end" font-size="11" style="fill:var(--text-secondary)">${man(v)}만</text>`);
    }
    if (data.S_med > 0) {
        parts.push(`<line x1="${X(data.S_med)}" x2="${X(data.S_med)}" y1="${pad.top}" y2="${height - pad.bottom}"`
            + ` style="stroke:var(--text-muted);stroke-dasharray:4 4"/>`,
            `<text x="${X(data.S_med) + 4}" y="${pad.top + 10}" font-size="11" style="fill:var(--text-muted)">상권 중앙 ${eok(data.S_med)}</text>`);
    }
    parts.push(`<text x="${(pad.left + width - pad.right) / 2}" y="${height - 4}" text-anchor="middle" font-size="11"`
        + ` style="fill:var(--text-muted)">300m 전체 가게 홀 추정 합계 (로그 눈금)</text>`);
    for (const s of pts) {
        parts.push(`<circle cx="${X(Number(s.S)).toFixed(1)}" cy="${Y(Number(s.hall)).toFixed(1)}" r="5"`
            + ` data-store="${escape(s.store_name)}" style="fill:${QUAD_COLOR[s.quad] || "var(--text-muted)"};fill-opacity:.8;cursor:pointer">`
            + `<title>${escape(s.store_name)} · 홀 ${man(s.hall)}만 · 상권 ${eok(s.S)} · ${x2(s.ratio)}배</title></circle>`);
    }
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("height", height);
    svg.innerHTML = parts.join("");
}

const SORTS = {
    hall: (s) => Number(s.hall) || 0,
    S: (s) => Number(s.S) || 0,
    ratio: (s) => (s.ratio == null ? -1 : Number(s.ratio)),
    pos: (s) => (s.pos_ratio == null ? -1 : Number(s.pos_ratio)),
    name: (s) => s.store_name,
};

function brandTable(s) {
    const byCat = new Map(CATS.map((c) => [c, []]));
    for (const b of s.brands || []) {
        if (!byCat.has(b.category)) byCat.set(b.category, []);
        byCat.get(b.category).push(b);
    }
    const rows = [...byCat.entries()].filter(([, list]) => list.length).map(([cat, list]) =>
        `<tr><th scope="row" class="tl">${escape(cat)}</th><td class="tl">${list.map((b) =>
            `${escape(b.brand)} <span class="tad-est">${(b.est || []).map((v) => man(v)).join(" / ")}</span>`).join(" · ")}</td>`
        + `<td>${man((s.cat_sum || {})[cat])}만</td></tr>`).join("");
    if (!rows) return '<p class="hint">300m 안에 사전 브랜드가 없습니다.</p>';
    return `<table class="tad-brands"><thead><tr><th scope="col" class="tl">분류</th>`
        + `<th scope="col" class="tl">브랜드 (월 홀 추정, 만원)</th><th scope="col">합계</th></tr></thead>`
        + `<tbody>${rows}</tbody></table>`;
}

function renderTable(stores) {
    const rows = stores.filter((s) => (!quadFilter || s.quad === quadFilter)
        && (!signalFilter || s.signal === signalFilter));
    const key = SORTS[sortKey] || SORTS.hall;
    rows.sort((a, b) => {
        const va = key(a); const vb = key(b);
        const c = typeof va === "string" ? va.localeCompare(vb, "ko") : va - vb;
        return sortAsc ? c : -c;
    });
    const on = [quadFilter && QUAD.get(quadFilter)[1], signalFilter].filter(Boolean);
    $("tad-filter-note").textContent = on.length ? `${on.join(" · ")} ${rows.length}곳만 보는 중` : "";
    $("tad-filter-clear").hidden = !on.length;

    const head = [["name", "매장"], [null, "판정"], [null, "동네 유형"], ["hall", "홀매출"], ["S", "상권 합계"],
                  ["ratio", "주변 대비"], ["pos", "추정 대비"]];
    const th = head.map(([k, label], i) => {
        const cls = i < 3 ? "tl" : "";
        if (!k) return `<th scope="col" class="${cls}">${label}</th>`;
        const dir = sortKey === k ? (sortAsc ? "ascending" : "descending") : "none";
        return `<th scope="col" class="sortable ${cls}" tabindex="0" data-sort="${k}" aria-sort="${dir}">${label}</th>`;
    }).join("");

    const body = rows.map((s) => {
        const q = QUAD.get(s.quad);
        const chip = q ? `<span class="${q[2]}">${escape(q[1])}</span>` : '<span class="tag">판정 없음</span>';
        const isOpen = open.has(s.store_name);
        const lines = diagSentences(s, data).map((t) => `<li>${escape(t)}</li>`).join("");
        const top3 = (s.top3 || []).map((t) => `${escape(t.branch_name)} ${man(t.est_sale)}만`).join(" · ");
        const desc = [s.floor_group, s.trade_area_desc, s.trade_area_note].filter(Boolean).map(escape).join(" · ");
        return `<tr>
            <td class="tl"><button type="button" class="alerts-exp${isOpen ? " open" : ""}" data-exp="${escape(s.store_name)}"
                aria-expanded="${isOpen}" aria-label="${escape(s.store_name)} 진단 펼치기"></button>${escape(s.store_name)}</td>
            <td class="tl">${chip}</td>
            <td class="tl">${signalChip(s.signal)}</td>
            <td>${man(s.hall)}만</td>
            <td>${eok(s.S)}</td>
            <td>${s.ratio == null ? "—" : `${x2(s.ratio)}배`}</td>
            <td>${s.pos_ratio == null ? "—" : `${x2(s.pos_ratio)}배`}</td>
        </tr>
        <tr class="alerts-chrow tad-drow" data-parent="${escape(s.store_name)}"${isOpen ? "" : " hidden"}>
            <td class="tl" colspan="7"><div class="tad-detail">
                ${desc ? `<div class="tad-desc">${desc}</div>` : ""}
                <ul class="tad-lines">${lines}</ul>
                ${top3 ? `<div class="tad-top3">주변 매출 상위: ${top3}</div>` : ""}
                ${brandTable(s)}
            </div></td>
        </tr>`;
    }).join("");

    $("t-tad").innerHTML = rows.length
        ? `<table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`
        : '<p class="hint">해당하는 매장이 없습니다.</p>';
}

// ---- 후보지 넣어보기 (127 api_trade_area_signal) -----------------------------
// 주소 → Worker 300m(상권 분석 탭과 같은 길) → 서버가 사전과 맞춰 신호 조합을 정하고
// 같은 조합 우리 매장의 홀매출 분포를 돌려줍니다. 예측 숫자 하나는 만들지 않습니다 —
// 9/17 실측에서 위치 자료만으로 한 매장 매출을 맞히는 오차가 35% 안팎이었고, 조합별
// 분포 차이(중앙 609만~2,198만)가 그보다 훨씬 뚜렷했기 때문입니다.
let candSeq = 0;

async function runCandidate() {
    const address = $("tadc-address").value.trim();
    const box = $("tadc-result");
    if (!address) return;
    const my = ++candSeq;
    $("tadc-status").textContent = "확인 중…";
    $("tadc-status").hidden = false;
    box.hidden = true;
    const raw = await fetchAnalysis(address, 300).catch((e) => ({ ok: false, error: e.message }));
    if (my !== candSeq) return;
    if (!raw || !raw.ok) {
        $("tadc-status").textContent = `주소를 확인하지 못했습니다 — ${(raw && raw.error) || "응답 없음"}`;
        return;
    }
    if (raw.radius !== 300) {
        $("tadc-status").textContent = `반경 300m 로 받지 못했습니다(받은 반경 ${raw.radius}m).`;
        return;
    }
    const { data: r, error } = await db.rpc("api_trade_area_signal", { p_sales: raw.sales || [] });
    if (my !== candSeq) return;
    const res = Array.isArray(r) ? r[0] : r;
    if (error || !res || res.ok === false) {
        $("tadc-status").textContent = "신호를 계산하지 못했습니다" + (error ? ` — ${error.message}` : "");
        return;
    }
    $("tadc-status").hidden = true;
    box.hidden = false;
    box.innerHTML = candidateHtml(res, (raw.geo && raw.geo.address_name) || address);
}

// 후보지 결과 — 답(타일 3개) → 근거(무엇이 유형을 정했나) → 비교 표 → 비슷한 매장 순
// (web-hierarchy 답→근거→원장). 2026-09-22 담당자 "너무 보기 불편해" — 전에는 긴 문장
// 두 줄 + 표 + 나열 한 줄이라 어디가 답인지 없었습니다. 숫자는 타일에, 이유는 칩에,
// 나열은 표에 둡니다. 'S_pct' 는 우리 판정 매장 중 이 동네보다 작은 곳의 비율이라
// "상위 74%" 처럼 뒤집어 읽히기 쉬워 "작은 편 · 하위 26%" 로 씁니다.
function sizeWord(pct) {
    if (pct == null) return "";
    return pct < 34 ? "작은 편" : pct < 67 ? "중간" : "큰 편";
}

export function candidateHtml(res, where) {
    const groups = res.groups || [];
    const mine = groups.find((x) => x.signal === res.signal) || null;
    const pct = res.S_pct != null ? Number(res.S_pct) : null;
    const n = Number(res.N || 0);

    const tiles = `<div class="kpis tad-cand-tiles">
        <div class="tile"><div class="label">동네 유형</div>
            <div class="value tad-cand-signal">${signalChip(res.signal)}</div>
            <div class="sub">${escape(signalWhy(res))}</div></div>
        <div class="tile"><div class="label">같은 유형 우리 매장 홀매출</div>
            <div class="value">${mine && mine.hall_med != null ? `${man(mine.hall_med)}<span class="sv-unit">만</span>` : "—"}</div>
            <div class="sub">${mine && mine.n ? `${mine.n}곳 중앙값 · 절반이 ${man(mine.hall_q25)}~${man(mine.hall_q75)}만 사이` : "같은 유형 매장 없음"}</div></div>
        <div class="tile"><div class="label">동네 크기 (홀 추정 합계)</div>
            <div class="value">${eok(res.S)}</div>
            <div class="sub">주변 가게 ${n.toLocaleString("ko-KR")}곳${pct != null && res.n_judged ? ` · 우리 ${res.n_judged}곳 중 하위 ${pct}% (${sizeWord(pct)})` : ""}</div></div>
    </div>`;

    const rows = SIGNALS.map(([key]) => {
        const g = groups.find((x) => x.signal === key) || { n: 0 };
        const on = key === res.signal;
        return `<tr${on ? ' class="tad-cand-on"' : ""}>
            <td class="tl">${signalChip(key)}${on ? '<span class="tad-cand-here">이 자리</span>' : ""}</td>
            <td class="num">${g.n || 0}곳</td><td class="num">${man(g.hall_med)}만</td><td class="num">${man(g.hall_q25)}~${man(g.hall_q75)}만</td></tr>`;
    }).join("");
    const table = `<h3 class="tad-cand-h">유형별 우리 매장 홀매출 (${ymText(res.hall_ym)})</h3>
        <div class="tablewrap"><table class="tad-brands tad-cand-table"><thead><tr>
            <th scope="col" class="tl">동네 유형</th><th scope="col" class="num">우리 매장</th>
            <th scope="col" class="num">홀매출 중앙</th><th scope="col" class="num">절반이 드는 범위</th></tr></thead>
            <tbody>${rows}</tbody></table></div>`;

    const sim = (res.similar || []);
    const similar = sim.length ? `<h3 class="tad-cand-h">같은 유형 · 동네 크기가 가까운 우리 매장</h3>
        <div class="tablewrap"><table class="tad-brands tad-cand-similar"><thead><tr>
            <th scope="col" class="tl">매장</th><th scope="col" class="num">홀매출 ${ymText(res.hall_ym)}</th><th scope="col" class="num">동네 크기</th></tr></thead>
            <tbody>${sim.map((x) => `<tr><td class="tl">${escape(x.store_name)}</td><td class="num">${man(x.hall)}만</td><td class="num">${eok(x.S)}</td></tr>`).join("")}</tbody></table></div>` : "";

    return `<div class="tad-cand-head"><strong>${escape(where)}</strong></div>
        ${tiles}${table}${similar}
        <p class="hint">브랜드 수집 ${ymText(res.ym)} · 홀매출 ${ymText(res.hall_ym)} 기준</p>`;
}

function wire() {
    $("tad-ym").addEventListener("change", () => load(Number($("tad-ym").value)));
    $("tad-quads").addEventListener("click", (e) => {
        const b = e.target.closest("[data-quad]");
        if (!b) return;
        quadFilter = quadFilter === b.dataset.quad ? "" : b.dataset.quad;
        render();
    });
    $("tad-signals").addEventListener("click", (e) => {
        const b = e.target.closest("[data-signal]");
        if (!b) return;
        signalFilter = signalFilter === b.dataset.signal ? "" : b.dataset.signal;
        render();
    });
    $("tad-filter-clear").addEventListener("click", () => { quadFilter = ""; signalFilter = ""; render(); });
    $("tadc-run").addEventListener("click", runCandidate);
    $("tadc-address").addEventListener("keydown", (e) => { if (e.key === "Enter") runCandidate(); });
    $("c-tad-scatter").addEventListener("click", (e) => {
        const c = e.target.closest("circle[data-store]");
        if (!c) return;
        open.add(c.dataset.store);
        quadFilter = "";
        signalFilter = "";
        render();
        const btn = [...$("t-tad").querySelectorAll(".alerts-exp")].find((x) => x.dataset.exp === c.dataset.store);
        if (btn) btn.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    const box = $("t-tad");
    const sortBy = (th) => {
        const k = th.dataset.sort;
        if (sortKey === k) sortAsc = !sortAsc;
        else { sortKey = k; sortAsc = k === "name"; }
        renderTable(visibleStores());
    };
    box.addEventListener("click", (e) => {
        const th = e.target.closest("th[data-sort]");
        if (th) { sortBy(th); return; }
        const btn = e.target.closest(".alerts-exp");
        if (!btn) return;
        const name = btn.dataset.exp;
        if (open.has(name)) open.delete(name); else open.add(name);
        const on = open.has(name);
        btn.classList.toggle("open", on);
        btn.setAttribute("aria-expanded", String(on));
        box.querySelectorAll("tr.tad-drow").forEach((tr) => { tr.hidden = !open.has(tr.dataset.parent); });
    });
    box.addEventListener("keydown", (e) => {
        const th = e.target.closest("th[data-sort]");
        if (!th || (e.key !== "Enter" && e.key !== " ")) return;
        e.preventDefault();
        sortBy(th);
    });
    onSvChange(() => { if (data) render(); });
    // 탭이 처음 보일 때 폭이 생기므로 산점도는 그때 다시 그립니다.
    window.addEventListener("resize", () => { if (data && !$("tad-card").hidden) renderScatter(visibleStores().filter((s) => s.quad)); });
}

export function initTradeAreaDiag() {
    wire();
    document.addEventListener("mitaly:area-shown", (e) => {
        if ((e.detail || {}).area !== "tradediag") return;
        if (!loaded) { loaded = true; load(null); }
        else if (data) renderScatter(visibleStores().filter((s) => s.quad));
    });
    // 첫 화면이 이미 상권 진단 탭이면(새로고침) 그 area-shown 은 지나갔습니다.
    if (!$("tad-card").hidden && !loaded) { loaded = true; load(null); }
}
