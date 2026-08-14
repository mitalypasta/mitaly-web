// 매장 지도 (6번 영역) — app.js 에서 뽑아낸 shell 분리 조각
// (docs/web-split-plan.md). dmapMap 은 대시보드(app.js)가 고르개 변경 때
// '지도가 떠 있으면 다시 그리기' 판단에 읽습니다(live import 바인딩).

import { won, int, ymLabel } from "./format.js";
import { $ } from "./dom.js";
import { db } from "./client.js";

// ---- 매장 지도 (6번 영역) ---------------------------------------------------
//
// 매장 위치를 카카오맵에 마커로 찍고, 마커를 누르면 그 매장의 선택 기간
// 매출을 옆 창에 보여주는 화면입니다. SDK 는 화면에 처음 들어올 때 한 번만
// 로드합니다 — 숨겨진 컨테이너에 지도를 만들면 크기를 못 잡기 때문에
// (카카오맵 특성) 게으르게 합니다.
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

let dmapStarted = false;
export let dmapMap = null;
let dmapMarkers = [];           // 지금 찍혀 있는 매장 마커
let dmapOverlay = null;         // 마커 클릭 팝업 (한 번에 하나, S17)

export function initDeliveryMap() {
    for (const b of document.querySelectorAll('.navitem[data-go="map"]')) {
        b.addEventListener("click", () => setTimeout(loadDeliveryMap, 80));
    }
}

function dmapClosePopup() {
    if (dmapOverlay) { dmapOverlay.setMap(null); dmapOverlay = null; }
}

/** 지도 카드 자체 고르개를 읽습니다 — 전역 currentFilters() 대신 (S17).
 *  위 필터 줄이 지도 영역에서는 안 보여서 카드가 직접 갖습니다(initDashboard). */
function dmapFilters() {
    let from = Number($("dmap-from").value) || null;
    let to = Number($("dmap-to").value) || null;
    if (from && to && from > to) [from, to] = [to, from];
    return { p_ym_from: from, p_ym_to: to, p_store: $("dmap-store").value || null };
}

async function loadDeliveryMap() {
    if (dmapStarted) return;
    const key = (window.MITALY_CONFIG || {}).kakaoMapKey || "";
    const notice = $("dmap-notice");
    if (!key) {
        notice.textContent = "카카오맵 JS 키가 아직 없습니다 — config.js 의 "
            + "kakaoMapKey 가 채워지면 이 자리에 지도가 뜹니다.";
        return;
    }
    dmapStarted = true;
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
    } catch (exc) {
        dmapStarted = false;           // 도메인 등록 뒤 다시 들어오면 재시도
        notice.textContent = String(exc.message || exc);
        return;
    }

    dmapMap = new kakao.maps.Map($("dmap-container"), {
        center: new kakao.maps.LatLng(37.5665, 126.978),   // 서울 시청
        level: 8,
    });
    // 카드가 방금 보이기 시작한 참이라 컨테이너가 0 크기로 재졌을 수 있습니다
    // — 카카오맵은 그 경우 회색 빈 화면이 됩니다. 한 번 다시 재 봅니다.
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
    // 빈 곳을 누르면 마커 팝업을 닫습니다 (마커·폴리곤 클릭은 여기로 안 옵니다
    // — clickable 오버레이가 이벤트를 삼킵니다).
    kakao.maps.event.addListener(dmapMap, "click", dmapClosePopup);
    await drawStoreMap();
}

// 매장 마커를 찍고, 마커를 누르면 그 매장의 선택 기간 매출을 옆 창에 보여줍니다.
// (옛 동 단위 색칠은 걷어냈습니다 — 과거 배달주소에 동 정보가 없어 대부분
//  (미상)이었습니다. 재수집 없이 쓸 수 있는 '매장 위치 + 매출'만 남깁니다.)
export async function drawStoreMap() {
    const map = dmapMap;
    const notice = $("dmap-notice");
    const meta = $("dmap-meta");
    if (!map) return;

    for (const marker of dmapMarkers) marker.setMap(null);
    dmapMarkers = [];
    dmapClosePopup();

    const filters = dmapFilters();
    const periodLabel = filters.p_ym_from === filters.p_ym_to
        ? ymLabel(filters.p_ym_from)
        : `${ymLabel(filters.p_ym_from)}~${ymLabel(filters.p_ym_to)}`;

    // 좌표(마커)와 매장별 매출을 함께 받습니다. 매출은 마커 클릭 시점에 클로저로
    // 읽으므로, 뒤늦게 도착해도 마커를 다시 그릴 필요가 없습니다.
    const storeSales = new Map();
    const [points, metrics] = await Promise.all([
        db.rpc("api_store_points").then((r) => (r.error ? null : r.data)).catch(() => null),
        db.rpc("api_store_metrics", {
            p_ym_from: filters.p_ym_from,
            p_ym_to: filters.p_ym_to,
            p_channel: null,
        }).then((r) => (r.error ? [] : (r.data || []))).catch(() => []),
    ]);
    for (const row of (metrics || [])) storeSales.set(row.store, row);

    if (!points) {
        notice.textContent = "매장 좌표가 이 환경에 아직 들어오지 않았습니다"
            + " (api_store_points).";
        meta.textContent = "";
        return;
    }

    const pointRows = ((points || {}).rows || []).filter((p) =>
        !filters.p_store || p.store === filters.p_store);

    for (const point of pointRows) {
        const at = new kakao.maps.LatLng(point.lat, point.lng);
        const marker = new kakao.maps.Marker({
            position: at,
            title: point.store,          // 마우스를 올리면 이름
            zIndex: 5,
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
        });
    }

    // 전 매장에 화면을 맞추면(setBounds) 전국이 다 들어와 너무 멀어집니다
    // (2026-08-14 담당자). 처음 화면은 초기 center(서울)를 그대로 두고,
    // 매장을 하나 고른 때만 그 매장으로 옮깁니다.
    if (filters.p_store && dmapMarkers.length) {
        map.setCenter(dmapMarkers[0].getPosition());
        if (map.getLevel() > 5) map.setLevel(5);
    }

    // 좌표를 못 찾은 매장은 지도에서 그냥 안 보입니다 — 몇 곳인지는 밝힙니다.
    const withSales = [...storeSales.values()].filter((r) => (Number(r.amount) || 0) > 0).length;
    const total = [...storeSales.values()].reduce((s, r) => s + (Number(r.amount) || 0), 0);
    meta.textContent = `매장 ${int(dmapMarkers.length)}곳 · ${periodLabel} `
        + `매출 있는 매장 ${int(withSales)}곳 · 합계 ${won(total)}원`;
    notice.textContent = "마커를 누르면 그 매장의 선택 기간 매출이 옆에 뜹니다.";
}
