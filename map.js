// 매장 지도 (6번 영역) — app.js 에서 뽑아낸 shell 분리 조각
// (docs/web-split-plan.md). dmapMap 은 시험·디버깅에서 '지도가 떠 있나'
// 판단에 읽습니다(live import 바인딩).

import { won, wonFull, int, ymLabel, catLabel } from "./format.js";
import { $, table } from "./dom.js";
import { db } from "./client.js";
import { palette } from "./charts.js";
import { escape } from "./util.js";

// ---- 매장 지도 (6번 영역) ---------------------------------------------------
//
// 매장 위치를 카카오맵에 마커로 찍고, 매장 하나를 고르면(마커 클릭 또는
// 매장 고르개) 그 매장의 상세를 지도 아래 블록에 보여주는 화면입니다.
// SDK 는 화면에 처음 들어올 때 한 번만 로드합니다 — 숨겨진 컨테이너에
// 지도를 만들면 크기를 못 잡기 때문에(카카오맵 특성) 게으르게 합니다.
//
// 🔺 옛 '동 단위 색칠'(choropleth)은 걷어냈습니다(2026-08-14). 과거 배달
//    주소에 동 정보가 없어 대부분 (미상)이었고, 채우려면 --dong 재수집이
//    필요한데 그건 안 하기로 했습니다. 그래서 재수집 없이 바로 쓸 수 있는
//    '매장 위치 + 매출'만 남겼습니다. (동 집계 함수 api_dong_month·경계 파일
//    dong_boundaries.json 은 그대로 두되 이 화면은 더 안 부릅니다.)
//
// ------------------------------------------------------------- 설계 판단
//
// [1] 매장 마커는 **조회 함수**(api_store_points, 63)로 받습니다. `web/` 은
//     로그인과 무관하게 공개되므로 매장 위치를 정적 파일로 두지 않습니다
//     (63 설계 판단 [2]). 좌표는 주소를 카카오로 보내 만든 것이라(담당자
//     승인 2026-08-07) 63 이 아직 안 들어간 환경에서는 안내만 뜹니다.
//
// [2] 매출은 **api_store_metrics**(매출 비교표와 같은 함수)를 지도 카드 자체
//     기간으로 부릅니다. 마커 클릭 시점에 클로저로 읽어, 매출이 뒤늦게 도착해도
//     마커를 다시 그릴 필요가 없습니다. 홀·배달을 나눠 보여줍니다.
//
// [3] **팝업은 요약, 아래 블록이 상세**입니다(3라운드 담당자 요구 1).
//     CustomOverlay 팝업은 매장명·기간 매출·홀/배달 나눔까지만 하고, 메뉴·
//     추이·리뷰·급증급감·오픈일은 지도 아래 #dmap-detail 이 맡습니다.
//     상세는 전부 **기존 api_* 조합**입니다(새 SQL 없음): api_by_menu ·
//     api_monthly · api_review_summary · api_sales_alerts · api_store_lifecycle.
//
// [4] **상세 블록은 SDK 와 무관하게 돕니다.** 카카오 JS 키가 없거나 도메인
//     미등록으로 지도가 못 떠도, 매장 고르개로 한 곳을 고르면 상세가 그려집니다.
//     지도는 '있으면 마커까지' 그리는 부가물로 취급합니다 — 개발 환경(데모)
//     검증도 이 경로로 합니다.
//
// [5] **마커의 원천(store_points)은 자동으로 안 채워집니다.** 반입은
//     tools/geocode_stores.py 를 담당자가 돌려야 합니다(러너 편입 안 됨 —
//     주소가 카카오로 나가는 외부 호출이라 담당자 판단 사항). 그래서 화면이
//     실태를 스스로 밝힙니다: 매출은 있는데 좌표가 없는 매장(대개 신규)을
//     목록으로 보여 주고(#dmap-gaps), 폐점 매장(27 의 최근 이벤트가 close)은
//     마커를 흐리게 구분합니다. 좌표를 지우지는 않습니다 — 폐점해도 위치는
//     사실이고, 언제부터 폐점인지가 보이는 쪽이 판단에 씁니다.

let dmapStarted = false;        // 카드에 한 번이라도 들어왔나 (게으른 로드 게이트)
export let dmapMap = null;
let dmapMarkers = [];           // 지금 찍혀 있는 매장 마커
let dmapOverlay = null;         // 마커 클릭 팝업 (한 번에 하나, S17)
let dmapClosed = new Map();     // 매장명 → 폐점 정보 (api_store_lifecycle_status)
let dmapDetailStore = null;     // 상세 블록이 보여주는 매장 (null = 닫힘)
let dmapDetailSeq = 0;          // 상세 비동기 경주 방지 (늦게 온 응답 버림)

export function initDeliveryMap() {
    for (const b of document.querySelectorAll('.navitem[data-go="map"]')) {
        b.addEventListener("click", () => setTimeout(loadDeliveryMap, 80));
    }
}

// 고르개 변경(app.js 가 부름). 카드에 아직 안 들어왔으면 값만 남겨 둡니다.
export function dmapFilterChanged() {
    if (dmapStarted) drawStoreMap();
}

function dmapClosePopup() {
    if (dmapOverlay) { dmapOverlay.setMap(null); dmapOverlay = null; }
}

// mitaly_shift_ym(18_alerts.sql)과 같은 규칙 — YYYYMM 정수를 개월 수만큼 밉니다.
function shiftYm(ym, months) {
    const y = Math.floor(ym / 100), m = ym % 100;
    const total = y * 12 + (m - 1) + months;
    return Math.floor(total / 12) * 100 + (((total % 12) + 12) % 12) + 1;
}

/** 지도 카드 자체 고르개를 읽습니다 — 전역 currentFilters() 대신 (S17).
 *  위 필터 줄이 지도 영역에서는 안 보여서 카드가 직접 갖습니다(initDashboard). */
function dmapFilters() {
    let from = Number($("dmap-from").value) || null;
    let to = Number($("dmap-to").value) || null;
    if (from && to && from > to) [from, to] = [to, from];
    return { p_ym_from: from, p_ym_to: to, p_store: $("dmap-store").value || null };
}

let dmapSdkLoading = false;     // SDK 로드 중복 방지 (연타 대비)

async function loadDeliveryMap() {
    const first = !dmapStarted;
    dmapStarted = true;
    const key = (window.MITALY_CONFIG || {}).kakaoMapKey || "";
    const notice = $("dmap-notice");
    let mapCreated = false;
    if (!key) {
        if (first) {
            notice.textContent = "카카오맵 JS 키가 아직 없습니다 — config.js 의 "
                + "kakaoMapKey 가 채워지면 이 자리에 지도가 뜹니다. 매장을 고르면 "
                + "지도 없이도 아래에 상세가 뜹니다.";
        }
    } else if (!dmapMap && !dmapSdkLoading) {
        dmapSdkLoading = true;
        try {
            await new Promise((resolve, reject) => {
                const script = document.createElement("script");
                script.src = "https://dapi.kakao.com/v2/maps/sdk.js?appkey="
                    + encodeURIComponent(key) + "&autoload=false";
                script.onload = resolve;
                script.onerror = () => reject(new Error(
                    "SDK 를 불러오지 못했습니다 — 카카오 개발자 콘솔의 JS 키 도메인 "
                    + "등록(현재 주소 포함)을 확인하세요"));
                document.head.append(script);
            });
            await new Promise((resolve) => kakao.maps.load(resolve));

            dmapMap = new kakao.maps.Map($("dmap-container"), {
                center: new kakao.maps.LatLng(37.5665, 126.978),   // 서울 시청
                level: 8,
            });
            // 카드가 방금 보이기 시작한 참이라 컨테이너가 0 크기로 재졌을 수
            // 있습니다 — 카카오맵은 그 경우 회색 빈 화면이 됩니다. 다시 재 봅니다.
            dmapMap.relayout();
            // 타일이 끝내 안 오면(대개 JS 키의 웹 도메인 미등록) 화면이 말없이
            // 회색입니다 — 원인을 화면이 직접 말하게 합니다 (2026-08-10 실사용 문의).
            let dmapTilesOk = false;
            kakao.maps.event.addListener(dmapMap, "tilesloaded", () => { dmapTilesOk = true; });
            setTimeout(() => {
                if (!dmapTilesOk) {
                    notice.textContent = "지도 타일이 오지 않습니다 — 카카오 개발자 콘솔 > "
                        + "앱 설정 > 플랫폼 > Web 에 이 사이트 주소"
                        + `(${location.origin})가 등록돼 있는지 확인하세요.`;
                }
            }, 7000);
            // 빈 곳을 누르면 마커 팝업을 닫습니다 (마커·폴리곤 클릭은 여기로 안
            // 옵니다 — clickable 오버레이가 이벤트를 삼킵니다).
            kakao.maps.event.addListener(dmapMap, "click", dmapClosePopup);
            mapCreated = true;
        } catch (exc) {
            // SDK 실패(대개 도메인 미등록)여도 카드는 계속합니다 — 목록·상세는
            // 데이터만으로 돕니다(판단 [4]). dmapMap 이 없는 채로 남으므로
            // 다음 진입 때 SDK 만 다시 시도합니다.
            notice.textContent = String(exc.message || exc);
        } finally {
            dmapSdkLoading = false;
        }
    }
    // 첫 진입이면 데이터·목록·상세를 그리고, 재진입은 지도가 방금 생긴 때만
    // 다시 그립니다(마커를 이제야 찍을 수 있어서). 그 외 재진입은 원래대로 무시.
    if (first || mapCreated) await drawStoreMap();
}

// 매장 마커를 찍고, 좌표·폐점 실태를 카드가 스스로 밝힙니다(판단 [5]).
// 지도가 없으면 마커만 건너뜁니다 — 목록·상세는 그대로 그립니다(판단 [4]).
export async function drawStoreMap() {
    const map = dmapMap;
    const notice = $("dmap-notice");
    const meta = $("dmap-meta");

    for (const marker of dmapMarkers) marker.setMap(null);
    dmapMarkers = [];
    dmapClosePopup();

    const filters = dmapFilters();
    const periodLabel = filters.p_ym_from === filters.p_ym_to
        ? ymLabel(filters.p_ym_from)
        : `${ymLabel(filters.p_ym_from)}~${ymLabel(filters.p_ym_to)}`;

    // 좌표(마커)·매장별 매출·폐점 상태를 함께 받습니다. 매출은 마커 클릭 시점에
    // 클로저로 읽으므로, 뒤늦게 도착해도 마커를 다시 그릴 필요가 없습니다.
    const storeSales = new Map();
    const [points, metrics, closedRows] = await Promise.all([
        db.rpc("api_store_points").then((r) => (r.error ? null : r.data)).catch(() => null),
        db.rpc("api_store_metrics", {
            p_ym_from: filters.p_ym_from,
            p_ym_to: filters.p_ym_to,
            p_channel: null,
        }).then((r) => (r.error ? [] : (r.data || []))).catch(() => []),
        // 27 의 최근 이벤트가 close 인 매장 — 마커를 흐리게 구분합니다.
        db.rpc("api_store_lifecycle_status", { p_status: "close" })
            .then((r) => (r.error ? [] : (r.data || []))).catch(() => []),
    ]);
    for (const row of (metrics || [])) storeSales.set(row.store, row);
    dmapClosed = new Map();
    for (const row of (closedRows || [])) dmapClosed.set(row.store_name, row);

    if (!points) {
        notice.textContent = "매장 좌표가 이 환경에 아직 들어오지 않았습니다"
            + " (api_store_points).";
        meta.textContent = "";
        $("dmap-gaps").hidden = true;
        await refreshDetail(filters);
        return;
    }

    const allPoints = (points || {}).rows || [];
    const pointRows = allPoints.filter((p) =>
        !filters.p_store || p.store === filters.p_store);

    for (const point of pointRows) {
        if (!map) break;                          // 지도 없이는 마커만 생략 (판단 [4])
        const closed = dmapClosed.get(point.store);
        const at = new kakao.maps.LatLng(point.lat, point.lng);
        const marker = new kakao.maps.Marker({
            position: at,
            title: point.store + (closed ? " (폐점)" : ""),   // 마우스를 올리면 이름
            zIndex: closed ? 4 : 5,
            // 폐점 매장은 흐리게 — 지우면 '어디 있었나'가 사라져서 안 지웁니다.
            opacity: closed ? 0.4 : 1,
            // ⚠️ 이게 없으면 click 리스너를 달아도 안 불립니다(기본값 false).
            clickable: true,
        });
        marker.setMap(map);
        dmapMarkers.push(marker);
        kakao.maps.event.addListener(marker, "click", () => {
            dmapClosePopup();
            const el = document.createElement("div");
            el.className = "dmap-popup";
            const name = document.createElement("div");
            name.className = "dmap-popup-store";
            name.textContent = point.store;
            el.append(name);

            const row = storeSales.get(point.store);
            const sales = document.createElement("div");
            const amount = Number((row || {}).amount) || 0;
            sales.textContent = row
                ? `${periodLabel} 매출 ${won(amount)}원`
                : `${periodLabel} 매출 없음`;
            el.append(sales);
            if (row) {
                const hall = Number(row.hall_amount) || 0;
                const delivery = Number(row.delivery_amount) || 0;
                const split = document.createElement("div");
                split.className = "dmap-popup-note";
                split.textContent = `홀 ${won(hall)}원 · 배달 ${won(delivery)}원`;
                el.append(split);
            }

            if (closed) {
                const line = document.createElement("div");
                line.className = "dmap-popup-note";
                line.textContent = `폐점 (${closed.since}부터)`;
                el.append(line);
            }
            const where = `${point.sigungu || ""} ${point.dong || ""}`.trim();
            if (where) {
                const line = document.createElement("div");
                line.className = "dmap-popup-note";
                line.textContent = where;
                el.append(line);
            }
            if (point.confidence === "keyword") {
                const line = document.createElement("div");
                line.className = "dmap-popup-note";
                line.textContent = "위치는 상호검색 결과";
                el.append(line);
            }
            const close = document.createElement("button");
            close.type = "button";
            close.className = "dmap-popup-close";
            close.textContent = "×";
            close.setAttribute("aria-label", "닫기");
            close.addEventListener("click", dmapClosePopup);
            el.append(close);
            dmapOverlay = new kakao.maps.CustomOverlay({
                position: at,
                content: el,
                yAnchor: 1,
                zIndex: 6,
                clickable: true,
            });
            dmapOverlay.setMap(map);

            // 팝업은 요약까지 — 상세는 지도 아래 블록이 맡습니다(판단 [3]).
            dmapDetailStore = point.store;
            renderStoreDetail(point.store, dmapFilters(), storeSales.get(point.store));
        });
    }

    // 전 매장에 화면을 맞추면(setBounds) 전국이 다 들어와 너무 멀어집니다
    // (2026-08-14 담당자). 처음 화면은 초기 center(서울)를 그대로 두고,
    // 매장을 하나 고른 때만 그 매장으로 옮깁니다.
    if (map && filters.p_store && dmapMarkers.length) {
        map.setCenter(dmapMarkers[0].getPosition());
        if (map.getLevel() > 5) map.setLevel(5);
    }

    // 좌표·폐점 실태 — 매출은 있는데 좌표가 없는 매장(대개 신규)은 지도에서
    // 그냥 안 보이므로 목록으로 밝힙니다(판단 [5]). geocode 반입 후 나타납니다.
    const pointNames = new Set(allPoints.map((p) => p.store));
    const missing = (metrics || [])
        .filter((r) => (Number(r.amount) || 0) > 0 && !pointNames.has(r.store))
        .map((r) => r.store);
    const closedShown = allPoints.filter((p) => dmapClosed.has(p.store))
        .map((p) => p.store);
    const gaps = $("dmap-gaps");
    const parts = [];
    if (missing.length) {
        const head = missing.slice(0, 10).map((n) => escape(n)).join(", ");
        const rest = missing.length > 10 ? ` 외 ${int(missing.length - 10)}곳` : "";
        parts.push(`좌표 없는 매장 ${int(missing.length)}곳 — 좌표 반입 후 `
            + `지도에 보입니다: ${head}${rest}`);
    }
    if (closedShown.length) {
        parts.push(`폐점 매장 ${int(closedShown.length)}곳은 흐린 마커: `
            + closedShown.map((n) => escape(n)).join(", "));
    }
    gaps.hidden = !parts.length;
    gaps.innerHTML = parts.join("<br>");

    // 좌표를 못 찾은 매장은 지도에서 그냥 안 보입니다 — 몇 곳인지는 밝힙니다.
    const withSales = [...storeSales.values()].filter((r) => (Number(r.amount) || 0) > 0).length;
    const total = [...storeSales.values()].reduce((s, r) => s + (Number(r.amount) || 0), 0);
    meta.textContent = `매장 ${int(pointRows.length)}곳`
        + (closedShown.length ? ` · 폐점 ${int(closedShown.length)}곳` : "")
        + ` · ${periodLabel} 매출 있는 매장 ${int(withSales)}곳 · 합계 ${won(total)}원`;
    if (map) {
        notice.textContent = "마커를 누르면 그 매장의 상세가 지도 아래에 뜹니다.";
    }

    await refreshDetail(filters, storeSales);
}

// 고르개 상태에 맞춰 상세 블록을 갱신합니다. 매장을 하나 골랐으면 그 매장,
// 이미 열려 있던 매장이 있으면 새 기간으로 다시, 아니면 닫습니다.
async function refreshDetail(filters, storeSales) {
    if (filters.p_store) dmapDetailStore = filters.p_store;
    if (dmapDetailStore) {
        await renderStoreDetail(dmapDetailStore, filters,
            storeSales ? storeSales.get(dmapDetailStore) : null);
    } else {
        hideDetail();
    }
}

function hideDetail() {
    dmapDetailStore = null;
    const box = $("dmap-detail");
    box.hidden = true;
    box.innerHTML = "";
}

// ---- 매장 상세 블록 (판단 [3]) ---------------------------------------------
//
// 전부 기존 조회 함수 조합입니다 — 새 SQL 없음:
//   매출 나눔      api_store_metrics (drawStoreMap 이 넘겨줌 · 없으면 여기서 조회)
//   많이 팔린 메뉴 api_by_menu (상위 5)
//   최근 3개월     api_monthly (종료월 기준 3개월 · 홀/배달 쌓은 미니 막대)
//   리뷰           api_review_summary (평점 · 별점 1~2점 수)
//   급증·급감      api_sales_alerts (종료월 · 채널별 전월/전년比 판정)
//   오픈일·폐점    api_store_lifecycle (27 — 기록 없는 매장은 표시 안 함)
async function renderStoreDetail(store, filters, salesRow) {
    const box = $("dmap-detail");
    const seq = ++dmapDetailSeq;
    box.hidden = false;
    box.innerHTML = '<p class="hint">매장 상세를 불러오는 중…</p>';

    const from = filters.p_ym_from, to = filters.p_ym_to;
    const rpc = (name, args) =>
        db.rpc(name, args).then((r) => (r.error ? null : r.data)).catch(() => null);

    const [menus, monthly, reviewData, alertData, events, metricsData] = await Promise.all([
        rpc("api_by_menu", { p_ym_from: from, p_ym_to: to, p_store: store, p_channel: null }),
        rpc("api_monthly", { p_ym_from: shiftYm(to, -2), p_ym_to: to,
                             p_store: store, p_channel: null }),
        rpc("api_review_summary", { p_ym_from: from, p_ym_to: to,
                                    p_store: store, p_platform: null }),
        rpc("api_sales_alerts", { p_ym: to, p_store: store }),
        rpc("api_store_lifecycle", { p_store: store, p_limit: 200 }),
        // 마커 클릭 경로는 salesRow 가 이미 있어 이 호출을 건너뜁니다.
        salesRow ? Promise.resolve(null)
            : rpc("api_store_metrics", { p_ym_from: from, p_ym_to: to, p_channel: null }),
    ]);
    if (seq !== dmapDetailSeq) return;            // 더 새 요청이 이미 그렸음

    if (!salesRow && Array.isArray(metricsData)) {
        salesRow = metricsData.find((r) => r.store === store) || null;
    }

    const periodLabel = from === to ? ymLabel(from) : `${ymLabel(from)}~${ymLabel(to)}`;
    const closed = dmapClosed.get(store);
    const openEvents = (Array.isArray(events) ? events : [])
        .filter((e) => e.event_type === "open");
    const openDate = openEvents.length
        ? openEvents[openEvents.length - 1].event_date : null;   // 최신순이라 끝이 첫 오픈

    box.innerHTML = "";
    const head = document.createElement("div");
    head.className = "dmap-detail-head";
    const title = document.createElement("strong");
    title.textContent = store;
    head.append(title);
    if (closed) {
        const badge = document.createElement("span");
        badge.className = "dmap-badge dmap-badge-down";
        badge.textContent = `폐점 (${closed.since}부터)`;
        head.append(badge);
    }
    if (openDate) {
        const span = document.createElement("span");
        span.className = "dmap-detail-open";
        span.textContent = `오픈 ${openDate}`;
        head.append(span);
    }
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "dmap-detail-close";
    closeBtn.textContent = "×";
    closeBtn.setAttribute("aria-label", "상세 닫기");
    closeBtn.addEventListener("click", hideDetail);
    head.append(closeBtn);
    box.append(head);

    // ---- 기간 매출 (홀·배달 나눔) ----
    const stats = document.createElement("div");
    stats.className = "dmap-detail-stats";
    const stat = (label, value) => {
        const d = document.createElement("div");
        d.className = "dmap-stat";
        d.innerHTML = `<span>${escape(label)}</span><b>${escape(value)}</b>`;
        stats.append(d);
    };
    if (salesRow) {
        stat(`${periodLabel} 매출`, `${won(Number(salesRow.amount) || 0)}원`);
        stat("홀", `${won(Number(salesRow.hall_amount) || 0)}원`);
        stat("배달", `${won(Number(salesRow.delivery_amount) || 0)}원`);
        if (salesRow.avg_ticket) stat("평균 단가", `${int(salesRow.avg_ticket)}원`);
    } else {
        stat(`${periodLabel} 매출`, "없음");
    }
    box.append(stats);

    const grid = document.createElement("div");
    grid.className = "dmap-detail-grid";
    box.append(grid);

    // ---- 최근 3개월 추이 (미니 차트) ----
    const trendBox = document.createElement("div");
    trendBox.innerHTML = `<h3>최근 3개월 (${ymLabel(shiftYm(to, -2))}~${ymLabel(to)})</h3>`;
    trendBox.append(miniTrend(Array.isArray(monthly) ? monthly : []));
    grid.append(trendBox);

    // ---- 많이 팔린 메뉴 (상위 5) ----
    const menuBox = document.createElement("div");
    menuBox.innerHTML = "<h3>많이 팔린 메뉴</h3>";
    const menuTable = document.createElement("div");
    menuTable.className = "tableview";
    const top = (Array.isArray(menus) ? menus : []).slice(0, 5);
    table(menuTable, ["메뉴", "분류", "매출", "수량"], top.map((r) => [
        r.menu, catLabel(r.category), wonFull(r.amount), int(r.qty),
    ]));
    menuBox.append(menuTable);
    grid.append(menuBox);

    // ---- 리뷰 · 급증급감 ----
    const noteBox = document.createElement("div");
    noteBox.innerHTML = "<h3>리뷰 · 판정</h3>";
    const lines = document.createElement("div");
    lines.className = "dmap-detail-lines";

    const summary = (Array.isArray(reviewData) && reviewData[0]) ? reviewData[0].summary : null;
    if (summary && summary.total) {
        const negative = (summary.by_rating || [])
            .filter((r) => Number(r.rating) <= 2)
            .reduce((s, r) => s + (Number(r.count) || 0), 0);
        lines.append(detailLine(
            `리뷰 ${int(summary.total)}건 · 평점 ${summary.avg_rating ?? "—"}`
            + (negative ? ` · 별점 1~2점 ${int(negative)}건` : ""),
            negative ? "down" : null));
    } else {
        lines.append(detailLine(`${periodLabel} 리뷰 없음`, null));
    }

    const alertRows = (Array.isArray(alertData) && alertData[0]) ? alertData[0].alerts : null;
    const mine = (alertRows || []).find((r) => r.store === store);
    const judged = [];
    for (const ch of (mine ? mine.channels || [] : [])) {
        for (const [dirKey, pctKey, label] of [
            ["mom_direction", "mom_pct_change", "전월비"],
            ["yoy_direction", "yoy_pct_change", "전년比"],
        ]) {
            if (ch[dirKey] === "급증" || ch[dirKey] === "급감") {
                const pct = ch[pctKey];
                judged.push({
                    text: `${ch.channel} ${label} ${pct > 0 ? "+" : ""}${pct}% ${ch[dirKey]}`,
                    kind: ch[dirKey] === "급증" ? "up" : "down",
                });
            }
        }
    }
    if (judged.length) {
        for (const j of judged) lines.append(detailLine(`${ymLabel(to)} ${j.text}`, j.kind));
    } else if (mine) {
        lines.append(detailLine(`${ymLabel(to)} 급증·급감 없음`, null));
    } else {
        lines.append(detailLine(`${ymLabel(to)} 판정 대상 매출 없음`, null));
    }
    noteBox.append(lines);
    grid.append(noteBox);
}

function detailLine(text, kind) {
    const p = document.createElement("p");
    p.textContent = text;
    if (kind === "up") p.className = "dmap-line-up";
    if (kind === "down") p.className = "dmap-line-down";
    return p;
}

// 최근 3개월 홀/배달 쌓은 미니 막대. charts.js 의 drawBars 는 상세 블록에
// 너무 커서(240px) 여기서 작게 그립니다 — 색은 같은 팔레트를 씁니다.
function miniTrend(rows) {
    const byYm = new Map();
    for (const r of rows) {
        const cur = byYm.get(r.ym) || { 홀: 0, 배달: 0 };
        cur[r.channel] = (cur[r.channel] || 0) + (Number(r.amount) || 0);
        byYm.set(r.ym, cur);
    }
    const yms = [...byYm.keys()].sort((a, b) => a - b);
    if (!yms.length) {
        const p = document.createElement("p");
        p.className = "hint";
        p.textContent = "이 기간 매출 기록이 없습니다.";
        return p;
    }
    const colors = palette();
    const width = 300, height = 120, padBottom = 18, padTop = 16;
    const plotH = height - padBottom - padTop;
    const slot = width / yms.length;
    const barW = Math.min(48, slot - 16);
    const max = Math.max(1, ...yms.map((ym) => {
        const v = byYm.get(ym);
        return (v["홀"] || 0) + (v["배달"] || 0);
    }));

    const parts = [];
    yms.forEach((ym, i) => {
        const v = byYm.get(ym);
        const hall = v["홀"] || 0, delivery = v["배달"] || 0;
        const total = hall + delivery;
        const cx = slot * i + slot / 2;
        const hH = plotH * hall / max;
        const dH = plotH * delivery / max;
        const base = height - padBottom;
        const tip = `${ymLabel(ym)} 합계 ${won(total)}원 (홀 ${won(hall)}원 · 배달 ${won(delivery)}원)`;
        parts.push(
            `<g><title>${escape(tip)}</title>`,
            `<rect x="${cx - barW / 2}" y="${base - hH}" width="${barW}"`
                + ` height="${Math.max(1, hH)}" fill="${colors.s1}" rx="1"/>`,
            `<rect x="${cx - barW / 2}" y="${base - hH - dH}" width="${barW}"`
                + ` height="${Math.max(1, dH)}" fill="${colors.s2}" rx="1"/>`,
            `<text x="${cx}" y="${base - hH - dH - 4}" text-anchor="middle" font-size="10"`
                + ` fill="${colors.secondary}"`
                + ` style="font-variant-numeric:tabular-nums">${won(total)}</text>`,
            "</g>",
            `<text x="${cx}" y="${height - 5}" text-anchor="middle" font-size="10"`
                + ` fill="${colors.muted}">${ymLabel(ym)}</text>`,
        );
    });
    parts.push(`<line x1="0" y1="${height - padBottom}" x2="${width}"`
        + ` y2="${height - padBottom}" stroke="${colors.base}" stroke-width="1"/>`);

    const wrap = document.createElement("div");
    wrap.className = "dmap-trend";
    wrap.innerHTML =
        `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="최근 3개월 매출">`
        + parts.join("") + "</svg>"
        + `<div class="dmap-trend-legend">`
        + `<span><i style="background:${colors.s1}"></i>홀</span>`
        + `<span><i style="background:${colors.s2}"></i>배달</span></div>`;
    return wrap;
}
