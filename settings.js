// 설정 탭 — 메뉴 매핑표 편집 (96_menu_mapping.sql · 카드 #130)
//
// 통합_매핑표.xlsx 의 DB 원본(D38)을 분류 탭으로 갈라 보여주고 고칩니다.
// 검증(표준명 실재)은 서버 함수(save_menu_mapping)가 합니다 — 화면은
// 보낸 결과를 재조회로 확인해 그립니다(실수 9 — '통과' 와 '바뀜' 은 다름).
// 수집 커버리지 카드도 이 탭에 살지만 데이터는 종전대로 매출 조회 파이프라인
// (app.js load → drawCoverage)이 채웁니다 — 이 모듈은 매핑표만 맡습니다.

import { escape, debounce } from "./util.js";
import { $, searchify } from "./dom.js";
import { db } from "./client.js";

let mmStd = [];        // api_menu_mapping().std   — position 순
let mmRows = [];       // api_menu_mapping().mappings — position 순
let mmTab = null;      // 지금 열린 분류 탭
let mmLoaded = false;

// 표준명 → 분류 탭 이름. 제외/비정규는 제 탭, 표준메뉴는 대분류 탭,
// 표준메뉴에 없는 표준명(원본 xlsx 에 9건 실재)은 빌더처럼 '기타' 로 묶습니다.
function tabOf(std) {
    if (std === "제외" || std === "(제외)") return "제외";
    if (std === "비정규" || std === "(비정규)") return "비정규";
    const item = mmStd.find((s) => s.name === std);
    return item ? item.category : "기타";
}

// 탭 차례: 표준메뉴 시트의 대분류 등장 순 → 기타 → 제외 → 비정규.
function tabList() {
    const seen = [];
    for (const s of mmStd) {
        if (!seen.includes(s.category)) seen.push(s.category);
    }
    const counts = new Map();
    for (const r of mmRows) {
        const tab = tabOf(r.std);
        counts.set(tab, (counts.get(tab) || 0) + 1);
        if (!seen.includes(tab) && tab !== "제외" && tab !== "비정규" && tab !== "기타") {
            seen.push(tab);
        }
    }
    if (counts.has("기타") && !seen.includes("기타")) seen.push("기타");
    for (const special of ["제외", "비정규"]) {
        if (!seen.includes(special)) seen.push(special);
    }
    return seen.map((tab) => ({ tab, count: counts.get(tab) || 0 }));
}

function notice(text, isError) {
    const el = $("mm-notice");
    el.className = isError ? "notice error" : "notice";
    el.textContent = text;
}

function renderTabs() {
    const tabs = tabList();
    if (!tabs.some(({ tab }) => tab === mmTab)) {
        // 첫 진입은 매핑이 실제로 있는 첫 분류로 — 빈 탭에 착지하면
        // 화면이 비어 보입니다(분류 차례는 표준메뉴 시트 순서 그대로).
        const first = tabs.find(({ count }) => count > 0) || tabs[0] || {};
        mmTab = first.tab || null;
    }
    $("mm-tabs").innerHTML = tabs.map(({ tab, count }) =>
        `<button type="button" class="unitbtn${tab === mmTab ? " is-on" : ""}"`
        + ` data-mm-tab="${escape(tab)}">${escape(tab)} ${count}</button>`).join("");
}

function renderStdOptions() {
    const select = $("mm-std");
    const current = select.value;
    // 값 순서 = 고르는 순서: 표준메뉴(대시보드 차례) → 제외 → 비정규.
    select.innerHTML = '<option value=""></option>'
        + mmStd.map((s) =>
            `<option value="${escape(s.name)}">${escape(s.name)} · ${escape(s.category)}</option>`).join("")
        + '<option value="제외">제외 (매출 제외, 감시 안 함)</option>'
        + '<option value="비정규">비정규 (매출 제외 + 감시)</option>';
    if (current) select.value = current;
}

function renderTable() {
    const q = $("mm-q").value.trim().toLowerCase();
    const rows = mmRows.filter((r) => tabOf(r.std) === mmTab
        && (q === "" || r.raw.toLowerCase().includes(q)
            || r.std.toLowerCase().includes(q)));

    const body = rows.map((r) => `<tr class="mm-row" data-raw="${escape(r.raw)}"
        data-std="${escape(r.std)}">
        <td class="tl">${escape(r.raw)}</td>
        <td class="tl">${escape(r.std)}</td>
        <td class="tl">${r.updated_at
            ? escape(new Date(r.updated_at).toLocaleDateString("ko-KR")) : "—"}</td>
    </tr>`).join("");
    // dom.js table() 은 행 data 속성을 못 담아 같은 마크업을 직접 씁니다
    // (kpi.js 와 같은 이유). 행을 누르면 위 편집 폼이 채워집니다.
    $("t-mapping").innerHTML = rows.length
        ? `<table><thead><tr><th class="tl">원본표기</th><th class="tl">표준명</th>`
          + `<th class="tl">수정</th></tr></thead><tbody>${body}</tbody></table>`
        : '<p class="hint">이 분류에 해당하는 매핑이 없습니다.</p>';
}

function renderMeta() {
    const latest = mmRows.reduce((acc, r) =>
        (r.updated_at && (!acc || r.updated_at > acc)) ? r.updated_at : acc, null);
    $("mm-meta").textContent = mmRows.length
        ? `표준메뉴 ${mmStd.length} · 매핑 ${mmRows.length.toLocaleString("ko-KR")}건`
          + (latest ? ` · 마지막 변경 ${new Date(latest).toLocaleDateString("ko-KR")}` : "")
        : "";
}

function renderAll() {
    renderTabs();
    renderStdOptions();
    renderTable();
    renderMeta();
}

async function refreshMapping() {
    const { data, error } = await db.rpc("api_menu_mapping");
    if (error) {
        $("t-mapping").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + "</p>";
        return;
    }
    const payload = Array.isArray(data) ? (data[0] || {}) : (data || {});
    mmStd = payload.std || [];
    mmRows = payload.mappings || [];
    mmLoaded = true;
    renderAll();
}

async function saveMapping() {
    const raw = $("mm-raw").value.trim();
    const std = $("mm-std").value;
    if (!raw) return notice("원본표기를 입력하세요.", true);
    if (!std) return notice("표준명을 고르세요.", true);

    // '제외' 는 음식매출·로열티 집계에서 빠집니다. 담당자 원칙(2026-08-26,
    // 8/28 재확인): 매출이 찍히는 품목은 전부 표준 연결 또는 '비정규' —
    // 이미 제외인 행을 다시 저장할 때만 확인 없이 지나갑니다.
    if (std === "제외") {
        const existing = mmRows.find((r) => r.raw === raw);
        const already = existing && tabOf(existing.std) === "제외";
        if (!already && !window.confirm(
            "'제외'로 저장하면 이 품목은 매출 집계에서 빠집니다.\n"
            + "매출이 찍히는 품목은 표준 연결이나 '비정규'로 둡니다."
            + " 그래도 '제외'로 저장할까요?")) return;
    }

    const button = $("mm-save");
    button.disabled = true;
    const { data, error } = await db.rpc("save_menu_mapping",
        { p_raw: raw, p_std: std });
    button.disabled = false;
    if (error || (data && data.ok === false)) {
        return notice("저장하지 못했습니다 — "
            + (error ? error.message : data.reason), true);
    }

    // 서버가 실제로 담은 값을 재조회로 확인해 표를 다시 그립니다.
    await refreshMapping();
    // 저장한 행이 있는 탭으로 옮겨 결과가 바로 보이게 합니다.
    mmTab = tabOf(std);
    renderAll();
    notice(data.mode === "inserted"
        ? `새 매핑을 더했습니다: ${raw} → ${std}`
        : `연결을 고쳤습니다: ${raw} → ${std}`, false);
}

export function initSettings() {
    // 표준명 콤보 — 매장 콤보와 같은 문법(searchify, datalist 금지).
    const stdSelect = $("mm-std");
    stdSelect.dataset.comboPlaceholder = "표준명 검색";
    stdSelect.dataset.comboEmpty = "일치하는 표준명이 없습니다";
    searchify(stdSelect);

    $("mm-tabs").addEventListener("click", (e) => {
        const button = e.target.closest("[data-mm-tab]");
        if (!button) return;
        mmTab = button.dataset.mmTab;
        renderTabs();
        renderTable();
    });

    $("t-mapping").addEventListener("click", (e) => {
        const row = e.target.closest(".mm-row");
        if (!row) return;
        $("mm-raw").value = row.dataset.raw;
        // 괄호 표기('(제외)')는 반입 유산 — 폼 콤보 옵션은 정규형뿐이라 맞춥니다.
        $("mm-std").value = row.dataset.std.replace(/^\((제외|비정규)\)$/, "$1");
        notice("", false);
        $("mm-raw").scrollIntoView({ behavior: "smooth", block: "center" });
    });

    $("mm-q").addEventListener("input", debounce(renderTable, 150));
    $("mm-save").addEventListener("click", saveMapping);
    $("mm-clear").addEventListener("click", () => {
        $("mm-raw").value = "";
        $("mm-std").value = "";
        notice("", false);
    });

    // 설정 탭에 들어왔는데 첫 조회가 실패해 비어 있으면 다시 받습니다 —
    // 홈(loadHome)과 같은 영역 진입 갱신 문법(nav.js showArea 가 쏘는 이벤트).
    document.addEventListener("mitaly:area-shown", (e) => {
        if ((e.detail || {}).area === "settings" && !mmLoaded) refreshMapping();
    });

    refreshMapping();
}
