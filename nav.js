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

// 매출 안의 두 번째 단. 같은 방식으로 보이기만 바꿉니다.
let salesSub = "요약";

export function showSalesSub(sub) {
    salesSub = sub;
    for (const el of document.querySelectorAll('[data-area="sales"][data-sub]')) {
        el.hidden = el.dataset.sub !== sub;
    }
    for (const b of document.querySelectorAll(".subitem")) {
        b.classList.toggle("is-on", b.dataset.subGo === sub);
        b.setAttribute("aria-current", b.dataset.subGo === sub ? "true" : "false");
    }
    // 숨김 해제는 재렌더가 아니라서, 숨긴 채(clientWidth=0) fallback 폭으로
    // 그려진 SVG 차트가 그대로 굳습니다. 방금 보이게 된 것을 알리기만 하고,
    // 다시 그릴지는 데이터를 가진 쪽(app.js entry)이 판단합니다 — nav 는
    // entry 를 import 할 수 없습니다(맨 위 주석). _agent/SALES-DIAGNOSIS.md H2.
    document.dispatchEvent(new CustomEvent("mitaly:area-shown",
        { detail: { area: "sales", sub } }));
    window.scrollTo({ top: 0, behavior: "instant" });
}

export function showArea(area) {
    // 매장 정보에서 나가면 암호를 버립니다(위 credLock 주석 참조).
    if (area !== "stores" && typeof S.credPass !== "undefined" && S.credPass) credLock();
    if (area !== "stores" && typeof S.ctPass !== "undefined" && S.ctPass) ctLock();

    // 수집 화면 폴링(app.js)이 '지금 어느 영역인가' 를 읽습니다 (큐 #107 F6).
    // entry(app.js)는 여기서 import 할 수 없으므로 상태 + 이벤트로 알립니다 —
    // 수집 영역에 들어오는 순간 쉬고 있던 폴링이 바로 한 번 돕니다.
    S.area = area;
    window.dispatchEvent(new CustomEvent("mitaly:area", { detail: area }));

    for (const el of document.querySelectorAll("[data-area]")) {
        el.hidden = el.dataset.area !== area;
    }
    for (const b of document.querySelectorAll(".navitem")) {
        b.classList.toggle("is-on", b.dataset.go === area);
        b.setAttribute("aria-current", b.dataset.go === area ? "page" : "false");
    }
    if (area === "sales") showSalesSub(salesSub);
    else document.dispatchEvent(new CustomEvent("mitaly:area-shown",
        { detail: { area } }));

    const salesOnly = area === "sales";
    // 홈 화면의 타일도 위 필터(기간·매장)를 따르므로 필터 줄은 같이 보여줍니다.
    // 리뷰 카드(api_review_summary)도 같은 f-from/f-to/f-store 를 그대로 쓰므로
    // 리뷰 영역에서도 필터 줄이 필요합니다.
    // 맨 위 매출 4칸(총매출 등)은 매출 화면에서만 뜻이 있어 그대로 숨깁니다.
    const filters = document.querySelector(".filters");
    const tiles = $("sales-kpis");
    if (filters) filters.hidden = !(salesOnly || area === "home" || area === "reviews");
    if (tiles) tiles.hidden = !salesOnly;
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
    if (!document.querySelector(`.navitem[data-go="${saved}"]`)) saved = "home";
    showArea(saved);
}

// 홈 화면의 할 일 타일 → 관련 카드로 이동. 답글·부정 리뷰 타일은 리뷰
// 영역(review-card), 급감 매장 타일은 매출 영역(alerts-card)을 가리킵니다
// — 어느 영역으로 이동할지는 각 타일의 data-go-target(index.html)이 정합니다.
// 필터를 바꿀 때는 그 필터가 이미 쓰고 있는 이벤트를 그대로 흉내 냅니다
// (rv-rating 은 change 시 서버에 다시 묻고, alerts-only 는 이미 받아 둔
// 데이터를 다시 그리기만 합니다) — 홈 화면이 그 규칙을 새로 만들지 않습니다.
export function initHomeTiles() {
    const targets = {
        "home-tile-tasks": "task-list-card",
        "home-tile-inquiry": "inquiry-card",
        "home-tile-drafts": "review-card",
        "home-tile-negative": "review-card",
        "home-tile-declining": "alerts-card",
    };
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
            if (tileId === "home-tile-negative") {
                $("rv-rating").value = "low";
                $("rv-rating").dispatchEvent(new Event("change"));
            }
            if (tileId === "home-tile-declining") {
                $("alerts-only").checked = true;
                $("alerts-only").dispatchEvent(new Event("change"));
            }
            if (tileId === "home-tile-tasks") {
                $("tk-filter-overdue").checked = true;
                $("tk-filter-overdue").dispatchEvent(new Event("change"));
            }
            if (tileId === "home-tile-inquiry") {
                $("iq-filter").value = "draft";
                $("iq-filter").dispatchEvent(new Event("change"));
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
            if (row.dataset.kind === "alert") {
                $("alerts-only").checked = true;
                $("alerts-only").dispatchEvent(new Event("change"));
            }
            const store = row.dataset.store || "";
            const storeSelect = $("f-store");
            const known = store &&
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
