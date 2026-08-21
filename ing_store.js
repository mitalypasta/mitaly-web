// 매장 발주·식자재 보기 (카드 #132) — 식자재·발주 탭의 '매장 대시보드'식
// 매장 보기. 매장 1곳을 골라 그 매장의
//   · 아워홈 발주량 추이 (59_ourhome_orders — api_ourhome_orders)
//   · 월별 원가율 = 발주액 ÷ 매출 (매출은 api_monthly, 매장 필터)
//   · 이론 사용량 상위 재료 (49_ingredient_usage — api_ingredient_usage)
// 를 한 카드 묶음으로 봅니다. 전부 기존 rpc 재사용 — 새 SQL 없음.
//
// 아래 발주량(아워홈)·이론 재료 사용량 카드의 고르개(oh-store·iu-store)는
// 건드리지 않습니다 — 그 카드들이 제 필터로 다시 받게 하면 같은 조회가 두 번
// 나갑니다. 그 카드들은 전 매장 원장, 이 카드는 매장 단면입니다.
//
// 원가율 기준은 매장 대시보드(91)의 식자재율과 같습니다: 발주는 아워홈
// 본사물류 하한(VAT 포함 · 자점매입 미포함), 매출은 메뉴 매출 기준(배달
// 할인 전 · 홀 할인 후). db + foundation 만 import.

import { db, fetchStores } from "./client.js";
import { int, ymLabel, wonFull } from "./format.js";
import { escape } from "./util.js";
import { table, $, searchify } from "./dom.js";
import { palette, drawBars } from "./charts.js";

// ourhome.js 와 같은 연월 계산입니다.
const shiftYm = (ym, months) => {
    const total = Math.floor(ym / 100) * 12 + (ym % 100 - 1) + months;
    return Math.floor(total / 12) * 100 + (total % 12) + 1;
};

const pctText = (v) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);

let seq = 0;             // 늦게 끝난 옛 조회 버리기(app.js loadSeq 패턴)
let ohRange = null;      // 아워홈 자료의 전체 범위 {min, max} — 첫 응답에서 한 번
let lastBars = null;     // 마지막 차트 데이터 — 서브탭/영역 전환 재그리기용

export async function initIngStore() {
    const select = $("is-store");
    const { data: stores } = await fetchStores();
    for (const s of stores || []) {
        const opt = document.createElement("option");
        opt.value = s.name;            // 세 rpc 모두 매장 이름으로 거릅니다
        opt.textContent = s.name;
        select.append(opt);
    }
    searchify(select);
    select.addEventListener("change", refresh);

    // 숨긴 채(clientWidth=0) 그려진 차트는 fallback 폭으로 굳습니다(H2) —
    // 식자재 영역이 보이게 된 순간 폭이 어긋났으면 다시 그립니다
    // (store_dash.js 의 area-shown 처리와 같은 이유).
    document.addEventListener("mitaly:area-shown", (e) => {
        if (!lastBars || !e.detail || e.detail.area !== "ingredients") return;
        const svg = $("c-is-oh");
        if (svg.clientWidth > 0
            && Math.abs(svg.clientWidth - svg.viewBox.baseVal.width) > 2) {
            drawOrderChart();
        }
    });

    refresh();
}

function empty(message) {
    $("is-meta").textContent = "";
    $("is-kpis").innerHTML = `<div class="sd-empty">${message}</div>`;
    $("t-is-months").innerHTML = "";
    $("c-is-oh").innerHTML = "";
    $("c-is-oh").removeAttribute("height");
    $("is-note").textContent = "";
    $("t-is-usage").innerHTML = "";
    $("is-usage-note").textContent = "";
    lastBars = null;
}

async function refresh() {
    const store = $("is-store").value;
    const my = ++seq;
    if (!store) {
        empty("매장을 선택하세요 — 위 매장 칸에 이름을 치면 검색됩니다.");
        return;
    }
    $("is-meta").textContent = "불러오는 중…";

    // 자료 범위(ym_min~ym_max)는 매장과 무관한 표 전체 값이라 한 번만 받아
    // 둡니다(ourhome.js 의 ohRangeReady 와 같은 취지 — 서버 기본창은 최근
    // 1개월이라 범위만 얻는 가벼운 호출입니다).
    if (!ohRange) {
        const probe = await db.rpc("api_ourhome_orders", {});
        if (my !== seq) return;
        if (probe.error) {
            empty("불러오지 못했습니다: " + escape(probe.error.message));
            return;
        }
        const p = probe.data || {};
        if (!p.ym_min) {
            empty("아직 반입된 아워홈 발주량이 없습니다.");
            return;
        }
        ohRange = { min: p.ym_min, max: p.ym_max };
    }

    // 창: 발주 추이는 최근 12개월, 이론 사용량은 발주량 카드 기본창과 같은
    // 최근 3개월(49 설계 [3] — 두 숫자가 대조용이라 창이 같아야 맞아 보입니다).
    const to = ohRange.max;
    const from = Math.max(shiftYm(to, -11), ohRange.min);
    const iuFrom = Math.max(shiftYm(to, -2), ohRange.min);

    const [oh, mon, iu] = await Promise.all([
        db.rpc("api_ourhome_orders", { p_from: from, p_to: to, p_store: store }),
        db.rpc("api_monthly", { p_ym_from: from, p_ym_to: to,
                                p_store: store, p_channel: null }),
        db.rpc("api_ingredient_usage", { p_from: iuFrom, p_to: to, p_store: store }),
    ]);
    if (my !== seq) return;
    if (oh.error) {
        empty("불러오지 못했습니다: " + escape(oh.error.message));
        return;
    }

    render(store, from, to, iuFrom, oh.data || {},
        mon.error ? null : (mon.data || []),
        iu.error ? null : (iu.data || {}));
}

function render(store, from, to, iuFrom, oh, monthly, iu) {
    $("is-meta").textContent = `${store} · ${ymLabel(from)} ~ ${ymLabel(to)}`;

    // 매출 — 월별 홀+배달 합 (api_monthly 는 채널별 행).
    const salesByYm = new Map();
    for (const r of monthly || []) {
        salesByYm.set(r.ym, (salesByYm.get(r.ym) || 0) + (Number(r.amount) || 0));
    }
    const orderByYm = new Map(
        (oh.months || []).map((m) => [m.ym, Number(m.amount) || 0]));

    // 창 안의 달을 전부 나열합니다 — 발주만 있는 달·매출만 있는 달이 다
    // 보여야 어긋난 달(소급 미도달 등)이 눈에 걸립니다.
    const yms = [];
    for (let ym = from; ym <= to; ym = shiftYm(ym, 1)) yms.push(ym);
    const rows = yms
        .filter((ym) => orderByYm.has(ym) || salesByYm.has(ym))
        .map((ym) => {
            const order = orderByYm.get(ym);
            const sales = salesByYm.get(ym);
            const rate = order != null && sales > 0 ? order / sales : null;
            return { ym, order, sales, rate };
        });

    // 타일 — 마지막으로 발주와 매출이 둘 다 있는 달이 원가율의 기준월입니다.
    const anchor = [...rows].reverse().find((r) => r.rate != null) || null;
    const totalOrder = Number((oh.total || {}).amount) || 0;
    const usage = (iu && Array.isArray(iu.ingredients)) ? iu.ingredients : [];
    const usageCost = usage.reduce((a, r) => a + (Number(r.cost) || 0), 0);
    const cov = (iu && iu.coverage) || {};
    const covPct = cov.qty_total
        ? Math.round((1000 * cov.qty_matched) / cov.qty_total) / 10 : null;

    const tile = (label, value, sub) =>
        `<div class="tile"><div class="label">${escape(label)}</div>`
        + `<div class="value">${value}</div>`
        + (sub ? `<div class="sub">${sub}</div>` : "") + "</div>";
    $("is-kpis").innerHTML = rows.length || usage.length ? [
        tile("발주액 (아워홈)",
            anchor && anchor.order != null ? escape(wonFull(anchor.order)) : "—",
            anchor ? `${escape(ymLabel(anchor.ym))} 기준` : ""),
        tile("원가율", anchor ? escape(pctText(anchor.rate)) : "—",
            anchor ? `매출 ${escape(wonFull(anchor.sales))} (${escape(ymLabel(anchor.ym))})`
                   : "발주·매출이 같이 있는 달 없음"),
        tile("기간 발주액 합계", escape(wonFull(totalOrder)),
            `${escape(ymLabel(from))} ~ ${escape(ymLabel(to))}`),
        tile("이론 공급가 (최근 3개월)",
            usage.length ? escape(wonFull(usageCost)) : "—",
            covPct != null ? `판매 수량의 ${covPct}% 반영 (원가분석 있는 메뉴만)` : ""),
    ].join("") : `<div class="sd-empty">${escape(store)}의 발주·판매 자료가 이 기간에 없습니다.</div>`;

    // 월별 표 — 발주액·매출·원가율.
    if (rows.length) {
        table($("t-is-months"), ["월", "발주액 (아워홈)", "매출", "원가율"],
            rows.map((r) => [ymLabel(r.ym),
                r.order != null ? wonFull(r.order) : "—",
                r.sales != null ? wonFull(r.sales) : "—",
                pctText(r.rate)]));
        $("is-note").textContent =
            "원가율 = 아워홈 발주액 ÷ 매출 — 발주는 본사물류 하한(VAT 포함 · "
            + "자점매입 미포함), 매출은 메뉴 매출 기준(배달 할인 전 · 홀 할인 후)"
            + "이라 매출 소급이 닿지 않은 달은 비거나 과대일 수 있습니다.";
    } else {
        $("t-is-months").innerHTML =
            '<p class="hint">이 기간에 아워홈 발주·매출 자료가 없습니다.</p>';
        $("is-note").textContent = "";
    }

    lastBars = rows
        .filter((r) => r.order != null)
        .map((r) => ({ label: `${r.ym % 100}월`, value: r.order }));
    drawOrderChart();

    // 이론 사용량 상위 재료 — 전 재료·기간 변경은 아래 '이론 재료 사용량'
    // 카드가 원장입니다(중복 조회 방지 — 머리 주석).
    if (usage.length) {
        table($("t-is-usage"),
            ["이론 사용량 상위 재료", "이론 사용량(g·개)", "이론 공급가", "쓰는 메뉴 수"],
            usage.slice(0, 8).map((r) => [r.ingredient, int(r.amount),
                wonFull(r.cost), int(r.menus)]));
        $("is-usage-note").textContent =
            `${ymLabel(iuFrom)} ~ ${ymLabel(to)} · 이론 공급가 상위 8 — `
            + "전 재료는 아래 '이론 재료 사용량' 카드에서 봅니다.";
    } else {
        $("t-is-usage").innerHTML = "";
        $("is-usage-note").textContent = "";
    }
}

function drawOrderChart() {
    const svg = $("c-is-oh");
    if (!lastBars || !lastBars.length) {
        svg.innerHTML = "";
        svg.removeAttribute("height");
        return;
    }
    const c = palette();
    drawBars(svg, { rows: lastBars, color: c.s1, colors: c });
}
