// 매장별 일별 매출 — 120_daily_sales.sql(api_daily_sales) 위의 화면.
// (2026-09-16 담당자 지시 — "매출 탭에서 일별 매출로 볼 수 있게 하고, 매일
//  업데이트되게. 일별 매출로 꼭 볼 수 있어야 해.")
//
// · 표 = 매장 행 × 날 열(KPI 시트 03_일간 매출 입력과 같은 모양), 첫 행은 전체
//   합계. 열은 매장 · 합계 · 일평균 · 날들. 빈 칸(—)은 그날 자료가 없는 것 —
//   fact_daily 는 주문 0건 날에 행이 없어 '0건' 과 '미수집' 을 여기서는 못 가릅니다.
// · 기간은 카드가 직접 갖습니다(최근 30·60·90일 또는 달 하나, 끝 날 = 어제).
//   전역 기간 필터는 달 단위이고 기본값이 '마지막 완성월' 이라 일별을 거기 묶으면
//   늘 지난달만 보입니다 — 일별의 질문은 "요즘 매일 어떤가" 입니다. 오늘 자료는
//   새벽 사슬 전이라 없으므로 끝 날은 어제입니다. 매장·채널은 전역 필터를 따르고
//   바뀌면 다시 받습니다(전매장 현황이 기준월을 스스로 갖는 것과 같은 규칙).
// · 자료 신선도는 응답의 last_day(fact_daily 전체의 마지막 날)로 meta 에 찍습니다 —
//   사슬이 며칠 멈추면 여기서 바로 보입니다.
// · 금액 기준은 fact_daily 그대로(배달 할인 전 · 홀 할인 후 — 86·95 와 동일). 각주가
//   말합니다. db + foundation 만 import(docs/web-split-plan.md).
import { db } from "./client.js";
import { int } from "./format.js";
import { $, table, monthPicker } from "./dom.js";
import { S } from "./state.js";

const DOW = ["", "월", "화", "수", "목", "금", "토", "일"];
const DEFAULT_DAYS = 30;

let days = DEFAULT_DAYS;   // 최근 N일. 달을 고르면 0.
let ym = "";               // "202609" — 달 하나를 고른 상태(monthPicker 의 value 는 YYYYMM 문자열).
let last = null;           // 마지막 응답(jsonb 스칼라).
let seq = 0;               // 늦게 끝난 옛 조회를 버리는 차례표(app.js loadSeq 와 같은 규칙).

const iso = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const md = (s) => `${Number(String(s).slice(5, 7))}/${Number(String(s).slice(8, 10))}`;
const dowOf = (s) => { const w = new Date(`${s}T00:00:00`).getDay(); return w === 0 ? 7 : w; };

// 조회 구간 — 끝 날은 어제. 달을 골랐으면 그 달(진행 중인 달은 어제까지).
function range() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (ym) {
        const y = Number(String(ym).slice(0, 4));
        const m = Number(String(ym).slice(4, 6));
        const first = new Date(y, m - 1, 1);
        const lastOfMonth = new Date(y, m, 0);
        let end = lastOfMonth < yesterday ? lastOfMonth : yesterday;
        if (end < first) end = first;          // 매월 1일에 그 달을 고른 경우
        return { from: iso(first), to: iso(end) };
    }
    const from = new Date(yesterday);
    from.setDate(from.getDate() - (days - 1));
    return { from: iso(from), to: iso(yesterday) };
}

function dayList(from, to) {
    const out = [];
    const d = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T00:00:00`);
    while (d <= end) { out.push(iso(d)); d.setDate(d.getDate() + 1); }
    return out;
}

async function refresh() {
    const my = ++seq;
    const { from, to } = range();
    const args = { p_day_from: from, p_day_to: to,
                   p_store: $("f-store").value || null,
                   p_channel: $("f-channel").value || null };
    const r = await db.rpc("api_daily_sales", args).catch((e) => ({ error: e }));
    if (my !== seq) return;
    if (r.error) {
        $("t-daily-store").innerHTML = '<p class="hint">일별 매출을 못 받았습니다.</p>';
        $("ds-meta").textContent = "";
        return;
    }
    last = Array.isArray(r.data) ? r.data[0] : r.data;
    render();
}

function render() {
    const d = last;
    if (!d) return;
    const cols = dayList(d.day_from, d.day_to);
    const byDay = new Map((d.rows || []).map((r) => [String(r.day), r]));
    const stores = d.stores || [];

    const headers = ["매장", "합계", "일평균",
                     ...cols.map((c) => `${md(c)}(${DOW[dowOf(c)]})`)];
    const cell = (v) => (Number(v) > 0 ? int(v) : "—");

    const total = (d.rows || []).reduce((a, r) => a + (Number(r.amount) || 0), 0);
    const openDays = (d.rows || []).filter((r) => Number(r.amount) > 0).length;
    const totalRow = ["전체", cell(total),
                      openDays ? cell(Math.round(total / openDays)) : "—",
                      ...cols.map((c) => cell((byDay.get(c) || {}).amount))];
    const totalRaw = ["전체", total, openDays ? Math.round(total / openDays) : "",
                      ...cols.map((c) => Number((byDay.get(c) || {}).amount) || 0)];

    const rows = stores.map((s) => [
        s.store, cell(s.total),
        s.days_open ? cell(Math.round(Number(s.total) / Number(s.days_open))) : "—",
        ...cols.map((c) => cell((s.days || {})[c])),
    ]);
    const raw = stores.map((s) => [
        s.store, Number(s.total) || 0,
        s.days_open ? Math.round(Number(s.total) / Number(s.days_open)) : "",
        ...cols.map((c) => Number((s.days || {})[c]) || 0),
    ]);

    const tv = $("t-daily-store");
    table(tv, headers, [totalRow, ...rows],
          { export: { headers, rows: [totalRaw, ...raw] }, storeCol: 0 });
    const first = tv.querySelector("tbody tr");
    if (first) first.classList.add("ds-total");

    $("ds-meta").textContent =
        `${md(d.day_from)} ~ ${md(d.day_to)} · 매장 ${stores.length}곳`
        + (d.last_day ? ` · 자료 마지막 날 ${md(d.last_day)}` : "")
        + " · 단위 원";
    $("ds-note").textContent = "배달은 할인 전 · 홀은 할인 후 · — 는 그날 자료 없음";
}

export function initDailyStore() {
    const seg = document.querySelectorAll("#ds-range button");
    for (const b of seg) {
        b.addEventListener("click", () => {
            days = Number(b.dataset.days) || DEFAULT_DAYS;
            ym = "";
            $("ds-ym").value = "";
            for (const x of seg) x.classList.toggle("on", x === b);
            refresh();
        });
    }
    const range = S.filterRange || {};
    monthPicker("ds-ym", { min: range.min, max: range.max });
    $("ds-ym").addEventListener("change", () => {
        ym = $("ds-ym").value || "";
        if (ym) {
            days = 0;
            for (const x of seg) x.classList.remove("on");
        } else {
            days = DEFAULT_DAYS;
            for (const x of seg) x.classList.toggle("on", Number(x.dataset.days) === DEFAULT_DAYS);
        }
        refresh();
    });
    // 매장·채널은 전역 필터 — 바뀌면 이 표도 다시 받습니다.
    for (const id of ["f-store", "f-channel"]) {
        $(id).addEventListener("change", refresh);
    }
    // 담당자 필터는 표의 매장 열(data-sv-store-col)로 행을 가립니다 — 재조회 불요.
    refresh();
}
