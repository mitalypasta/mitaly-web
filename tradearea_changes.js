// 주변 변화 — 129_trade_area_changes.sql(api_trade_area_changes) 위의 화면.
// 상권 진단 탭(area=tradediag) 안 '주변 변화' 카드입니다.
//
// 담당자 요구 2026-09-22: "매장별 드롭다운 생성 — 인근 신규 오픈 / 폐업 등 운영중인 매장
// 매출 동향 파악. 주변상권 변화 체크 목적" → 원천은 마이프차(담당자 결정).
//
// · 마이프차에는 개업일·폐업일이 없습니다. 달마다 받은 300m 가게 목록을 전월과 맞춘
//   결과라 화면 문구는 '새로 잡힌 가게 · 사라진 가게' 입니다 — 개업·폐업으로 단정하지
//   않습니다(129 판단 [1]). 첫 대조는 두 번째 달 수집 뒤에야 생깁니다(has_prev).
// · 매장 드롭다운(#tac-store, data-sv-store-select — 전역 담당자·폐점 필터가 걸립니다)을
//   고르면 그 매장의 두 목록 + 홀매출 3개월. 안 고르면 변화 있는 매장 표(누르면 선택).
// · 홈 '알아야 할 변화' 의 '주변 상권 변화' 열이 여기로 옵니다(nav.js kind=tradechange →
//   mitaly:tradechange-store). 자료를 아직 안 받았으면 이름을 들고 있다가 받은 뒤 고릅니다.
import { db } from "./client.js";
import { escape } from "./util.js";
import { $ } from "./dom.js";
import { svFilterRows, onSvChange } from "./svfilter.js";

const man = (won) => (won == null ? "—" : Math.round(Number(won) / 10000).toLocaleString("ko-KR"));
const ymText = (ym) => `${String(ym).slice(0, 4)}-${String(ym).slice(4, 6)}`;

let data = null;
let loaded = false;
let seq = 0;
let pendingStore = "";     // 자료가 오기 전에 홈에서 넘어온 매장 이름

// 홈이 같은 응답을 씁니다 — 한 번 받은 것을 나눠 쓰고, 탭이 먼저 받았으면 그대로 돌려줍니다.
export async function fetchTradeAreaChanges(ym = null) {
    const { data: d, error } = await db.rpc("api_trade_area_changes", { p_ym: ym || null });
    if (error) return { error };
    const body = Array.isArray(d) ? d[0] : d;
    if (!body || body.ok === false) return { error: new Error((body && body.reason) || "응답 없음") };
    return { data: body };
}

// 표시할 매장 — 담당자 필터를 **세기 전에** 겁니다(svfilter 머리주석 1번 자리).
function visibleStores() {
    return svFilterRows((data && data.stores) || [], (s) => s.store_name);
}

const changed = (s) => (Number(s.n_new) || 0) + (Number(s.n_gone) || 0) > 0;

async function load(ym) {
    const my = ++seq;
    $("tac-meta").textContent = "불러오는 중…";
    const res = await fetchTradeAreaChanges(ym);
    if (my !== seq) return;
    if (res.error) {
        data = null;
        $("tac-meta").textContent = "";
        $("tac-body").hidden = true;
        $("tac-status").textContent = `주변 변화를 불러오지 못했습니다 — ${res.error.message || res.error}`;
        $("tac-status").hidden = false;
        return;
    }
    data = res.data;
    const sel = $("tac-ym");
    const yms = data.yms || [];
    sel.innerHTML = yms.map((y) =>
        `<option value="${y}"${Number(y) === Number(data.ym) ? " selected" : ""}>수집 ${ymText(y)}</option>`).join("");
    sel.disabled = yms.length < 2;
    $("tac-status").hidden = true;
    $("tac-body").hidden = false;
    fillStoreSelect();
    if (pendingStore) { selectStore(pendingStore); pendingStore = ""; }
    render();
}

function fillStoreSelect() {
    const sel = $("tac-store");
    const cur = sel.value;
    const stores = [...((data && data.stores) || [])].sort((a, b) => a.store_name.localeCompare(b.store_name, "ko"));
    sel.innerHTML = '<option value="">변화 있는 매장 전체</option>'
        + stores.map((s) => {
            const tail = changed(s) ? ` · 새 ${s.n_new} · 사라짐 ${s.n_gone}` : "";
            return `<option value="${escape(s.store_name)}" label="${escape(s.store_name + tail)}">${escape(s.store_name)}</option>`;
        }).join("");
    if (cur && [...sel.options].some((o) => o.value === cur)) sel.value = cur;
}

export function selectStore(name) {
    const sel = $("tac-store");
    if (!sel) return;
    if (!data) { pendingStore = name; return; }
    const opt = [...sel.options].find((o) => o.value === name);
    sel.value = opt ? opt.value : "";
    render();
}

function render() {
    if (!data) return;
    const stores = visibleStores();
    const withChange = stores.filter(changed);
    const nNew = withChange.reduce((a, s) => a + (Number(s.n_new) || 0), 0);
    const nGone = withChange.reduce((a, s) => a + (Number(s.n_gone) || 0), 0);
    $("tac-meta").textContent = data.has_prev
        ? `수집 ${ymText(data.ym)} · 전월 ${ymText(data.prev_ym)} 과 대조 · 매장 ${stores.length}곳`
        : `수집 ${ymText(data.ym)} · 대조할 전월 자료 없음`;

    const box = $("tac-result");
    if (!data.has_prev) {
        box.innerHTML = '<p class="tad-desc">첫 대조는 다음 달 수집 뒤에 생깁니다.</p>';
        return;
    }
    const picked = $("tac-store").value;
    const store = picked ? stores.find((s) => s.store_name === picked) : null;
    if (picked && !store) {
        box.innerHTML = '<p class="tad-desc">이 매장은 이번 달 대조에 없습니다.</p>';
        return;
    }
    if (!store) {
        box.innerHTML = summaryHtml(withChange, nNew, nGone);
        return;
    }
    box.innerHTML = storeHtml(store);
}

function summaryHtml(withChange, nNew, nGone) {
    const tiles = `<div class="kpis">
        <div class="tile"><div class="label">변화 있는 매장</div><div class="value">${withChange.length}곳</div></div>
        <div class="tile"><div class="label">새로 잡힌 가게</div><div class="value">${nNew}</div></div>
        <div class="tile"><div class="label">사라진 가게</div><div class="value">${nGone}</div></div>
    </div>`;
    if (!withChange.length) return tiles + '<p class="tad-desc">이번 달은 주변에 변화가 잡힌 매장이 없습니다.</p>';
    const rows = withChange.map((s) =>
        `<tr class="tac-row" data-store="${escape(s.store_name)}">
           <td class="tl">${escape(s.store_name)}</td>
           <td class="num">${s.n_new}</td>
           <td class="num">${s.n_gone}</td>
           <td class="tl tac-names">${escape([...(s.new || []).map((x) => x.name), ...(s.gone || []).map((x) => `${x.name}(사라짐)`)].slice(0, 4).join(" · "))}</td>
         </tr>`).join("");
    return tiles + `<div class="tablewrap"><table class="tac-table" data-sv-store-col="0">
        <thead><tr><th class="tl">매장</th><th class="num">새로 잡힘</th><th class="num">사라짐</th><th class="tl">가게</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
}

function listHtml(items, kind) {
    if (!items.length) return `<p class="tad-desc">${kind === "new" ? "새로 잡힌 가게 없음" : "사라진 가게 없음"}</p>`;
    return `<ul class="tac-list">${items.map((x) =>
        `<li><span class="tac-name">${escape(x.name)}</span>`
        + `<span class="tac-cat">${escape(x.category_raw || x.category || "")}</span>`
        + `<span class="tac-est">${x.est_sale > 0 ? `홀 추정 ${man(x.est_sale)}만` : "추정 없음"}</span></li>`).join("")}</ul>`;
}

function hallHtml(store) {
    const months = store.hall || [];
    if (!months.length) return '<p class="tad-desc">홀매출 자료 없음</p>';
    const cells = months.map((m, i) => {
        const prev = i > 0 ? Number(months[i - 1].hall) : null;
        const pct = prev > 0 ? Math.round((Number(m.hall) / prev - 1) * 100) : null;
        const cls = pct == null ? "" : pct < 0 ? " wk-down" : pct > 0 ? " wk-up" : "";
        return `<div class="tile"><div class="label">${ymText(m.ym)}</div>`
            + `<div class="value">${man(m.hall)}<span class="sv-unit">만</span></div>`
            + `<div class="sub${cls}">${pct == null ? "" : `전월 대비 ${pct > 0 ? "+" : ""}${pct}%`}</div></div>`;
    }).join("");
    return `<div class="kpis">${cells}</div>`;
}

function storeHtml(store) {
    return `<h3 class="tac-h">${escape(store.store_name)} — 새로 잡힘 ${store.n_new} · 사라짐 ${store.n_gone}</h3>
        <div class="tac-cols">
          <div><h4 class="sv-col-h">새로 잡힌 가게</h4>${listHtml(store.new || [], "new")}</div>
          <div><h4 class="sv-col-h">사라진 가게</h4>${listHtml(store.gone || [], "gone")}</div>
        </div>
        <h4 class="sv-col-h">우리 매장 홀매출 3개월</h4>
        ${hallHtml(store)}`;
}

function wire() {
    $("tac-ym").addEventListener("change", () => load(Number($("tac-ym").value) || null));
    $("tac-store").addEventListener("change", render);
    $("tac-result").addEventListener("click", (e) => {
        const tr = e.target.closest("tr.tac-row");
        if (!tr) return;
        selectStore(tr.dataset.store);
    });
    document.addEventListener("mitaly:tradechange-store", (e) => selectStore((e.detail || {}).store || ""));
    onSvChange(() => { if (data) { fillStoreSelect(); render(); } });
}

export function initTradeAreaChanges() {
    wire();
    document.addEventListener("mitaly:area-shown", (e) => {
        if ((e.detail || {}).area !== "tradediag") return;
        if (!loaded) { loaded = true; load(null); }
    });
    if (!$("tac-card").hidden && !loaded) { loaded = true; load(null); }
}
