// 주차별 전사 매출 — 90_weekly_sales.sql(api_weekly_company) 위의 화면
// (카드 #114 — KPI 엑셀 06_주차별_매장매출 상단 이식). 매출 영역(요약 서브탭)
// 안의 카드지만 위 필터(기간·매장)와 무관하게 항상 전 매장·최근 13주입니다 —
// 시트 06 이 그렇습니다(전사 요약 줄). db + foundation 만 import.
//
// 증감 색은 KPI 시트 관례를 따릅니다: **상승 빨강 · 하락 파랑**
// (docs/kpi-sheet-adoption.md — 시트 06 의 조건부 서식 그대로).
// 기존 pct-up/pct-down(초록·빨강)은 '좋음/나쁨' 색이라 여기 쓰면 시트를
// 보던 사람이 반대로 읽습니다 — styles.css 의 wk-up/wk-down 이 이 카드 전용.

import { db } from "./client.js";
import { won, wonFull, int } from "./format.js";
import { escape } from "./util.js";
import { table, $ } from "./dom.js";

const DOW_KO = { 1: "월", 2: "화", 3: "수", 4: "목", 5: "금", 6: "토", 7: "일" };

// "2026-08-13" → "08/13". 연도는 주 시작일 열이 아니라 기간 라벨에서만 필요할
// 때 앞에 붙입니다(13주면 연 경계를 한 번쯤 넘습니다).
const md = (iso) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}`;

function wowCell(pct) {
    if (pct == null) return "—";
    const cls = pct > 0 ? "wk-up" : pct < 0 ? "wk-down" : "";
    const text = `${pct > 0 ? "+" : ""}${pct}%`;
    return cls ? `<span class="${cls}">${text}</span>` : text;
}

export async function initWeekly() {
    const { data, error } = await db.rpc("api_weekly_company", { p_weeks: 13 });
    if (error) {
        $("t-weekly").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + "</p>";
        return;
    }
    const d = data || {};
    const weeks = Array.isArray(d.weeks) ? d.weeks : [];

    if (!weeks.length) {
        $("wk-meta").textContent = "";
        $("wk-latest").textContent = "";
        $("t-weekly").innerHTML =
            '<p class="hint">아직 일 단위 집계가 없습니다.</p>';
        $("wk-note").textContent = "";
        return;
    }

    // 주 시작 요일은 설정값(kpi_settings)이라 화면도 응답으로 말합니다 —
    // '목~수' 를 박아 두면 설정을 바꾼 날 화면이 거짓말을 합니다.
    const dowStart = DOW_KO[d.week_start_dow] || "?";
    const dowEnd = DOW_KO[(((d.week_start_dow || 4) + 5) % 7) + 1] || "?";
    $("wk-meta").textContent =
        `주: ${dowStart}~${dowEnd} · 전 매장 · 최근 ${int(weeks.length)}주 — 위 필터와 무관`;

    // 최신 주 요약 줄. weeks 는 서버가 최신 주 먼저로 내려줍니다.
    const latest = weeks[0];
    $("wk-latest").innerHTML =
        `<b>${escape(latest.week_start)} ~ ${escape(md(latest.week_end))} (${escape(dowStart)}~${escape(dowEnd)})</b>`
        + ` 매출 <b>${escape(wonFull(latest.amount))}</b>`
        + ` · 전주 대비 ${wowCell(latest.wow_pct)}`
        + ` · 운영 ${escape(int(latest.store_count))}곳`
        + (latest.per_store != null ? ` · 지점당 ${escape(won(latest.per_store))}` : "");

    table($("t-weekly"),
        ["주 시작일", "매출", "전주비", "주문수", "운영 매장수", "지점당"],
        weeks.map((w) => [
            `${escape(w.week_start)} ~ ${escape(md(w.week_end))}`,
            escape(wonFull(w.amount)),
            wowCell(w.wow_pct),
            escape(int(w.orders)),
            escape(int(w.store_count)),
            w.per_store != null ? escape(won(w.per_store)) : "—",
        ]),
        { html: true,
          export: { headers: ["주 시작일", "주 종료일", "매출", "전주비(%)", "주문수", "운영 매장수", "지점당"],
                    rows: weeks.map((w) => [w.week_start, w.week_end, w.amount,
                                            w.wow_pct, w.orders, w.store_count,
                                            w.per_store]) } });

    // 데이터 출처 각주 — 일 단위 집계가 원천이고 채널 소급(#108)이 진행 중이라
    // 채널을 열거하지 않습니다(끝나면 이 문장 그대로 전 채널이 됩니다).
    $("wk-note").textContent =
        "일 단위 집계 기준 · 운영 매장수 = 그 주 매출이 있는 매장 수";
}
