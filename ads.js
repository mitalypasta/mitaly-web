// 광고 (6번 영역) — app.js 에서 뽑아낸 첫 '영역' 모듈
// (docs/web-split-plan.md 3단계). db + foundation 만 import 하면 영역 하나가
// 자기 파일로 독립합니다. 다른 영역도 같은 꼴로 뽑아낼 수 있습니다.

import { db, } from "./client.js";
import { won, wonFull, int, ymLabel } from "./format.js";
import { escape } from "./util.js";
import { table, $ } from "./dom.js";

export async function initAds() {
    const { data, error } = await db.rpc("api_ad_spend", {});
    const meta = $("ads-meta");
    if (error) {
        meta.textContent = "";
        $("t-ads").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + "</p>";
        return;
    }

    const rows = Array.isArray(data?.rows) ? data.rows : [];
    if (!rows.length) {
        meta.textContent = "자료 반입 전";
        $("ads-kpis").hidden = true;
        $("t-ads-channel").innerHTML = "";
        $("t-ads").innerHTML =
            '<p class="hint">아직 반입된 광고 자료가 없습니다.</p>';
        return;
    }

    const summary = data.summary || {};
    const yms = rows.map((r) => r.ym);
    meta.textContent = `${int(rows.length)}행`;
    $("ads-kpis").hidden = false;
    $("ads-cost").textContent = won(summary.cost);
    $("ads-range").textContent =
        `${ymLabel(Math.min(...yms))} ~ ${ymLabel(Math.max(...yms))}`;
    $("ads-impressions").textContent = int(summary.impressions);
    $("ads-clicks").textContent = int(summary.clicks);
    $("ads-orders").textContent = int(summary.orders);

    const byChannel = Array.isArray(data.by_channel) ? data.by_channel : [];
    table($("t-ads-channel"), ["채널", "광고비", "노출", "클릭", "광고 경유 주문"],
        byChannel.map((c) => [c.channel, wonFull(c.cost), int(c.impressions),
                              int(c.clicks), int(c.orders)]));
    table($("t-ads"), ["월", "매장", "채널", "캠페인", "광고비", "노출", "클릭", "주문"],
        rows.map((r) => [ymLabel(r.ym), r.store, r.channel, r.campaign || "—",
                         wonFull(r.cost),
                         r.impressions == null ? "—" : int(r.impressions),
                         r.clicks == null ? "—" : int(r.clicks),
                         r.orders == null ? "—" : int(r.orders)]));
}
