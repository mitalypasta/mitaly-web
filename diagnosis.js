// 매장 진단 — 92_kpi_diagnosis.sql(api_kpi_diagnosis) 위의 화면 (카드 #115,
// KPI 엑셀 05_안내 진단 표 이식). 매출 영역(요약 서브탭) 카드지만 위 필터
// (기간·매장)와 무관하게 기준월 하나를 전 매장으로 봅니다 — 시트 05 가
// 그렇습니다(월 단위 진단). 문구(증상·원인·조치)는 코드에 없고 서버 규칙 표
// (kpi_diagnosis_rules)가 내려주는 것을 그대로 그립니다.
//
// 홈 화면 '진단 대상 N곳' 타일도 여기서 채웁니다 — 같은 응답(flagged)이라
// 홈이 따로 조회하지 않습니다(nav.js 의 tk-waiting 거울과 같은 이유).
//
// 카드 #141(텍스트 다이어트): 본문 행은 훑는 표로 줄이고(배지 2개 + "+N" ·
// 달성률·일평균 숫자 열 · 증상 관련 지표 · 조치 1개 + "외 N"), 원인→조치
// 전문과 전체 수치는 매장 행의 ▸ 펼침으로 옮겼습니다. 서버 문구·SQL 무변.

import { db } from "./client.js";
import { won, int, ymLabel } from "./format.js";
import { escape, monthsBetween } from "./util.js";
import { $ } from "./dom.js";
import { S } from "./state.js";

let diagData = null;   // 마지막 api_kpi_diagnosis 응답

// 심각도 → 배지 색. 기존 .tag 색 체계를 그대로 씁니다(styles.css —
// h-fail 빨강 · h-warn 호박 · 무색). 1=연속하락 2=달성률 미달 3=기준선 위반.
const SEV_CLASS = { 1: "tag h-fail", 2: "tag h-warn", 3: "tag" };

const rate = (v, digits = 1) =>
    v == null ? "—" : `${(Number(v) * 100).toFixed(digits)}%`;
const pct = (v) => v == null ? "—" : `${Number(v) > 0 ? "+" : ""}${v}%`;

// '마지막 완성 월' — 진행 중인 달이 올라와 있으면 전월(app.js loadHome 과
// 같은 규칙 · H3). 진단은 월이 닫혀야 뜻이 있어 기본값도 그 달입니다.
function defaultYm() {
    const range = S.filterRange || {};
    if (!range.max) return null;
    const t = new Date();
    const nowYm = t.getFullYear() * 100 + (t.getMonth() + 1);
    if (range.max >= nowYm && range.max > range.min) {
        const y = Math.floor(range.max / 100);
        const m = range.max % 100;
        return m === 1 ? (y - 1) * 100 + 12 : y * 100 + m - 1;
    }
    return range.max;
}

// 전체 수치 한 줄 — 카드 #141 부터 본문 행이 아니라 ▸ 펼침 행에 들어갑니다.
// 지표를 빼는 게 아니라 자리를 옮기는 것이라 구성은 그대로입니다(6개 +
// 증상 조건부 2개). 본문 행에는 달성률·일평균(공통 열)과 증상 관련 지표만.
function evidenceText(ev, symptoms) {
    const parts = [
        `달성률 ${rate(ev.achievement, 0)}`
            + (ev.target != null ? ` (목표 ${won(ev.target)} · 실적 ${won(ev.actual)})` : ""),
        `일평균 ${pct(ev.daily_mom_pct)}`
            + (ev.daily_source === "monthly" ? " (월 증감 대용)" : ""),
        `배달비중 ${rate(ev.delivery_share)}`,
        `원가율 ${rate(ev.food_rate)}`,
        `이익률 ${rate(ev.profit_rate)}`,
        `연속하락 ${int(ev.decline_months || 0)}개월`,
    ];
    // 영업일수는 r51(영업일·입력누락)의 근거라 그 증상일 때만 덧붙입니다.
    if ((symptoms || []).includes("ach_low_days") && ev.days_cur != null) {
        parts.splice(2, 0,
            `영업일 ${int(ev.days_cur)}일` +
            (ev.days_prev != null ? ` (전월 ${int(ev.days_prev)}일)` : ""));
    }
    if ((symptoms || []).includes("productivity_low") && ev.sales_per_person != null) {
        parts.push(`인당 ${won(ev.sales_per_person)} (${int(ev.staff_count)}명)`);
    }
    return parts.join(" · ");
}

// 증상 → 그 증상을 판정한 지표(시트 05 '함께 볼 지표'의 화면 대응).
// 본문 행 '관련 지표' 칸에는 이것만 올립니다. 달성률·일평균은 전 매장 공통
// 열(정렬 기준이기도 합니다)이라 여기 안 넣습니다 — 두 번 보일 이유가 없습니다.
const SYMPTOM_METRICS = {
    decline_2m:           ["decline"],
    ach_low_daily_down:   [],            // 달성률·일평균 — 공통 열이 이미 보여줌
    ach_low_days:         ["days"],
    profit_down_delivery: ["profit", "delivery"],
    productivity_low:     ["spp"],
    food_cost_up:         ["food"],
};

const METRIC_TEXT = {
    decline:  (ev) => `연속하락 ${int(ev.decline_months || 0)}개월`,
    days:     (ev) => ev.days_cur == null ? null
        : `영업일 ${int(ev.days_cur)}일`
            + (ev.days_prev != null ? ` (전월 ${int(ev.days_prev)}일)` : ""),
    delivery: (ev) => `배달비중 ${rate(ev.delivery_share)}`,
    food:     (ev) => `원가율 ${rate(ev.food_rate)}`,
    profit:   (ev) => `이익률 ${rate(ev.profit_rate)}`,
    spp:      (ev) => ev.sales_per_person == null ? null
        : `인당 ${won(ev.sales_per_person)} (${int(ev.staff_count)}명)`,
};

function relatedText(codes, ev) {
    const keys = [...new Set(codes.flatMap((c) => SYMPTOM_METRICS[c] || []))];
    return keys.map((k) => METRIC_TEXT[k](ev)).filter(Boolean).join(" · ") || "—";
}

// 펼쳐 둔 매장 — 필터·기준월을 바꿔 다시 그려도 펼침 상태를 잃지 않습니다.
const diagOpen = new Set();

function renderDiagnosis() {
    const d = diagData;
    const box = $("t-diag");
    if (!d) { box.innerHTML = '<p class="hint">아직 올라온 데이터가 없습니다.</p>'; return; }

    const rules = new Map((d.rules || []).map((r) => [r.code, r]));
    const stores = d.stores || [];
    const flagged = stores.filter((s) => (s.symptoms || []).length);
    const onlyFlagged = $("diag-only").checked;
    const rows = onlyFlagged ? flagged : stores;

    $("diag-meta").textContent =
        `진단 대상 ${int(flagged.length)}곳 / 전체 ${int(stores.length)}곳 · `
        + `${ymLabel(d.ym)} 기준 — 위 필터와 무관`;

    if (!rows.length) {
        box.innerHTML = flagged.length === 0 && stores.length > 0
            ? '<p class="hint">증상으로 판정된 매장이 없습니다.</p>'
            : '<p class="hint">아직 올라온 데이터가 없습니다.</p>';
        return;
    }

    // 서버가 이미 심각순(연속하락 > 달성률 미달 > 기준선 위반) → 달성률 낮은
    // 순으로 내려줍니다 — 여기서는 그대로 그립니다.
    //
    // 본문 행은 훑는 표(카드 #141 — "텍스트가 너무 많아"): 배지 최대 2개 +
    // "+N", 조치는 가장 심각한 증상 것 하나 + "외 N", 수치는 공통 열 2개
    // (달성률·일평균 — 정렬 기준)와 증상 관련 지표만. 원인→조치 전문과 전체
    // 수치는 ▸ 펼침 행으로(급증·급감 카드의 .alerts-exp/.alerts-chrow 문법
    // 그대로). 지운 정보는 없습니다 — 전부 펼침·title 로 옮겼을 뿐입니다.
    const badgeOf = (code) => {
        const r = rules.get(code);
        const cls = SEV_CLASS[r ? r.severity : 3] || "tag";
        return `<span class="${cls}" title="${escape(r ? r.cause : "")}">${escape(r ? r.symptom : code)}</span>`;
    };
    const symName = (code) => rules.get(code)?.symptom || code;

    const body = rows.map((s) => {
        const codes = s.symptoms || [];
        const ev = s.evidence || {};
        const open = diagOpen.has(s.store);

        const badges = codes.length
            ? codes.slice(0, 2).map(badgeOf).join(" ")
                + (codes.length > 2
                    ? ` <span class="tag" title="${escape(codes.slice(2).map(symName).join(" · "))}">+${codes.length - 2}</span>`
                    : "")
            : "—";

        // 증상 배열이 심각순(규칙 표 순서)이라 첫 조치가 가장 급한 것입니다.
        const actions = [...new Set(codes
            .map((code) => rules.get(code)?.action).filter(Boolean))];
        const actionCell = actions.length
            ? escape(actions[0]) + (actions.length > 1
                ? ` <span class="diag-more" title="${escape(actions.slice(1).join(" · "))}">외 ${actions.length - 1}</span>`
                : "")
            : "—";

        const achTitle = ev.target != null
            ? ` title="목표 ${escape(won(ev.target))} · 실적 ${escape(won(ev.actual))}"` : "";
        const dailyCell = pct(ev.daily_mom_pct)
            + (ev.daily_source === "monthly"
                ? '<span class="diag-more" title="일 단위 집계가 없어 월 증감률 대용">*</span>' : "");

        // 펼침 행 — 증상마다 원인 → 조치 전문 + 전체 수치 한 줄.
        const symLines = codes.map((code) => {
            const r = rules.get(code);
            if (!r) return `<div class="diag-detail-line">${escape(code)}</div>`;
            return `<div class="diag-detail-line">${badgeOf(code)} `
                + `${escape(r.cause)} → <strong>${escape(r.action)}</strong>`
                + ` <span class="diag-detail-ind">함께 볼 지표: ${escape(r.indicators)}</span></div>`;
        }).join("");

        return `<tr>
            <td class="tl"><button type="button" class="alerts-exp${open ? " open" : ""}"
                data-exp="${escape(s.store)}" aria-expanded="${open}"
                aria-label="진단 상세 펼치기"></button>${escape(s.store)}</td>
            <td class="tl">${badges}</td>
            <td${achTitle}>${rate(ev.achievement, 0)}</td>
            <td>${dailyCell}</td>
            <td class="tl">${escape(relatedText(codes, ev))}</td>
            <td class="tl">${actionCell}</td>
        </tr>
        <tr class="alerts-chrow diag-drow" data-parent="${escape(s.store)}"${open ? "" : " hidden"}>
            <td class="tl" colspan="6"><div class="diag-detail">${symLines}
                <div class="diag-detail-ev">${escape(evidenceText(ev, codes))}</div>
            </div></td>
        </tr>`;
    }).join("");

    // 증상 배지에 title(원인)이 붙어 dom.js 의 table() 대신 같은 마크업을
    // 직접 씁니다(kpi.js 와 같은 이유 — 문자열 셀만 받는 함수라서).
    box.innerHTML =
        `<table><thead><tr><th class="tl">매장</th><th class="tl">증상</th>`
        + `<th>달성률</th><th>일평균</th><th class="tl">관련 지표</th>`
        + `<th class="tl">조치 방향</th></tr></thead>`
        + `<tbody>${body}</tbody></table>`;

    // 행은 다시 그려도 컨테이너(t-diag)는 그대로라 위임 클릭을 한 번만 겁니다
    // (app.js drawAlerts 의 expWired 패턴).
    if (!box.dataset.expWired) {
        box.dataset.expWired = "1";
        box.addEventListener("click", (event) => {
            const button = event.target.closest(".alerts-exp");
            if (!button) return;
            const store = button.dataset.exp;
            if (diagOpen.has(store)) diagOpen.delete(store);
            else diagOpen.add(store);
            const on = diagOpen.has(store);
            button.classList.toggle("open", on);
            button.setAttribute("aria-expanded", String(on));
            box.querySelectorAll("tr.diag-drow").forEach((tr) => {
                tr.hidden = !diagOpen.has(tr.dataset.parent);
            });
        });
    }
}

async function refreshDiagnosis() {
    const ymEl = $("diag-ym");
    const ym = Number(ymEl.value);
    if (!ym) return;
    const { data, error } = await db.rpc("api_kpi_diagnosis", { p_ym: ym });
    if (error || (data && data.ok === false)) {
        $("t-diag").innerHTML = '<p class="hint">불러오지 못했습니다: '
            + escape(error ? error.message : data.reason) + "</p>";
        return;
    }
    diagData = data || null;
    renderDiagnosis();

    // 홈 타일 — 기본 기준월 조회 결과만 반영합니다(달을 바꿔 보는 것은 이
    // 카드 안의 일이고, 홈 타일은 '지금 기준월' 하나를 말해야 합니다).
    const tileValue = $("home-diag");
    if (tileValue && Number(ymEl.dataset.baseYm) === ym) {
        tileValue.textContent = int((diagData && diagData.flagged) || 0);
    }
}

export function initDiagnosis() {
    const ymEl = $("diag-ym");
    const range = S.filterRange || {};
    const base = defaultYm();
    if (!base) {
        $("t-diag").innerHTML =
            '<p class="hint">아직 올라온 데이터가 없습니다.</p>';
        return;
    }
    // 기준월 고르개 — 데이터가 실존하는 범위(api_filters)만, 최신이 먼저.
    for (const ym of monthsBetween(range.min, range.max).reverse()) {
        const option = document.createElement("option");
        option.value = String(ym);
        option.textContent = ymLabel(ym);
        ymEl.append(option);
    }
    ymEl.value = String(base);
    ymEl.dataset.baseYm = String(base);
    ymEl.addEventListener("change", refreshDiagnosis);
    $("diag-only").addEventListener("change", renderDiagnosis);
    refreshDiagnosis();
}
