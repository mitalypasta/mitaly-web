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
        "지금 조치할 일이 몇 건인지 한 숫자로 먼저 보여줍니다. 미처리 업무·" +
        "승인 대기·문의 답변·리뷰 초안 타일과 이상 신호(급감 매장·부정 리뷰)를 " +
        "누르면 해당 화면으로 이동합니다."],
    tasks: ["업무",
        "가맹점에서 접수된 업무를 목록으로 보고 처리·승인합니다. AI 1차 응대 " +
        "검토, 카카오 챗봇 통계, 위반 통보 승인, 발송 수신처·발송 이력도 " +
        "여기서 관리합니다."],
    sales: ["매출",
        "매장별·전사 매출을 봅니다. 위 단추로 화면을 고르세요."],
    settlement: ["정산",
        "매장별 로열티 청구(매출×요율)와 입금을 대조해 미수를 가려냅니다. " +
        "입금을 기록하고, 미수 건은 발송 승인을 요청하며, 매장별 요율도 " +
        "여기서 고칩니다."],
    ads: ["광고",
        "매장별 광고비 집행 내역과 그 매장의 배달앱 메뉴 대조를 봅니다. " +
        "광고비는 매장·월·채널·금액으로 직접 입력해 쌓습니다."],
    map: ["매장 지도",
        "동 단위 배달 매출을 지도에 색으로 보여주고, 매장 위치를 마커로 함께 " +
        "표시합니다."],
    reviews: ["리뷰",
        "배달앱·네이버에서 자동 수집한 리뷰를 매장별로 보고, AI 답글 초안을 " +
        "고쳐 승인하거나 반려합니다. 답글 대행 동의 매장 명단도 여기서 " +
        "관리합니다."],
    visits: ["방문·점검",
        "다음에 방문할 매장을 확인하고 방문·점검 결과를 기록합니다. 매장별 " +
        "방문 이력도 여기서 봅니다."],
    notices: ["위반·공문",
        "매장 위반을 기록하고 내용증명 단계 판정에 따라 진행·종료를 " +
        "관리합니다. 과거 공문 아카이브는 낱말 검색으로 전문을 열람할 수 " +
        "있습니다."],
    ingredients: ["식자재·발주",
        "매장별 아워홈 발주량과 발주 상품 마스터, 조리 레시피·소요량, 매출로 " +
        "계산한 이론 재료 사용량을 봅니다."],
    posmenu: ["POS 메뉴",
        "전 매장 POS 메뉴 현황을 보고 변경 요청을 접수해 승인·실행 이력까지 " +
        "관리합니다. 오일데이 원복 점검과 배달앱 메뉴 대조도 여기서 합니다."],
    stores: ["매장 정보",
        "가맹점 DB(SV 배정·분류·주소)와 채널별 계정 유무, 배달앱 계정, 점주 " +
        "연락처·계약을 조회·수정합니다. 계정과 연락처는 2차 암호로 엽니다."],
    lifecycle: ["오픈·폐점",
        "진행 중인 오픈·폐점 건이 어느 단계까지 왔는지 보고 새 기록을 " +
        "추가합니다. 매장별 현재 상태와 전체 이력도 여기서 봅니다."],
    comms: ["공지",
        "가맹점에 보낼 공지를 작성하고 승인을 거쳐 발송 대기로 넘깁니다. " +
        "지난 공지는 목록에서 봅니다."],
    settings: ["설정",
        "메뉴 매핑표(원본표기→표준명)를 고치고, 채널×매장×월 수집 커버리지를 " +
        "확인합니다."],
};

const SALES_HEAD = {
    "매장 대시보드": ["매출 · 매장 대시보드",
        "매장 한 곳을 골라 KPI·추정 손익과 연도·분기·주간·일간 추이, 메뉴 " +
        "판매를 봅니다. 기준일을 정하면 모든 카드가 그 날짜 기준으로 바뀌고, " +
        "카드별 시트를 담은 엑셀로 내려받을 수 있습니다."],
    "전체 매장 요약": ["매출 · 전체 매장 요약",
        "전사 매출 추이(연도~일별)와 시간대·요일·메뉴·상권별 분해, 전매장 " +
        "현황·매장 비교·급증급감·매장 진단을 봅니다. 기간·매장·채널은 맨 위 " +
        "필터로 좁힙니다."],
    "보고서": ["매출 · 보고서",
        "SV에게 보내는 월간 보고서를 화면에서 확인하고 PDF로 저장합니다. " +
        "기간은 맨 위 필터를 따릅니다."],
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
// 첫 화면은 매장 대시보드입니다(2026-08-21 담당자 지시 — 요약 서브탭 폐지).
let salesSub = "매장 대시보드";

export function showSalesSub(sub) {
    // 없는 서브탭 방어 — 서브탭 이름이 바뀐 뒤(#129: 품목·시간·요일·매장 →
    // '전체 매장 요약') 옛 이름이 저장값·옛 코드 경로로 들어오면 빈 화면이
    // 됩니다. 버튼이 없는 이름이면 기본값(첫 화면)으로 받습니다.
    if (!document.querySelector(`.subitem[data-sub-go="${sub}"]`)) {
        sub = "매장 대시보드";
    }
    salesSub = sub;
    for (const el of document.querySelectorAll('[data-area="sales"][data-sub]')) {
        el.hidden = el.dataset.sub !== sub;
    }
    for (const b of document.querySelectorAll(".subitem")) {
        b.classList.toggle("is-on", b.dataset.subGo === sub);
        b.setAttribute("aria-current", b.dataset.subGo === sub ? "true" : "false");
    }
    // 맨 위 필터 블록(기간·매장·채널·엑셀·기간 타일)은 매장 대시보드에서
    // 숨깁니다(담당자 지시 — 대시보드가 자체 고르개를 가져 중복). 전체 매장
    // 요약(시간대·요일·품목별 카드와 전사 추이의 연도·분기·월 단위)·보고서·
    // 수집은 이 필터로 기간을 정하므로 그대로 보입니다.
    const wantFilters = sub !== "매장 대시보드";
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
                // 진단 카드는 매출의 '전체 매장 요약' 서브탭에 있습니다(#129
                // 재편) — 스크롤 대상이 숨어 있지 않게 서브탭부터 맞춥니다.
                showSalesSub("전체 매장 요약");
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
                // 급증·급감 카드도 '전체 매장 요약' 서브탭에 있습니다(#129).
                showSalesSub("전체 매장 요약");
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
