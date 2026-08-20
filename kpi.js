// KPI 기준 설정 (2번 영역, 88_kpi_settings.sql · 큐 #110)
//
// 가맹점 KPI관리 엑셀 05_안내의 가정값·목표·기준선을 보여주고 고칩니다.
// 값은 DB(kpi_settings)가 원본(D38)이고, 검증(범위·정수)은 서버 함수
// (set_kpi_setting)가 합니다 — 화면은 바뀐 칸만 골라 보내고 결과를 그립니다.
// 대시보드(#112)·목표 산정(#111)·주차 집계(#114)·진단(#115)이 이 값을 읽습니다.

import { escape } from "./util.js";
import { $ } from "./dom.js";
import { db } from "./client.js";

// 항목 표기는 docs/kpi-sheet-adoption.md 4절 그대로. 이름표만 여기 있고
// 값·차례·범위는 전부 서버(api_kpi_settings)에서 옵니다 — 서버에 새 항목이
// 생기면 이 표에 없어도 metric 이름 그대로 표시됩니다(빠뜨림 방지).
const KPI_LABELS = {
    week_start_dow:           ["기준",      "주 시작 요일"],
    food_cost_rate:           ["손익 가정", "식자재 원가율"],
    labor_cost_per_person:    ["손익 가정", "1인 월평균 인건비"],
    labor_rate_fallback:      ["손익 가정", "인건비율 (근무인원 없을 때)"],
    delivery_fee_rate:        ["손익 가정", "배달 수수료율"],
    royalty_ad_rate_fallback: ["손익 가정", "로열티·광고분담률"],
    utility_expense_rate:     ["손익 가정", "공과금·기타 경비율"],
    rent_rate_fallback:       ["손익 가정", "임차료율 (미입력 시)"],
    target_growth_existing:   ["목표",      "기존점 성장률"],
    target_new_store_month:   ["목표",      "신규점 월 목표"],
    kpi_min_achievement:      ["기준선",    "달성률 하한"],
    kpi_min_sales_per_person: ["기준선",    "인당 생산성 하한"],
    kpi_max_delivery_share:   ["기준선",    "배달비중 상한"],
    kpi_min_profit_rate:      ["기준선",    "영업이익률 하한"],
};

let kpiRows = [];   // api_kpi_settings 응답 (DB 차례 = 4절 표 차례)

function kpiNotice(text, isError) {
    const notice = $("kpi-set-notice");
    notice.className = isError ? "notice error" : "notice";
    notice.textContent = text;
}

function renderKpiSettings() {
    const latest = kpiRows.reduce((acc, r) =>
        (r.updated_at && (!acc || r.updated_at > acc)) ? r.updated_at : acc, null);
    $("kpi-set-meta").textContent = latest
        ? `마지막 변경 ${new Date(latest).toLocaleDateString("ko-KR")}`
        : "";

    const body = kpiRows.map((r) => {
        const [group, label] = KPI_LABELS[r.metric] || ["", r.metric];
        const range = (r.min_value != null || r.max_value != null)
            ? `${r.min_value ?? ""}~${r.max_value ?? ""}`
            : "";
        return `<tr>
            <td class="tl">${escape(group)}</td>
            <td class="tl">${escape(label)}</td>
            <td><input type="number" step="any" class="kpi-set-input"
                data-metric="${escape(r.metric)}"${range
                    ? ` min="${escape(String(r.min_value ?? ""))}"`
                      + (r.max_value != null ? ` max="${escape(String(r.max_value))}"` : "")
                    : ""}
                value="${escape(String(r.value))}"></td>
            <td class="tl">${escape(r.note || "")}</td>
        </tr>`;
    }).join("");
    // dom.js 의 table() 은 문자열 셀만 그려서 input 을 못 담습니다 — 같은
    // 마크업(thead/tbody, tl 클래스)을 직접 씁니다. 내보내기 대상도 아닙니다.
    $("t-kpi-settings").innerHTML = kpiRows.length
        ? `<table><thead><tr><th class="tl">구분</th><th class="tl">항목</th>`
          + `<th>값</th><th class="tl">설명</th></tr></thead><tbody>${body}</tbody></table>`
        : '<p class="hint">데이터가 없습니다.</p>';
}

async function refreshKpiSettings() {
    const { data, error } = await db.rpc("api_kpi_settings");
    if (error) {
        $("t-kpi-settings").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + "</p>";
        return;
    }
    kpiRows = Array.isArray(data) ? data : [];
    renderKpiSettings();
}

async function saveKpiSettings() {
    // 바뀐 칸만 보냅니다 — 전부 다시 쓰면 updated_at/updated_by 가 안 바꾼
    // 항목까지 오늘로 밀려 '언제 누가 바꿨나' 가 뭉개집니다.
    const changed = [];
    for (const input of document.querySelectorAll("#t-kpi-settings .kpi-set-input")) {
        const row = kpiRows.find((r) => r.metric === input.dataset.metric);
        if (!row) continue;
        if (input.value.trim() === "" || Number(input.value) === Number(row.value)) continue;
        changed.push({ metric: row.metric, value: Number(input.value) });
    }
    if (!changed.length) {
        kpiNotice("바뀐 값이 없습니다.", false);
        return;
    }

    const button = $("kpi-set-save");
    button.disabled = true;
    const failed = [];
    for (const { metric, value } of changed) {
        const { data, error } = await db.rpc("set_kpi_setting",
            { p_metric: metric, p_value: value });
        if (error || (data && data.ok === false)) {
            const [, label] = KPI_LABELS[metric] || [, metric];
            failed.push(`${label}: ${error ? error.message : data.reason}`);
        }
    }
    button.disabled = false;

    // 성공분이 화면·서버에서 같은 값인지 재조회로 확인합니다(실수 9 —
    // 요청이 통과했다는 것과 값이 바뀌었다는 것은 다릅니다).
    await refreshKpiSettings();
    if (failed.length) kpiNotice("저장하지 못한 항목 — " + failed.join(" · "), true);
    else kpiNotice(`${changed.length}개 항목을 저장했습니다.`, false);
}

export function initKpiSettings() {
    $("kpi-set-save").addEventListener("click", saveKpiSettings);
    refreshKpiSettings();
}
