// 영역 전환(nav) — app.js 에서 뽑아낸 shell 분리 조각 (docs/web-split-plan.md).
// 위반·POS 같은 다른 영역 모듈도 showArea 를 부르므로, entry(app.js)가 아니라
// 별도 모듈이어야 합니다(entry 는 import 할 수 없음).

import { $ } from "./dom.js";
import { S } from "./state.js";
import { credLock } from "./credentials.js";
import { ctLock } from "./contacts.js";

// ---- 업무 영역 전환 -----------------------------------------------------
//
// 카드를 계속 아래로 붙이면 화면 하나가 끝없이 길어집니다. 앞으로 업무 영역이
// 11개로 늘어나므로 왼쪽 메뉴로 갈라 놓습니다.
//
// 데이터는 이미 다 받아 둔 것을 쓰고 보이기만 바꿉니다 — 영역을 옮길 때마다
// 다시 조회하면 지금도 느린 화면이 더 느려집니다.
// 필터(기간·매장)는 매출 영역에서만 뜻이 있어 다른 영역에서는 숨깁니다.

const AREA_KEY = "mitaly.area";

// ---- 탭 머리 설명 (카드 #138, 담당자 지시) ------------------------------
//
// 탭마다 "여기는 무엇을 보고 무엇을 하는 곳인지" 를 카드 위 한 줄로 답니다.
// 상자는 index.html 의 #area-head 하나이고, 탭을 옮길 때 문구만 바꿉니다.
// 매출은 서브탭마다 하는 일이 달라 SALES_HEAD 가 덮어씁니다(showSalesSub).
// 문구는 각 화면의 실제 카드 구성 기준입니다 — 카드가 바뀌면 여기도 고치세요.

const AREA_HEAD = {
    home: ["홈",
        "타일과 이상 신호를 누르면 그 화면으로 갑니다."],
    tasks: ["업무",
        "승인 대기는 눌러야 다음 단계로 넘어갑니다."],
    sales: ["매출",
        "위 단추로 화면을 고르세요."],
    settlement: ["정산",
        "청구는 매출×요율 예상치입니다 — 본사 자료가 오면 그 값이 우선입니다."],
    ads: ["광고",
        "광고비는 직접 입력해 쌓습니다 — 본사에 집행 내역 자료가 없습니다."],
    tradearea: ["상권 분석",
        "분석 결과는 이력에 자동 저장되고, 리포트로 뽑을 수 있습니다."],
    map: ["매장 지도",
        "동 단위 배달 매출을 색으로, 매장 위치를 마커로 봅니다."],
    reviews: ["리뷰",
        "맨 위 필터(기간·매장)가 리뷰 목록에도 걸립니다."],
    visits: ["방문·점검",
        "60일 넘게 안 간 곳이 기한 초과입니다."],
    notices: ["위반·공문",
        "단계는 계산 결과이지 발송 승인이 아닙니다."],
    ingredients: ["식자재·발주",
        "원가율은 매장을 골라야 나옵니다."],
    posmenu: ["POS 메뉴",
        "승인해도 실제 반영은 실행 단계에서 따로 일어납니다."],
    stores: ["매장 정보",
        "계정과 연락처는 2차 암호로 엽니다."],
    lifecycle: ["오픈·폐점",
        "매출이 끊긴 매장은 폐점 후보일 뿐 판정이 아닙니다."],
    comms: ["공지",
        "승인해야 발송 대기로 넘어갑니다."],
    settings: ["설정",
        "여기서 고친 매핑은 다음 대시보드 재구축부터 반영됩니다."],
};

const SALES_HEAD = {
    // 첫 문장("무엇을 봅니다")은 화면이 이미 보여 주고 있어 뺐습니다 —
    // 매장 미선택 빈 상태가 같은 말을 하고 있었습니다(2026-09-10, UX 원칙 ⑤).
    // 남긴 것은 **모르면 실수하는 것 하나**입니다: 기준일 하나가 전 카드를 정합니다.
    "선택 매장 매출": ["매출 · 선택 매장 매출",
        "기준일 하나가 모든 카드의 날짜 기준을 정합니다."],
    // 2026-09-10: 상품 축(메뉴·시간)을 갈라 내면서 문구도 그 화면 몫만 남기고
    // 줄였습니다. '무엇을 봅니다' 는 카드가 이미 보여 줍니다 — 남길 것은
    // 모르면 실수하는 것 하나입니다(UX 원칙 ⑤).
    "전체 매장 매출": ["매출 · 전체 매장 매출",
        "맨 위 필터(기간·매장·채널)가 이 화면 전 카드에 걸립니다."],
    "메뉴·시간": ["매출 · 메뉴 · 시간",
        "맨 위 필터가 여기도 그대로 걸립니다 — 매장을 좁히면 메뉴 순위도 그 매장 것입니다."],
    "보고서": ["매출 · 보고서",
        "기간은 맨 위 필터를 따릅니다."],
};

// 서브탭 개명 별칭(카드 #149 — '매장 대시보드' → '선택 매장 매출' ·
// '전체 매장 요약' → '전체 매장 매출'). 옛 이름이 저장값·옛 코드 경로·
// 딥링크로 들어오면 기본값으로 떨어뜨리지 않고 제 새 이름으로 받습니다.
const SALES_SUB_ALIAS = {
    "매장 대시보드": "선택 매장 매출",
    "전체 매장 요약": "전체 매장 매출",
};

function setAreaHead(entry) {
    const box = $("area-head");
    if (!box) return;
    if (!entry) { box.hidden = true; return; }
    if (!box.firstElementChild) {
        const h = document.createElement("h2");
        h.className = "area-head-title";
        const p = document.createElement("p");
        p.className = "area-head-desc";
        box.append(h, p);
    }
    box.firstElementChild.textContent = entry[0];
    box.lastElementChild.textContent = entry[1];
    box.hidden = false;
}

// 매출 안의 두 번째 단. 같은 방식으로 보이기만 바꿉니다.
// 첫 화면은 선택 매장 매출입니다(2026-08-21 담당자 지시 — 요약 서브탭 폐지.
// 이름은 #149 에서 '매장 대시보드' → '선택 매장 매출').
let salesSub = "선택 매장 매출";

export function showSalesSub(sub) {
    // 개명 별칭 먼저(#149) — 옛 이름은 새 이름으로 받습니다.
    sub = SALES_SUB_ALIAS[sub] || sub;
    // 없는 서브탭 방어 — 서브탭 이름이 바뀐 뒤(#129: 품목·시간·요일·매장 →
    // '전체 매장 요약') 옛 이름이 저장값·옛 코드 경로로 들어오면 빈 화면이
    // 됩니다. 버튼이 없는 이름이면 기본값(첫 화면)으로 받습니다.
    if (!document.querySelector(`.subitem[data-sub-go="${sub}"]`)) {
        sub = "선택 매장 매출";
    }
    salesSub = sub;
    for (const el of document.querySelectorAll('[data-area="sales"][data-sub]')) {
        el.hidden = el.dataset.sub !== sub;
    }
    for (const b of document.querySelectorAll(".subitem")) {
        b.classList.toggle("is-on", b.dataset.subGo === sub);
        b.setAttribute("aria-current", b.dataset.subGo === sub ? "true" : "false");
    }
    // 맨 위 필터 블록(기간·매장·채널·엑셀·기간 타일)은 선택 매장 매출에서
    // 숨깁니다(담당자 지시 — 화면이 자체 고르개를 가져 중복). 전체 매장
    // 매출(시간대·요일·품목별 카드와 전사 추이의 연도·분기·월 단위)·보고서·
    // 수집은 이 필터로 기간을 정하므로 그대로 보입니다.
    const wantFilters = sub !== "선택 매장 매출";
    const filters = document.querySelector(".filters");
    const exportField = $("sales-export-field");
    if (filters) filters.hidden = !wantFilters;
    if (exportField) exportField.hidden = !wantFilters;
    // 탭 머리 — 매출은 서브탭마다 하는 일이 달라 여기서 문구를 정합니다.
    setAreaHead(SALES_HEAD[sub]);
    // 숨김 해제는 재렌더가 아니라서, 숨긴 채(clientWidth=0) fallback 폭으로
    // 그려진 SVG 차트가 그대로 굳습니다. 방금 보이게 된 것을 알리기만 하고,
    // 다시 그릴지는 데이터를 가진 쪽(app.js entry)이 판단합니다 — nav 는
    // entry 를 import 할 수 없습니다(맨 위 주석). _agent/SALES-DIAGNOSIS.md H2.
    document.dispatchEvent(new CustomEvent("mitaly:area-shown",
        { detail: { area: "sales", sub } }));
    window.scrollTo({ top: 0, behavior: "instant" });
}

// 좁은 화면(≤620px)의 가로 내비에서 **지금 있는 영역**을 보이는 데로 끌어옵니다.
//
// [실측 390px, 2026-09-11 WP4] 내비 16개가 한 줄로 눕는데 필요폭 1,440px ·
// 가진폭 342px 이라 첫 화면에 4개만 보입니다. 5번째부터는 `is-on` 강조가
// **화면 밖**이라, '매장 정보'(13번째)에 들어가도 내비에는 홈·업무·매출·정산만
// 보이고 아무것도 강조돼 있지 않습니다 — 사용자가 지금 어디 있는지 모릅니다.
//
// CSS 로는 못 합니다(스크롤 위치는 스타일이 아닙니다). 그래서 여기서 밀어 줍니다.
// 조건을 두 개 답니다:
//   · 실제로 넘칠 때만 — 넓은 화면의 세로 메뉴에서 부르면 아무 일도 안 하지만,
//     괜히 스크롤 계산을 돌릴 이유가 없습니다.
//   · `block: "nearest"` — 이것을 빼면 브라우저가 **페이지 세로 스크롤까지**
//     같이 움직여 방금 연 화면의 머리가 잘립니다(showArea 는 맨 위로 올립니다).
function revealActiveNav() {
    const nav = document.querySelector(".sidenav");
    if (!nav || nav.scrollWidth <= nav.clientWidth + 2) return;
    const on = nav.querySelector(".navitem.is-on");
    if (on && on.scrollIntoView) on.scrollIntoView({ inline: "center", block: "nearest" });
}

export function showArea(area) {
    // 매장 정보에서 나가면 암호를 버립니다(위 credLock 주석 참조).
    if (area !== "stores" && typeof S.credPass !== "undefined" && S.credPass) credLock();
    if (area !== "stores" && typeof S.ctPass !== "undefined" && S.ctPass) ctLock();

    // '지금 어느 영역인가'(S.area)와 진입 이벤트를 함께 알립니다. 원래 수집
    // 화면 폴링 몫이었는데(큐 #107 F6) 그 화면은 3라운드 2차에서 내렸고,
    // 지금 읽는 곳은 홈(app.js loadHome — 부팅 착지 판정)과 설정 탭
    // (settings.js — 진입 시 실패분 재조회, 카드 #130)입니다.
    // entry(app.js)는 여기서 import 할 수 없으므로 상태 + 이벤트로 알립니다.
    S.area = area;
    window.dispatchEvent(new CustomEvent("mitaly:area", { detail: area }));

    for (const el of document.querySelectorAll("[data-area]")) {
        el.hidden = el.dataset.area !== area;
    }
    for (const b of document.querySelectorAll(".navitem")) {
        b.classList.toggle("is-on", b.dataset.go === area);
        b.setAttribute("aria-current", b.dataset.go === area ? "page" : "false");
    }
    revealActiveNav();
    const salesOnly = area === "sales";
    // 필터 줄(기간·매장)은 매출·리뷰에서만 보입니다. 홈은 3라운드 피드백
    // 1번으로 필터와 무관해졌습니다(전체 기간·전 매장 고정 — app.js loadHome)
    // — 매출은 매출 탭에서 보므로 홈에 필터 줄 자체가 필요 없습니다.
    // 리뷰 카드(api_review_summary)는 같은 f-from/f-to/f-store 를 그대로
    // 쓰므로 리뷰 영역에서는 필터 줄이 필요합니다.
    // 맨 위 매출 4칸(총매출 등)은 매출 화면에서만 뜻이 있어 그대로 숨깁니다.
    const filters = document.querySelector(".filters");
    if (filters) filters.hidden = !(salesOnly || area === "reviews");
    // 엑셀 내보내기 버튼(3라운드 2차 — 옛 수집·내보내기 화면의 후신)은 매출
    // 자료를 뽑는 것이라 매출 영역에서만 보입니다. 필터 줄 자체는 홈·리뷰도
    // 같이 쓰므로 버튼 칸만 따로 숨깁니다.
    const exportField = $("sales-export-field");
    if (exportField) exportField.hidden = !salesOnly;

    // 탭 머리 문구 — 매출은 바로 아래 showSalesSub 가 서브탭 문구로 덮습니다.
    setAreaHead(AREA_HEAD[area]);

    // 매출이면 서브탭 규칙이 위 필터 표시를 다시 다듬으므로(매장 대시보드는
    // 숨김) 필터 처리 **뒤에** 부릅니다 — 앞에 부르면 여기서 도로 켜집니다.
    if (area === "sales") showSalesSub(salesSub);
    else document.dispatchEvent(new CustomEvent("mitaly:area-shown",
        { detail: { area } }));

    try { localStorage.setItem(AREA_KEY, area); } catch (e) { /* 사생활 모드 */ }
    window.scrollTo({ top: 0, behavior: "instant" });
}

export function initAreas() {
    for (const b of document.querySelectorAll(".subitem")) {
        b.addEventListener("click", () => showSalesSub(b.dataset.subGo));
    }
    for (const b of document.querySelectorAll(".navitem")) {
        b.addEventListener("click", () => showArea(b.dataset.go));
    }
    let saved = "home";
    try { saved = localStorage.getItem(AREA_KEY) || "home"; } catch (e) { /* 무시 */ }
    // 저장된 값이 지금 없는 영역일 수 있습니다(영역 이름이 바뀐 뒤).
    // 버튼이 hidden 인 영역(매장 지도 — 2026-08-21 담당자 지시로 버튼만 내림)도
    // 같은 폴백을 태웁니다 — querySelector 는 hidden 버튼도 그대로 잡으므로
    // (카드 #132 실측: hidden 속성은 selector 판정에 안 걸립니다) 존재 검사만
    // 으로는 숨긴 화면이 계속 열립니다.
    const savedButton = document.querySelector(`.navitem[data-go="${saved}"]`);
    if (!savedButton || savedButton.hidden) saved = "home";
    showArea(saved);
}

// 홈 화면의 할 일 타일 → 관련 카드로 이동. 업무 3종(미처리·승인 대기·문의
// 답변)은 업무 영역, AI 답글 초안 타일은 리뷰 영역(review-card)을 가리킵니다
// — 어느 영역으로 이동할지는 각 타일의 data-go-target(index.html)이 정합니다.
// 필터를 바꿀 때는 그 필터가 이미 쓰고 있는 이벤트를 그대로 흉내 냅니다
// (rv-rating 은 change 시 서버에 다시 묻고, alerts-only 는 이미 받아 둔
// 데이터를 다시 그리기만 합니다) — 홈 화면이 그 규칙을 새로 만들지 않습니다.
export function initHomeTiles() {
    const targets = {
        "home-tile-tasks": "task-list-card",
        "home-tile-approvals": "task-list-card",
        "home-tile-inquiry": "inquiry-card",
        "home-tile-drafts": "review-card",
        "home-tile-diagnosis": "diagnosis-card",
    };

    // '승인 대기 업무' 타일은 업무 화면 타일(tk-waiting)을 거울로 비춥니다 —
    // 같은 숫자(api_tasks_summary)를 홈이 또 조회하지 않기 위해서입니다.
    // 값은 tasks.js(refreshTasksSummary)가 비동기로 채우므로 관찰만 합니다
    // (아래 0 판정 MutationObserver 와 같은 방식).
    const waiting = document.getElementById("tk-waiting");
    const homeApprovals = document.getElementById("home-approvals");
    if (waiting && homeApprovals) {
        const mirror = () => { homeApprovals.textContent = waiting.textContent; };
        mirror();
        new MutationObserver(mirror).observe(waiting, {
            childList: true, characterData: true, subtree: true,
        });
    }

    // 매출 한 줄(전 매장·최근 완성월 — app.js loadHome)을 누르면 매출 탭으로.
    const salesLine = document.getElementById("home-sales-line");
    if (salesLine) salesLine.addEventListener("click", () => showArea("sales"));
    for (const [tileId, cardId] of Object.entries(targets)) {
        const tile = document.getElementById(tileId);
        if (!tile) continue;

        // 값이 0이면 타일의 상태 강조(빨강 등)를 중립으로 되돌립니다 — 처리할 게
        // 없는데 경보색을 두면 정작 급한 타일이 안 도드라집니다. 값은 여러
        // 모듈이 비동기로 채우므로(app/tasks/inquiries), 한 곳에서 관찰만 합니다.
        const valueEl = tile.querySelector(".value");
        if (valueEl) {
            const sync = () => {
                const n = valueEl.textContent.replace(/[^\d-]/g, "");
                tile.dataset.count = (n === "" || n === "0") ? "0" : "1";
            };
            sync();
            new MutationObserver(sync).observe(valueEl, {
                childList: true, characterData: true, subtree: true,
            });
        }

        tile.addEventListener("click", () => {
            showArea(tile.dataset.goTarget || "sales");
            if (tileId === "home-tile-tasks") {
                $("tk-filter-overdue").checked = true;
                $("tk-filter-overdue").dispatchEvent(new Event("change"));
            }
            if (tileId === "home-tile-approvals") {
                // 업무 화면의 상태 필터를 '승인 대기' 로 맞춥니다. 미처리
                // 체크가 남아 있으면 두 필터가 AND 로 걸려 목록이 비므로 끕니다.
                $("tk-filter-status").value = "waiting_approval";
                $("tk-filter-overdue").checked = false;
                $("tk-filter-status").dispatchEvent(new Event("change"));
            }
            if (tileId === "home-tile-inquiry") {
                $("iq-filter").value = "draft";
                $("iq-filter").dispatchEvent(new Event("change"));
            }
            if (tileId === "home-tile-diagnosis") {
                // 진단 카드는 매출의 '전체 매장 매출' 서브탭에 있습니다(#129
                // 재편) — 스크롤 대상이 숨어 있지 않게 서브탭부터 맞춥니다.
                showSalesSub("전체 매장 매출");
            }
            requestAnimationFrame(() => {
                document.getElementById(cardId)?.scrollIntoView({ behavior: "smooth", block: "start" });
            });
        });
    }

    // 이상 신호 목록(급감 매장·부정 리뷰) 행 클릭 — 행이 다시 그려지므로
    // 컨테이너 한 곳에 위임합니다. 타일과 같은 규칙으로 화면 필터를 맞추고,
    // 행에 data-store 가 있으면 전역 매장 필터까지 그 매장으로 좁힙니다 —
    // "샘플07점 급감"을 눌렀는데 전체 급감 목록에 떨어져 그 매장을 다시
    // 찾게 하지 않기 위해서입니다('외 N건' 행은 data-store 가 없어 전체로).
    const anoms = document.getElementById("home-card");
    if (anoms) {
        anoms.addEventListener("click", (e) => {
            const row = e.target.closest(".home-anom-row");
            if (!row) return;
            showArea(row.dataset.go);
            if (row.dataset.kind === "review") {
                // 값만 바꿔 둡니다 — 아래 매장 필터 change 가 조회를 다시 부르면
                // 그 조회가 이 값을 읽습니다(두 번 조회하지 않으려고).
                $("rv-rating").value = "low";
            }
            if (row.dataset.kind === "storedash") {
                // 담당자별 할 일(#168)의 매장 행 — '선택 매장 매출' 서브탭에서 그 매장.
                showSalesSub("선택 매장 매출");
                const sd = $("sd-store");
                const name = row.dataset.store || "";
                const opt = sd && [...sd.options].find((o) => o.textContent === name || o.value === name);
                if (opt) {
                    sd.value = opt.value;
                    sd.dispatchEvent(new Event("change"));
                }
            }
            if (row.dataset.kind === "alert") {
                // 급증·급감 카드도 '전체 매장 매출' 서브탭에 있습니다(#129).
                showSalesSub("전체 매장 매출");
                $("alerts-only").checked = true;
                $("alerts-only").dispatchEvent(new Event("change"));
            }
            const store = row.dataset.store || "";
            const storeSelect = $("f-store");
            const known = row.dataset.kind !== "storedash" && store &&
                [...storeSelect.options].some((o) => o.value === store);
            if (known) {
                storeSelect.value = store;
                storeSelect.dispatchEvent(new Event("change"));
            } else if (row.dataset.kind === "review") {
                // 매장을 못 좁히면 별점 필터 변경만 서버에 알립니다(종전 동작).
                $("rv-rating").dispatchEvent(new Event("change"));
            }
            const card = row.dataset.card;
            requestAnimationFrame(() => {
                document.getElementById(card)?.scrollIntoView({ behavior: "smooth", block: "start" });
            });
        });
    }
}
