// 발주량 (아워홈) — 59_ourhome_orders.sql 위의 화면. app.js 에서 뽑은 영역
// 모듈(docs/web-split-plan.md). db + foundation 만 import. 식자재·발주 영역
// (data-area="ingredients") 안의 카드라, 초기화는 대시보드가 함께 부릅니다.
//
// 매장 고르개를 stores 표가 아니라 응답이 준 목록으로 채웁니다(아워홈에는
// 우리 대장에 없는 사업장이 있어서).

import { db } from "./client.js";
import { int, ymLabel, wonFull } from "./format.js";
import { escape } from "./util.js";
import { table, $, monthPicker } from "./dom.js";

let ohRangeReady = false;
let ohStoresReady = false;

// 이론 사용량 카드의 기본창(최근 3개월, 49 설계 [3])과 같은 계산입니다.
// 두 카드는 원래 대조용이라 기본창이 어긋나면 숫자가 안 맞아 보입니다 (큐 #102 [F]).
const shiftYm = (ym, months) => {
    const total = Math.floor(ym / 100) * 12 + (ym % 100 - 1) + months;
    return Math.floor(total / 12) * 100 + (total % 12) + 1;
};

export async function initOurhome() {
    // 시작·종료월은 브라우저 달력(0-1). 값 규칙(YYYYMM)은 monthPicker 가 맞춥니다.
    monthPicker("oh-from");
    monthPicker("oh-to");
    for (const id of ["oh-from", "oh-to", "oh-store"]) {
        $(id).addEventListener("change", refreshOurhome);
    }
    await refreshOurhome();
}

async function refreshOurhome() {
    const args = {};
    if ($("oh-from").value) args.p_from = Number($("oh-from").value);
    if ($("oh-to").value) args.p_to = Number($("oh-to").value);
    if ($("oh-store").value) args.p_store = $("oh-store").value;

    const { data, error } = await db.rpc("api_ourhome_orders", args);
    if (error) {
        $("t-ourhome-months").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + "</p>";
        return;
    }
    const d = data || {};

    if (!d.ym_min) {
        $("oh-meta").textContent = "";
        $("oh-coverage").textContent = "";
        $("t-ourhome-months").innerHTML =
            '<p class="hint">아직 반입된 발주량이 없습니다.</p>';
        $("t-ourhome-stores").innerHTML = "";
        return;
    }

    // 달력 범위는 첫 응답의 ym_min~ym_max 로 한 번만 잡습니다(이론 사용량과 같음).
    if (!ohRangeReady) {
        ohRangeReady = true;
        monthPicker("oh-from", { min: d.ym_min, max: d.ym_max });
        monthPicker("oh-to", { min: d.ym_min, max: d.ym_max });
        $("oh-from").value = String(d.from_ym);
        $("oh-to").value = String(d.to_ym);

        // 서버 기본은 최근 1개월(59 머리말 — 18개월 기본이 무거워서)입니다.
        // 이론 사용량 기본창(최근 3개월)과 맞추되, 넓히는 쪽은 화면에서 합니다
        // ([F] — 서버 기본을 넓히면 prod 함수를 손대야 해서). 자료가 3개월이
        // 안 되면 있는 만큼만.
        const wantFrom = Math.max(shiftYm(d.to_ym, -2), d.ym_min);
        if (wantFrom < d.from_ym) {
            $("oh-from").value = String(wantFrom);
            await refreshOurhome();
            return;
        }
    }

    const stores = Array.isArray(d.stores) ? d.stores : [];
    if (!ohStoresReady && stores.length) {
        ohStoresReady = true;
        const select = $("oh-store");
        for (const name of stores.map((s) => s.store).sort((a, b) => a.localeCompare(b, "ko"))) {
            const opt = document.createElement("option");
            opt.value = name;
            opt.textContent = name;
            select.append(opt);
        }
    }

    const total = d.total || {};
    $("oh-meta").textContent =
        `${ymLabel(d.from_ym)} ~ ${ymLabel(d.to_ym)} · ` +
        `${int(total.qty)}개 · ${wonFull(total.amount)}`;

    // 커버리지를 숨기지 않습니다 — 아워홈 사업장 수와 우리 매장 수가 다른 것이
    // 정상이라, 그 차이를 화면이 말하지 않으면 숫자가 틀린 것처럼 보입니다.
    const cov = d.coverage || {};
    const unmatched = int(cov.stores_total - cov.stores_matched);
    $("oh-coverage").textContent =
        `아워홈 사업장 ${int(total.busipl)}곳 → 매장 ${int(total.stores)}곳` +
        (cov.stores_matched < cov.stores_total
            ? ` · 이 중 ${unmatched}곳은 우리 매장 대장과 아직 안 이어졌습니다`
            : "");

    table($("t-ourhome-months"), ["월", "사업장", "수량", "발주 금액"],
        (d.months || []).map((m) => [ymLabel(m.ym), int(m.busipl), int(m.qty),
                                     wonFull(m.amount)]));

    table($("t-ourhome-stores"),
        ["매장", "사업장코드", "월수", "수량", "발주 금액", "매장 연결"],
        stores.map((s) => [s.store, s.busiplcd, int(s.months), int(s.qty),
                           wonFull(s.amount), s.matched ? "○" : "—"]));
}
