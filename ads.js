// 광고 (6번 영역) — app.js 에서 뽑아낸 첫 '영역' 모듈
// (docs/web-split-plan.md 3단계). db + foundation 만 import 하면 영역 하나가
// 자기 파일로 독립합니다. 다른 영역도 같은 꼴로 뽑아낼 수 있습니다.
//
// 본사에 광고비 집행내역 자료가 애초에 없음이 확정돼(2026-08-11 담당자) 반입
// 대기가 아니라 웹에서 직접 넣습니다(큐 #92). 쓰기는 76 의 DEFINER 함수 2종
// (api_ad_spend_save·api_ad_spend_delete)만 부릅니다. 엑셀 반입과 같은 표에
// 공존하고 출처는 source 로 갈립니다('web' vs 파일명).

import { db, } from "./client.js";
import { won, wonFull, int, ymLabel, ymDash } from "./format.js";
import { escape } from "./util.js";
import { table, $ } from "./dom.js";

async function loadAds() {
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
        meta.textContent = "";
        $("ads-kpis").hidden = true;
        $("t-ads-channel").innerHTML = "";
        $("t-ads").innerHTML =
            '<p class="hint">아직 넣은 광고 자료가 없습니다. 위 칸에서 추가하세요.</p>';
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
    table($("t-ads-channel"), ["채널", "광고비", "노출 수", "클릭 수", "광고로 들어온 주문"],
        byChannel.map((c) => [c.channel, wonFull(c.cost), int(c.impressions),
                              int(c.clicks), int(c.orders)]));
    table($("t-ads"),
        ["월", "매장", "채널", "광고 이름", "광고비", "노출 수", "클릭 수",
         "광고로 들어온 주문", "출처", ""],
        rows.map((r) => [
            ymLabel(r.ym), escape(r.store), escape(r.channel),
            escape(r.campaign || "—"), wonFull(r.cost),
            r.impressions == null ? "—" : int(r.impressions),
            r.clicks == null ? "—" : int(r.clicks),
            r.orders == null ? "—" : int(r.orders),
            r.source === "web" ? "웹 입력" : escape(r.source || "반입"),
            `<button type="button" class="ghost" data-act="del" data-id="${r.id}"`
                + ` data-label="${escape(r.store)} ${ymLabel(r.ym)} ${escape(r.channel)}">삭제</button>`,
        ]),
        { html: true });
}

// 채널 선택값 — '기타' 는 직접 입력 칸의 이름이 실제 채널입니다.
// SQL(76 설계 판단 [5])이 채널을 자유 텍스트로 두므로 그대로 보내면 됩니다.
function channelValue() {
    const picked = $("ads-in-channel").value;
    return picked === "기타" ? $("ads-in-channel-etc").value.trim() : picked;
}

async function saveAd() {
    const notice = $("ads-notice");
    const button = $("ads-save");
    const ymRaw = $("ads-in-ym").value;              // "2026-01"
    const ym = ymRaw ? Number(ymRaw.replace("-", "")) : null;
    const channel = channelValue();
    const num = (id) => {
        const v = $(id).value.trim();
        return v === "" ? null : Number(v);
    };

    // 이중 제출 방지 — 공지·위반 카드와 같은 패턴(버튼을 잠그고 끝나면 풉니다).
    button.disabled = true;
    notice.className = "notice";
    notice.textContent = "넣는 중…";

    const { data, error } = await db.rpc("api_ad_spend_save", {
        p_store:       $("ads-in-store").value,
        p_ym:          ym,
        p_channel:     channel,
        p_cost:        num("ads-in-cost") ?? 0,
        p_campaign:    $("ads-in-campaign").value,
        p_impressions: num("ads-in-impressions"),
        p_clicks:      num("ads-in-clicks"),
        p_orders:      num("ads-in-orders"),
    });
    button.disabled = false;
    if (error) {
        notice.className = "notice error";
        notice.textContent = "넣지 못했습니다: " + error.message;
        return;
    }
    if (!data?.ok) {
        notice.className = "notice error";
        notice.textContent = data?.reason || "넣지 못했습니다.";
        return;
    }
    notice.textContent =
        `넣었습니다 — ${$("ads-in-store").value.trim()} ${ymDash(ym)} ${channel}`;
    // 매장·월·채널은 다음 줄을 이어 넣기 좋게 남기고, 값 칸만 비웁니다.
    for (const id of ["ads-in-campaign", "ads-in-cost", "ads-in-impressions",
                      "ads-in-clicks", "ads-in-orders"]) {
        $(id).value = "";
    }
    await loadAds();
}

export async function initAds() {
    $("ads-save").addEventListener("click", saveAd);

    // 채널에서 '기타' 를 고르면 이름 칸이 나타납니다.
    $("ads-in-channel").addEventListener("change", () => {
        const etc = $("ads-etc-field");
        etc.hidden = $("ads-in-channel").value !== "기타";
        if (!etc.hidden) $("ads-in-channel-etc").focus();
    });

    $("t-ads").addEventListener("click", async (event) => {
        const button = event.target.closest("button[data-act='del']");
        if (!button) return;
        if (!confirm(`삭제합니다 — ${button.dataset.label}`)) return;
        button.disabled = true;
        const { data, error } = await db.rpc("api_ad_spend_delete",
                                             { p_id: Number(button.dataset.id) });
        if (error || !data?.ok) {
            $("ads-notice").className = "notice error";
            $("ads-notice").textContent =
                "삭제하지 못했습니다: " + (error?.message || data?.reason || "");
            button.disabled = false;
            return;
        }
        $("ads-notice").className = "notice";
        $("ads-notice").textContent = `삭제했습니다 — ${button.dataset.label}`;
        await loadAds();
    });

    // 매장 이름 자동완성 — 목록에서 고르면 '매장을 찾지 못했습니다' 오타를
    // 겪지 않습니다(저장 함수는 이름 정확 일치).
    const { data: stores } = await db.from("stores").select("name").order("name");
    const list = $("ads-store-list");
    for (const s of stores || []) {
        const opt = document.createElement("option");
        opt.value = s.name;
        list.append(opt);
    }
    await loadAds();
}
