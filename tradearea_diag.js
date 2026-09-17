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
// · 조회는 상권 분석 탭에 처음 들어올 때 한 번, 달을 바꿀 때만 다시(명세 7.1).
//   담당자 전역 필터는 행을 거르고 요약·4분면도 거른 매장으로 다시 셉니다
//   (진단 카드 #115 가 세기 전에 거르는 것과 같은 규칙). 중앙값·판정 자체는
//   전 매장 기준 그대로입니다 — 담당자를 바꿔도 매장의 칸이 바뀌면 안 됩니다.
import { db } from "./client.js";
import { escape } from "./util.js";
import { $ } from "./dom.js";
import { svFilterRows, onSvChange } from "./svfilter.js";
import { diagSentences } from "./tradearea_diag_text.js";

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
    const rows = stores.filter((s) => !quadFilter || s.quad === quadFilter);
    const key = SORTS[sortKey] || SORTS.hall;
    rows.sort((a, b) => {
        const va = key(a); const vb = key(b);
        const c = typeof va === "string" ? va.localeCompare(vb, "ko") : va - vb;
        return sortAsc ? c : -c;
    });
    $("tad-filter-note").textContent = quadFilter
        ? `${QUAD.get(quadFilter)[1]} ${rows.length}곳만 보는 중` : "";
    $("tad-filter-clear").hidden = !quadFilter;

    const head = [["name", "매장"], [null, "판정"], ["hall", "홀매출"], ["S", "상권 합계"],
                  ["ratio", "주변 대비"], ["pos", "추정 대비"]];
    const th = head.map(([k, label], i) => {
        const cls = i < 2 ? "tl" : "";
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
            <td>${man(s.hall)}만</td>
            <td>${eok(s.S)}</td>
            <td>${s.ratio == null ? "—" : `${x2(s.ratio)}배`}</td>
            <td>${s.pos_ratio == null ? "—" : `${x2(s.pos_ratio)}배`}</td>
        </tr>
        <tr class="alerts-chrow tad-drow" data-parent="${escape(s.store_name)}"${isOpen ? "" : " hidden"}>
            <td class="tl" colspan="6"><div class="tad-detail">
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

function wire() {
    $("tad-ym").addEventListener("change", () => load(Number($("tad-ym").value)));
    $("tad-quads").addEventListener("click", (e) => {
        const b = e.target.closest("[data-quad]");
        if (!b) return;
        quadFilter = quadFilter === b.dataset.quad ? "" : b.dataset.quad;
        render();
    });
    $("tad-filter-clear").addEventListener("click", () => { quadFilter = ""; render(); });
    $("c-tad-scatter").addEventListener("click", (e) => {
        const c = e.target.closest("circle[data-store]");
        if (!c) return;
        open.add(c.dataset.store);
        quadFilter = "";
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
        if ((e.detail || {}).area !== "tradearea") return;
        if (!loaded) { loaded = true; load(null); }
        else if (data) renderScatter(visibleStores().filter((s) => s.quad));
    });
    // 첫 화면이 이미 상권 분석 탭이면(새로고침) 그 area-shown 은 지나갔습니다.
    if (!$("tad-card").hidden && !loaded) { loaded = true; load(null); }
}
