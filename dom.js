// DOM 조립 헬퍼 — 표 그리기와 툴팁. app.js 에서 뽑아낸 2단계 조각
// (docs/web-split-plan.md). 값을 받아 컨테이너에 채워 넣는 일만 합니다.

import { escape } from "./util.js";

// 툴팁은 화면에 하나뿐인 요소를 씁니다. 이 모듈은 app.js 가 부르는 그래프
// 코드보다 먼저 평가되지만, module 스크립트는 문서 파싱 뒤에 실행되므로
// 이 시점엔 #tooltip 이 이미 있습니다(app.js 의 옛 `$("tooltip")` 와 같은 시점).
const tooltip = document.getElementById("tooltip");

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

    const head = headers.map((h, i) => {
        if (!options.sortable) return `<th>${escape(h)}</th>`;
        const active = sort && sort.key === i;
        const aria = active ? ` aria-sort="${sort.asc ? "ascending" : "descending"}"` : "";
        return `<th class="sortable" tabindex="0"${aria}>${escape(h)}</th>`;
    }).join("");

    container.innerHTML =
        `<table><thead><tr>${head}</tr></thead><tbody>` +
        rows.map((r) => "<tr>" + r.map((v) => `<td>${cell(v)}</td>`).join("") + "</tr>").join("") +
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
