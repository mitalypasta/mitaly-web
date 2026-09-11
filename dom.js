// DOM 조립 헬퍼 — 표 그리기와 툴팁. app.js 에서 뽑아낸 2단계 조각
// (docs/web-split-plan.md). 값을 받아 컨테이너에 채워 넣는 일만 합니다.
//
// 3라운드 공통(담당자 피드백 0번): 월 고르개(monthPicker) · 매장 검색 콤보
// (searchify) · 카드 표 엑셀 내보내기(table 이 자동 부착)도 여기 삽니다 —
// 전 화면이 같은 동작을 갖도록 공통 층 한 곳에만 둡니다.

import { escape } from "./util.js";
import { svAllows } from "./svfilter.js";
import { ymDash } from "./format.js";

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
// options.export    {headers, rows} — 엑셀 내보내기에 화면 표와 다른 모양을
//                   등록할 때. 묶음 보기(조리 레시피)가 씁니다: 화면에는 메뉴
//                   묶음·펼침 행, 엑셀에는 평탄한 메뉴×원료 행(거기선 반복이 정상).
export function table(container, headers, rows, options = {}) {
    const exp = options.export || { headers, rows };
    if (!rows.length) {
        container.innerHTML = '<p class="hint">데이터가 없습니다.</p>';
        registerExport(container, exp.headers, null);
        return;
    }
    registerExport(container, exp.headers,
        exp.rows && exp.rows.length ? exp.rows : null);
    const cell = options.html ? (v) => String(v ?? "") : escape;
    const sort = options.sortState;

    // 첫 열은 CSS 가 이미 좌측입니다. 둘째 열부터 숫자 열만 우측에 남기고
    // 텍스트 열은 tl 클래스로 좌측에 되돌립니다(styles.css 의 th.tl, td.tl).
    const textCol = headers.map((_, i) => i > 0 && !numericColumn(rows, i));

    // scope="col" — 스크린리더가 셀을 읽을 때 "이 값은 어느 열인가"를 붙여
    // 줍니다. 없으면 26열짜리 매장 표가 숫자 나열로만 읽힙니다(WP6 실측:
    // 저장소 전체 열 머리글 82곳 중 scope 가 붙은 것이 0곳이었음).
    const head = headers.map((h, i) => {
        const tl = textCol[i] ? "tl" : "";
        if (!options.sortable) {
            return `<th scope="col"${tl ? ` class="${tl}"` : ""}>${escape(h)}</th>`;
        }
        const active = sort && sort.key === i;
        // 정렬 안 된 열도 aria-sort="none" 을 답니다 — '지금 정렬됨' 뿐 아니라
        // '정렬할 수 있음' 도 이 속성으로 알립니다.
        const dir = active ? (sort.asc ? "ascending" : "descending") : "none";
        return `<th scope="col" class="sortable${tl ? " tl" : ""}" tabindex="0"`
            + ` aria-sort="${dir}">${escape(h)}</th>`;
    }).join("");

    container.innerHTML =
        `<table><thead><tr>${head}</tr></thead><tbody>` +
        rows.map((r) => "<tr>" + r.map((v, i) =>
            `<td${textCol[i] ? ' class="tl"' : ""}>${cell(v)}</td>`).join("") + "</tr>").join("") +
        "</tbody></table>";

    // 🔴 정렬 머리글은 tabindex="0" 이라 **Tab 은 멈추는데 Enter 로는 아무 일도
    // 안 났습니다**(부르는 쪽이 click 리스너만 답니다 — allstores.js·app.js).
    // 포커스만 받고 조작이 안 되는 것은 아예 안 받는 것보다 나쁩니다: 키보드
    // 사용자에게는 '아무것도 안 하는 정류장' 이 늘어난 것이기 때문입니다.
    // 부르는 쪽을 고치면 새 표가 또 빠뜨리므로 **표를 만드는 여기서** 잇습니다.
    if (options.sortable) {
        container.querySelectorAll("th.sortable").forEach((th) => {
            th.addEventListener("keydown", (e) => {
                if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
                e.preventDefault();        // Space 의 기본 동작은 스크롤
                th.click();
            });
        });
    }
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

// ---------------------------------------------------------------- 월 고르개
//
// select 드롭다운 대신 브라우저 달력(input[type=month])을 씁니다(3라운드 0-1).
// 화면 코드는 지금까지 select.value 를 'YYYYMM' 정수 문자열로 읽고 써 왔으므로
// (currentFilters 의 Number(...), map.js 등), input 의 value 접근자를 요소
// 단위로 가로채 바깥에는 계속 'YYYYMM' 으로 보이게 합니다. 이렇게 하면 값을
// 읽는 쪽(다른 라운드 에이전트의 영역 파일 포함)을 한 줄도 안 고쳐도 됩니다.
const MONTH_VALUE =
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");

export function monthPicker(target, range = {}) {
    const input = typeof target === "string" ? $(target) : target;
    if (!input) return null;
    if (!input.dataset.ymWired) {
        input.dataset.ymWired = "1";
        Object.defineProperty(input, "value", {
            get() {
                const v = MONTH_VALUE.get.call(this);
                return v ? v.replace("-", "") : "";
            },
            set(v) {
                MONTH_VALUE.set.call(this, v ? ymDash(v) : "");
            },
        });
        // 달을 지워 버리면 조회가 0/NaN 기간으로 나갑니다 — 마지막으로
        // 골랐던 달을 되살리고 change 를 다시 알려 화면을 맞춥니다.
        input.addEventListener("change", () => {
            if (input.value) {
                input.dataset.last = input.value;
            } else if (input.dataset.last) {
                input.value = input.dataset.last;
                input.dispatchEvent(new Event("change", { bubbles: true }));
            }
        });
    }
    // 달력에서 고를 수 있는 범위 = 데이터가 실제로 있는 범위.
    if (range.min) input.min = ymDash(range.min);
    if (range.max) input.max = ymDash(range.max);
    return input;
}

// ---------------------------------------------------------------- 매장 검색 콤보
//
// 매장 select 를 검색+드롭다운 콤보로 바꿉니다(3라운드 0-2 → 2026-08-21
// 직접 그린 목록으로 교체).
// select 는 숨긴 채 값의 원본으로 남습니다 — 옵션을 채우는 코드(fillStoreSelect
// ·각 영역의 append)와 값을 읽는 코드(.value·.options·selectedOptions)가
// 전부 그대로 동작하고, 콤보는 select 를 비추기만 합니다.
// 옵션의 value 와 표시 이름이 달라도(v-store 등 id 기반 select) 이름으로
// 찾아 value 로 되돌립니다.
let comboSeq = 0;
const SELECT_VALUE =
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");

export function searchify(target) {
    const select = typeof target === "string" ? $(target) : target;
    if (!select || select.tagName !== "SELECT" || select.dataset.combo) return select;
    select.dataset.combo = "1";

    // 2026-08-21 담당자 지시("드롭다운도 되게") — 브라우저 datalist 를 버리고
    // 목록을 직접 그립니다. datalist 는 ① 크롬에서 칸을 눌러도 안 열리고(오른쪽
    // 작은 ▼ 만 연다) ② 크롬 비밀번호 자동완성이 목록을 가로챕니다(담당자
    // 실화면 재현). 직접 그린 목록은 누르면 열리고, 치면 걸러지고, 키보드
    // (↑↓·Enter·Esc)로도 고릅니다. select 는 그대로 값의 원본입니다.
    const id = ++comboSeq;
    const wrap = document.createElement("span");
    wrap.className = "combo-wrap";
    const input = document.createElement("input");
    input.type = "search";                 // 크롬이 아이디 칸으로 오인하지 않게
    input.name = `store-search-${id}`;
    input.className = "combo";
    input.autocomplete = "off";
    input.setAttribute("data-lpignore", "true");     // LastPass 류 무시 표식
    input.setAttribute("data-form-type", "other");   // Dashlane 류
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    const pop = document.createElement("div");
    pop.className = "combo-pop";
    pop.hidden = true;
    // 🔴 목록 상자는 `max-height + overflow:auto` 라 크롬이 **스크롤 그릇을
    // 탭 정류장으로 잡습니다**(키보드로 스크롤하라고 만든 기능). 그런데 이
    // 콤보는 입력칸이 blur 되는 순간 목록을 숨기므로, Tab 한 번이 사라진 그릇
    // 위에서 증발해 포커스가 <body> 로 떨어졌습니다 — 매장 검색 콤보 26곳
    // 전부에서 "Tab 을 눌렀는데 아무 데도 안 가는" 한 번이 생깁니다(WP6 실측).
    // 목록 이동은 이미 ↑↓ 가 하므로 순차 이동에서만 뺍니다.
    pop.tabIndex = -1;
    const ul = document.createElement("ul");
    ul.setAttribute("role", "listbox");
    ul.id = `combo-list-${id}`;
    input.setAttribute("aria-controls", ul.id);
    // 이름 — 원본 select 는 aria-hidden 이라 그 label 이 콤보에는 안 닿습니다.
    // 그대로 두면 이 입력칸의 이름이 placeholder 뿐인데, 글자를 치는 순간
    // placeholder 가 사라져 '무엇을 고르는 칸인지' 를 잃습니다(WP6).
    const labelText = (document.querySelector(`label[for="${select.id}"]`)?.textContent
        || select.getAttribute("aria-label") || "").trim();
    if (labelText) input.setAttribute("aria-label", labelText);
    pop.append(ul);
    wrap.append(input, pop);
    select.after(wrap);
    select.hidden = true;
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");

    // 전역 매장 필터(svfilter.js)가 숨긴 항목은 목록에서도 뺍니다.
    const options = () => [...select.options].filter((o) => !o.hidden);
    // 보이는 글자는 label — HTML 표준대로 label 속성이 있으면 그것, 없으면 본문.
    // svfilter.js 가 폐점 매장에 label 로 ' — 폐점' 을 답니다(textContent 는
    // 매장 이름 그대로 둡니다 — 그 값을 서버로 보내는 코드가 있어서).
    const shownText = (o) => o.label || o.textContent;
    const showSelected = () => {
        const cur = SELECT_VALUE.get.call(select);
        const opt = options().find((o) => o.value === cur);
        input.value = opt && opt.value !== "" ? shownText(opt) : "";
    };
    const refreshPlaceholder = () => {
        const blank = options().find((o) => o.value === "");
        // '전체'류 항목이 있으면 빈 입력 = 그 항목. 자리 문구로 보여 줍니다.
        // 매장이 아닌 select(설정 탭 표준명 등)는 data-combo-placeholder /
        // data-combo-empty 로 제 문구를 줍니다 — 기본값은 종전 그대로.
        input.placeholder = blank ? shownText(blank)
            : (select.dataset.comboPlaceholder || "매장 검색");
        showSelected();
    };
    new MutationObserver(() => { refreshPlaceholder(); if (!pop.hidden) renderList(); })
        .observe(select, { childList: true, subtree: true, characterData: true });
    // 숨김(hidden)·폐점 표시(label)는 **속성** 변경이라 위 옵저버가 못 봅니다.
    // svfilter.js 가 다시 걸 때마다 이 신호를 줍니다.
    select.addEventListener("mitaly:options-filtered", () => {
        // 치는 중이면 입력칸은 안 건드리고 목록만 다시 그립니다 — 글자가
        // 지워지면 사용자가 검색을 처음부터 다시 해야 합니다.
        if (document.activeElement !== input) refreshPlaceholder();
        if (!pop.hidden) renderList();
    });
    refreshPlaceholder();

    // 코드가 select.value = ... 로 값을 바꿔도(홈 타일 이동·입금 채우기 등)
    // 콤보 표시가 따라오도록 접근자를 요소 단위로 가로챕니다.
    Object.defineProperty(select, "value", {
        get() { return SELECT_VALUE.get.call(this); },
        set(v) { SELECT_VALUE.set.call(this, v); showSelected(); },
    });

    let active = -1;          // 목록에서 하이라이트된 줄
    let shown = [];           // 지금 목록에 그려진 옵션들

    const choose = (opt) => {
        input.value = opt.value === "" ? "" : shownText(opt);
        close();
        if (SELECT_VALUE.get.call(select) !== opt.value) {
            SELECT_VALUE.set.call(select, opt.value);
            select.dispatchEvent(new Event("change", { bubbles: true }));
        }
    };

    const renderList = () => {
        const q = input.value.trim().toLowerCase();
        const cur = SELECT_VALUE.get.call(select);
        shown = options().filter((o) =>
            q === "" || o.value === "" || shownText(o).toLowerCase().includes(q));
        // 빈 값('전체'류)은 입력이 비어 있을 때만 — 검색 중엔 결과만 보입니다.
        if (q !== "") shown = shown.filter((o) => o.value !== "");
        ul.innerHTML = shown.length
            ? shown.map((o, i) =>
                `<li role="option" id="${ul.id}-${i}" data-i="${i}"`
                + ` aria-selected="${o.value === cur}"`
                + ` class="${o.value === cur ? "is-cur" : ""}`
                + `${o.value === "" ? " is-blank" : ""}">${escape(shownText(o))}</li>`).join("")
            : `<li class="is-empty">${escape(
                select.dataset.comboEmpty || "일치하는 매장이 없습니다")}</li>`;
        active = shown.length ? Math.max(0, shown.findIndex((o) => o.value === cur)) : -1;
        if (q !== "" && shown.length) active = 0;
        paintActive();
    };
    const paintActive = () => {
        ul.querySelectorAll("li[role=option]").forEach((li, i) => {
            li.classList.toggle("is-active", i === active);
            if (i === active) li.scrollIntoView({ block: "nearest" });
        });
        // ↑↓ 로 옮긴 줄은 색만 바뀌고 스크린리더에는 아무 말도 없었습니다.
        // 포커스는 입력칸에 남아 있어야 하므로 activedescendant 로 가리킵니다.
        if (active >= 0 && ul.children[active]) {
            input.setAttribute("aria-activedescendant", `${ul.id}-${active}`);
        } else {
            input.removeAttribute("aria-activedescendant");
        }
    };
    const open = () => {
        if (!pop.hidden) return;
        pop.hidden = false;
        input.setAttribute("aria-expanded", "true");
        renderList();
    };
    const close = () => {
        pop.hidden = true;
        input.setAttribute("aria-expanded", "false");
        input.removeAttribute("aria-activedescendant");
    };

    // 마우스 — 항목은 mousedown 에서 고릅니다(blur 보다 먼저 잡아야 해서).
    ul.addEventListener("mousedown", (e) => {
        const li = e.target.closest("li[role=option]");
        if (!li) { e.preventDefault(); return; }
        e.preventDefault();
        choose(shown[Number(li.dataset.i)]);
    });
    ul.addEventListener("mousemove", (e) => {
        const li = e.target.closest("li[role=option]");
        if (!li) return;
        const i = Number(li.dataset.i);
        if (i !== active) { active = i; paintActive(); }
    });

    // 누르면(포커스) 전체 목록 — 표시만 비워 두고, 고르지 않고 나가면 복귀.
    input.addEventListener("focus", () => { input.value = ""; open(); });
    input.addEventListener("click", open);
    input.addEventListener("input", () => { open(); renderList(); });
    input.addEventListener("blur", () => {
        close();
        if (input.value.trim() === "") showSelected();
    });
    input.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown") {
            e.preventDefault(); open();
            if (shown.length) { active = (active + 1) % shown.length; paintActive(); }
        } else if (e.key === "ArrowUp") {
            e.preventDefault(); open();
            if (shown.length) { active = (active - 1 + shown.length) % shown.length; paintActive(); }
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (!pop.hidden && active >= 0 && shown[active]) { choose(shown[active]); return; }
            // 목록 없이 Enter — 친 글자로 확정(정확히 일치, 아니면 부분 일치 하나뿐일 때)
            const typed = input.value.trim();
            const opts = options();
            let opt = typed === "" ? opts.find((o) => o.value === "")
                                   : opts.find((o) => shownText(o) === typed);
            if (!opt && typed) {
                const partial = opts.filter((o) => o.value !== "" &&
                    shownText(o).toLowerCase().includes(typed.toLowerCase()));
                if (partial.length === 1) opt = partial[0];
            }
            if (opt) choose(opt); else showSelected();
        } else if (e.key === "Escape") {
            close(); showSelected(); input.blur();
        }
    });
    return select;
}

// ---------------------------------------------------------------- 엑셀 내보내기
//
// table() 이 그린 표를 카드 단위로 xlsx 로 내립니다(3라운드 0-4). table() 이
// 그릴 때마다 표 데이터를 등록하고 카드 헤더에 '엑셀' 버튼을 한 번 붙입니다 —
// 화면 모듈은 아무것도 안 해도 표가 있는 카드 전부에 내보내기가 생깁니다.
// 라이브러리는 기존 전체 내보내기(buildAndDownloadWorkbook)와 같은 SheetJS 를
// 같은 주소에서 재사용합니다(새 CDN 금지). 버튼을 누를 때에만 내려받습니다.
let sheetjs = null;
export async function loadSheetJS() {
    if (!sheetjs) sheetjs = await import("https://esm.sh/xlsx@0.18.5");
    return sheetjs;
}

const EXPORT_DATA = new WeakMap();     // 표 컨테이너 → { headers, rows }
const CARD_TABLES = new WeakMap();     // 카드 → Set(표 컨테이너)

function registerExport(container, headers, rows) {
    if (rows) EXPORT_DATA.set(container, { headers, rows });
    else EXPORT_DATA.delete(container);

    const card = container.closest("section.card, .card");
    if (!card) return;
    let set = CARD_TABLES.get(card);
    if (!set) { set = new Set(); CARD_TABLES.set(card, set); }
    set.add(container);

    const header = card.querySelector(":scope > header")
        || card.querySelector(":scope > details > summary");
    if (!header || header.querySelector(".xlsx-btn")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "linkish xlsx-btn";
    btn.textContent = "엑셀";
    btn.title = "이 카드의 표를 엑셀 파일로 내려받습니다";
    btn.addEventListener("click", (e) => {
        e.preventDefault();            // cardfold summary 안에서 접힘 토글 방지
        e.stopPropagation();
        exportCard(card);
    });
    header.append(btn);
}

// 셀 값을 엑셀 셀로 (2026-09-09 재작성 — 본사 검토 내려받기 3종 실측 결함).
//   · 버튼·링크만 있는 칸('입금'·'삭제' 처리 열)은 값이 아니므로 비웁니다.
//   · 값 뒤에 붙는 meta 줄·배지(<div class="meta">매출 × 3.3%</div>, '갱신 필요')는
//     버리고 **첫 블록의 글자만** 값으로 씁니다 — 전에는 전부 이어 붙여
//     "50,398원 매출 × 3.3% 갱신 필요 청구 당시 매출 1,527,200원" 문자열이 나갔습니다.
//   · '—'(값 없음)은 빈 칸으로 — 숫자 열에 문자열이 섞이면 엑셀 합계가 깨집니다.
//   · '1,234'·'1,234원'·'47,117.1'(천 단위 구분이 있는 소수)은 숫자 타입으로.
//     구분 없는 소수('2025.10' 연월 라벨)는 문자열 그대로(2025.1 로 망가짐 방지).
//   · won() 의 '1.2억'·'%' 류는 단위를 잃으므로 문자열 그대로 둡니다.
const EMPTY_MARKS = new Set(["", "—", "–", "-", "…"]);
function decodeText(html) {
    return String(html ?? "")
        .replace(/<[^>]*>/g, " ")
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ").trim();
}
function exportCell(v) {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (v == null) return null;
    let html = String(v);
    const hasControl = /<(button|a|input|select)\b/i.test(html);
    html = html.replace(/<(button|a|select)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
               .replace(/<input\b[^>]*>/gi, " ");
    const whole = decodeText(html);
    if (hasControl && whole === "") return null;
    const first = decodeText(html.split(/<(?:div|p|br|li|ul|ol|table|tr)\b[^>]*>/i)[0]);
    const text = first !== "" ? first : whole;
    if (EMPTY_MARKS.has(text)) return null;
    if (/^[-+]?[0-9]{1,3}(,[0-9]{3})+(\.[0-9]+)?원?$/.test(text)
        || /^[-+]?[0-9]+원?$/.test(text)) {
        return Number(text.replace(/[,원]/g, ""));
    }
    return text;
}

function sheetTitle(base, index, total) {
    const clean = base.replace(/[\\/\[\]*?:]/g, " ").replace(/\s+/g, " ").trim();
    const suffix = total > 1 ? `_${index + 1}` : "";
    return (clean.slice(0, 31 - suffix.length) || "표") + suffix;
}

async function exportCard(card) {
    const parts = [...(CARD_TABLES.get(card) || [])]
        .map((el) => EXPORT_DATA.get(el))
        .filter((d) => d && d.rows && d.rows.length);
    if (!parts.length) { alert("내보낼 표 데이터가 없습니다."); return; }

    const XLSX = await loadSheetJS();
    const wb = XLSX.utils.book_new();
    const title = (card.querySelector("h2")?.textContent || "표").trim();
    parts.forEach((d, i) => {
        // 전역 담당자 필터가 걸려 있으면 화면과 같은 행만 내보냅니다('매장' 열 기준).
        const storeCol = d.headers.findIndex((h) =>
            ["매장", "매장명", "지점", "매장 이름", "가맹점", "가맹점명"].includes(String(h).trim()));
        const rowsIn = storeCol < 0 ? d.rows
            : d.rows.filter((r) => svAllows(String(exportCell(r[storeCol]) ?? "")));
        let aoa = [d.headers.map((h) => exportCell(h)),
                   ...rowsIn.map((r) => r.map(exportCell))];
        // 값이 하나도 없는 열(처리·삭제 버튼 열, 이름 없는 열)은 빼서 빈 열이
        // 시트에 남지 않게 합니다.
        const width = Math.max(...aoa.map((r) => r.length));
        const keep = [];
        for (let c = 0; c < width; c += 1) {
            if (aoa.slice(1).some((r) => r[c] != null && r[c] !== "")) keep.push(c);
        }
        aoa = aoa.map((r) => keep.map((c) => (r[c] == null ? null : r[c])));
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        // 열 너비: 글자 수 기준(한글 2칸), 8~40 사이 — 전에는 전부 13 이라
        // 긴 매장명·금액이 잘려 보였습니다.
        ws["!cols"] = keep.map((_, c) => {
            const lens = aoa.map((r) => {
                const t = r[c] == null ? "" : String(r[c]);
                return [...t].reduce((n, ch) => n + (ch.charCodeAt(0) > 0x2000 ? 2 : 1), 0);
            });
            return { wch: Math.min(40, Math.max(8, Math.max(...lens) + 2)) };
        });
        XLSX.utils.book_append_sheet(wb, ws, sheetTitle(title, i, parts.length));
    });
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const safe = title.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
    XLSX.writeFile(wb, `미태리_${safe}_${day}.xlsx`);
}

/* ---------------------------------------------------------------- hero 카드
 *
 * 화면의 '답' 카드를 채웁니다(디자인 시스템 v1 · 카드 3계급의 맨 위 계급).
 * 화면마다 배지 색·문구 규칙을 다시 쓰면 곧 제각각이 됩니다 — 여기 한 곳입니다.
 *
 *   setHero("리뷰-hero", { num: "3건", tone: "critical", badge: "조치 필요",
 *                          facts: "미답변 12건 · 평균 4.1점" })
 *
 * tone 은 상태 3색과 같은 말을 씁니다: good · attn · critical.
 * tone 을 안 주면 배지를 감춥니다(상태가 없는 조회형 화면).
 * 불러오지 못했을 때는 fail() 로 — '집계 중…' 에 멈춰 있으면 사람은 아직
 * 계산 중인 줄 압니다. 모른다는 것은 모른다고 말해야 합니다.
 */
const HERO_TONE = { good: "hb-good", attn: "hb-attn", critical: "hb-critical" };

export function setHero(id, { num, tone, badge, facts } = {}) {
    const numEl = $(`${id}-num`);
    if (!numEl) return;                       // 아직 hero 가 없는 화면
    numEl.textContent = num == null ? "—" : String(num);
    const badgeEl = $(`${id}-badge`);
    if (badgeEl) {
        const cls = HERO_TONE[tone];
        badgeEl.hidden = !cls;
        if (cls) {
            badgeEl.className = `hero-badge ${cls}`;
            badgeEl.textContent = badge
                || (tone === "critical" ? "조치 필요" : tone === "attn" ? "확인" : "정상");
        }
    }
    const factsEl = $(`${id}-facts`);
    if (factsEl) factsEl.textContent = facts || "";
}

export function heroFail(id, message) {
    setHero(id, { num: "—", facts: `불러오지 못했습니다: ${message}` });
}

// ---------------------------------------------------------------- 모달 포커스
//
// [무엇이 문제였나 — 2026-09-11 WP6 실측]
// 모달 세 개(리뷰 시안 패널 · 표 전면 보기 · 로열티 수정)가 열 때 닫기 버튼에
// 포커스를 주기는 했는데, 그 다음이 없었습니다.
//   · **갇히지 않습니다** — 패널 안에서 Tab 을 몇 번 누르면 뒤에 깔린 화면의
//     버튼으로 넘어갑니다(실측: bigtable 은 개발 배지로, rvpanel 은 body 로).
//     화면에는 덮개가 덮여 있어 지금 어디에 포커스가 있는지 안 보입니다.
//   · **닫아도 안 돌아옵니다** — 닫으면 포커스가 <body> 로 떨어져, 키보드
//     사용자는 방금 누른 자리가 아니라 문서 맨 앞에서 다시 Tab 해야 합니다.
//     표 40번째 행의 '시안' 을 눌렀다면 거기까지 40번을 다시 눌러야 합니다.
//
// 세 곳이 각자 고치면 네 번째 모달이 또 빠뜨리므로 여기 한 곳에 둡니다.
//
//   const release = trapFocus(panelEl);   // 열 때
//   release();                            // 닫을 때 — 열기 전 자리로 돌아갑니다
//
// aria-hidden 을 배경에 씌우지 않는 이유: 이 화면은 모달을 열어 둔 채 뒤의
// 표가 갱신되는 경로가 있어(load() 가 목록을 다시 그림) 배경을 통째로 가리면
// 갱신이 스크린리더에서 사라집니다. Tab 순환만 가둡니다.
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]),'
    + ' select:not([disabled]), textarea:not([disabled]), summary,'
    + ' [tabindex]:not([tabindex="-1"])';

export function trapFocus(root) {
    if (!root) return () => {};
    const returnTo = document.activeElement;
    const items = () => [...root.querySelectorAll(FOCUSABLE)]
        .filter((el) => el.offsetParent !== null || el === document.activeElement);

    const onKey = (e) => {
        if (e.key !== "Tab") return;
        const list = items();
        if (!list.length) return;
        const first = list[0];
        const last = list[list.length - 1];
        const here = document.activeElement;
        if (!root.contains(here)) {          // 밖에 있으면 안으로 데려옵니다
            e.preventDefault();
            (e.shiftKey ? last : first).focus();
            return;
        }
        if (e.shiftKey && here === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && here === last) { e.preventDefault(); first.focus(); }
    };

    root.addEventListener("keydown", onKey);
    document.addEventListener("keydown", onKey);
    return () => {
        root.removeEventListener("keydown", onKey);
        document.removeEventListener("keydown", onKey);
        // 열기 전 요소가 아직 화면에 있으면 그리로. 다시 그려져 사라졌으면
        // 아무 데도 안 보냅니다(보이지 않는 곳에 포커스를 두는 것보다 낫습니다).
        if (returnTo && returnTo.isConnected && returnTo.offsetParent !== null) {
            returnTo.focus();
        }
    };
}
