// DOM 조립 헬퍼 — 표 그리기와 툴팁. app.js 에서 뽑아낸 2단계 조각
// (docs/web-split-plan.md). 값을 받아 컨테이너에 채워 넣는 일만 합니다.
//
// 3라운드 공통(담당자 피드백 0번): 월 고르개(monthPicker) · 매장 검색 콤보
// (searchify) · 카드 표 엑셀 내보내기(table 이 자동 부착)도 여기 삽니다 —
// 전 화면이 같은 동작을 갖도록 공통 층 한 곳에만 둡니다.

import { escape } from "./util.js";
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
    const ul = document.createElement("ul");
    ul.setAttribute("role", "listbox");
    ul.id = `combo-list-${id}`;
    pop.append(ul);
    wrap.append(input, pop);
    select.after(wrap);
    select.hidden = true;
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");

    const options = () => [...select.options];
    const showSelected = () => {
        const cur = SELECT_VALUE.get.call(select);
        const opt = options().find((o) => o.value === cur);
        input.value = opt && opt.value !== "" ? opt.textContent : "";
    };
    const refreshPlaceholder = () => {
        const blank = options().find((o) => o.value === "");
        // '전체'류 항목이 있으면 빈 입력 = 그 항목. 자리 문구로 보여 줍니다.
        input.placeholder = blank ? blank.textContent : "매장 검색";
        showSelected();
    };
    new MutationObserver(() => { refreshPlaceholder(); if (!pop.hidden) renderList(); })
        .observe(select, { childList: true, subtree: true, characterData: true });
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
        input.value = opt.value === "" ? "" : opt.textContent;
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
            q === "" || o.value === "" || o.textContent.toLowerCase().includes(q));
        // 빈 값('전체'류)은 입력이 비어 있을 때만 — 검색 중엔 결과만 보입니다.
        if (q !== "") shown = shown.filter((o) => o.value !== "");
        ul.innerHTML = shown.length
            ? shown.map((o, i) =>
                `<li role="option" data-i="${i}" class="${o.value === cur ? "is-cur" : ""}`
                + `${o.value === "" ? " is-blank" : ""}">${escape(o.textContent)}</li>`).join("")
            : '<li class="is-empty">일치하는 매장이 없습니다</li>';
        active = shown.length ? Math.max(0, shown.findIndex((o) => o.value === cur)) : -1;
        if (q !== "" && shown.length) active = 0;
        paintActive();
    };
    const paintActive = () => {
        ul.querySelectorAll("li[role=option]").forEach((li, i) => {
            li.classList.toggle("is-active", i === active);
            if (i === active) li.scrollIntoView({ block: "nearest" });
        });
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
                                   : opts.find((o) => o.textContent === typed);
            if (!opt && typed) {
                const partial = opts.filter((o) => o.value !== "" &&
                    o.textContent.toLowerCase().includes(typed.toLowerCase()));
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

// 셀 값을 엑셀 셀로. HTML(배지·meta 줄)은 글자만 남기고, '1,234'·'1,234원'
// 같은 순수 숫자는 숫자 타입으로 넣어 엑셀에서 바로 계산되게 합니다.
// (won() 의 '1.2억'·'%' 류는 단위를 잃으므로 문자열 그대로 둡니다.)
function exportCell(v) {
    if (typeof v === "number") return v;
    const text = String(v ?? "")
        .replace(/<(div|p|br|li)[^>]*>/gi, " ")
        .replace(/<[^>]*>/g, "")
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ").trim();
    // 정수만 숫자로 바꿉니다. 소수점이 있는 건 '2025.10'(연월 라벨) 같은
    // 표기가 숫자 2025.1 로 망가질 수 있어 문자열 그대로 둡니다.
    if (/^[-+]?[0-9][0-9,]*원?$/.test(text)) {
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
        const aoa = [d.headers.map((h) => exportCell(h)),
                     ...d.rows.map((r) => r.map(exportCell))];
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa),
            sheetTitle(title, i, parts.length));
    });
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const safe = title.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
    XLSX.writeFile(wb, `미태리_${safe}_${day}.xlsx`);
}
