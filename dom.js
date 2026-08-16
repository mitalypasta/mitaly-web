// DOM 조립 헬퍼 — 표 그리기와 툴팁. app.js 에서 뽑아낸 2단계 조각
// (docs/web-split-plan.md). 값을 받아 컨테이너에 채워 넣는 일만 합니다.

import { escape } from "./util.js";

// id 로 요소를 잡는 짧은 헬퍼. 화면 모듈 어디서나 씁니다.
export const $ = (id) => document.getElementById(id);

// 툴팁은 화면에 하나뿐인 요소를 씁니다. 이 모듈은 app.js 가 부르는 그래프
// 코드보다 먼저 평가되지만, module 스크립트는 문서 파싱 뒤에 실행되므로
// 이 시점엔 #tooltip 이 이미 있습니다(app.js 의 옛 `$("tooltip")` 와 같은 시점).
const tooltip = document.getElementById("tooltip");

// 열이 숫자인지 값을 보고 판정합니다 — 숫자 열만 우측 정렬하기 위한 것.
// 기본 CSS 는 둘째 열부터 전부 우측이었는데(숫자 표 기준), 제목·받는 곳·메모
// 같은 텍스트 열까지 우측에 붙어 읽기 어색했습니다(큐 #106 [F]).
//
// 셀의 본문(첫 줄)만 봅니다 — 값 밑에 붙는 <div class="meta"> 부가 정보는
// 판정에서 뺍니다(숫자 밑에 '실패 2' 가 붙어도 숫자 열).
function cellText(v) {
    return String(v ?? "")
        .replace(/<div[^>]*>[\s\S]*$/i, "")   // meta 줄 이하 제거
        .replace(/<[^>]*>/g, "")              // 남은 태그 제거
        .trim();
}

// '1,234' · '94곳' · '+3.1%' · '1.2억'(won()) · '13,500원' 등은 숫자,
// '—'·빈 값은 중립(판정에 안 씀).
const NUMERIC_CELL =
    /^[-+]?[0-9][0-9,.]*\s*(%p|%|원|억|만|천|곳|건|개|명|번|회|행|월|일)?$/;

function numericColumn(rows, index) {
    let seen = false;
    for (const r of rows) {
        const text = cellText(r[index]);
        if (!text || text === "—") continue;      // 중립 값은 판정에 안 씀
        if (!NUMERIC_CELL.test(text)) return false;
        seen = true;
    }
    return seen;
}

// options.html      셀 값을 이미 만들어진 HTML 로 넣습니다 (경고 배지 등).
//                   이 경우 값을 만드는 쪽에서 escape 책임을 집니다.
// options.sortable  헤더를 눌러 정렬할 수 있게 표시합니다.
export function table(container, headers, rows, options = {}) {
    if (!rows.length) {
        container.innerHTML = '<p class="hint">데이터가 없습니다.</p>';
        return;
    }
    const cell = options.html ? (v) => String(v ?? "") : escape;
    const sort = options.sortState;

    // 첫 열은 CSS 가 이미 좌측입니다. 둘째 열부터 숫자 열만 우측에 남기고
    // 텍스트 열은 tl 클래스로 좌측에 되돌립니다(styles.css 의 th.tl, td.tl).
    const textCol = headers.map((_, i) => i > 0 && !numericColumn(rows, i));

    const head = headers.map((h, i) => {
        const tl = textCol[i] ? "tl" : "";
        if (!options.sortable) return `<th${tl ? ` class="${tl}"` : ""}>${escape(h)}</th>`;
        const active = sort && sort.key === i;
        const aria = active ? ` aria-sort="${sort.asc ? "ascending" : "descending"}"` : "";
        return `<th class="sortable${tl ? " tl" : ""}" tabindex="0"${aria}>${escape(h)}</th>`;
    }).join("");

    container.innerHTML =
        `<table><thead><tr>${head}</tr></thead><tbody>` +
        rows.map((r) => "<tr>" + r.map((v, i) =>
            `<td${textCol[i] ? ' class="tl"' : ""}>${cell(v)}</td>`).join("") + "</tr>").join("") +
        "</tbody></table>";
}

export function showTip(event, html) {
    tooltip.innerHTML = html;
    tooltip.hidden = false;
    const box = tooltip.getBoundingClientRect();
    let left = event.clientX + 14;
    let top = event.clientY + 14;
    if (left + box.width > window.innerWidth - 8) left = event.clientX - box.width - 14;
    if (top + box.height > window.innerHeight - 8) top = event.clientY - box.height - 14;
    tooltip.style.left = `${Math.max(8, left)}px`;
    tooltip.style.top = `${Math.max(8, top)}px`;
}

export function hideTip() { tooltip.hidden = true; }

// 매장 이름 목록으로 select 를 채웁니다. allLabel 이 있으면 '전체' 항목을
// 맨 앞에 둡니다. 매장 정보·연락처 화면이 같이 씁니다.
export function fillStoreSelect(select, names, allLabel) {
    select.innerHTML = "";
    if (allLabel) {
        const o = document.createElement("option");
        o.value = ""; o.textContent = allLabel;
        select.appendChild(o);
    }
    for (const name of names || []) {
        const o = document.createElement("option");
        o.value = name; o.textContent = name;
        select.appendChild(o);
    }
}
