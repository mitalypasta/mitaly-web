// 광고 (6번 영역) — app.js 에서 뽑아낸 첫 '영역' 모듈
// (docs/web-split-plan.md 3단계). db + foundation 만 import 하면 영역 하나가
// 자기 파일로 독립합니다. 다른 영역도 같은 꼴로 뽑아낼 수 있습니다.
//
// 본사에 광고비 집행내역 자료가 애초에 없음이 확정돼(2026-08-11 담당자) 반입
// 대기가 아니라 웹에서 직접 넣습니다(큐 #92). 쓰기는 76 의 DEFINER 함수 2종
// (api_ad_spend_save·api_ad_spend_delete)만 부릅니다. 엑셀 반입과 같은 표에
// 공존하고 출처는 source 로 갈립니다('web' vs 파일명).

import { db, fetchStores } from "./client.js";
import { won, wonFull, int, ymLabel, ymDash } from "./format.js";
import { escape } from "./util.js";
import { table, $, searchify } from "./dom.js";

// 매장 보기(아래)가 같은 응답을 다시 쓰려고 마지막 rows 를 들고 있습니다.
let adsRows = [];

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
    adsRows = rows;
    // 추가·삭제 뒤에도 매장 보기가 같은 자료를 비추도록 같이 다시 그립니다.
    refreshAdsStore({ adsOnly: true });
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

// ---- 매장 보기 (카드 #131 · 담당자 지시 2026-08-21) ------------------------
//
// 매장 대시보드와 같은 문법 — searchify 콤보로 매장을 고르면 그 매장 단면이
// 채워집니다. ① 광고 실적: api_ad_spend 응답(loadAds 가 받아 둔 adsRows)을
// 매장으로 거른 것 — 광고비 집행내역은 본사에 자료가 부존재 확정(2026-08-11)
// 이라 없으면 빈 자리 그대로 둡니다. ② 배달앱 메뉴 대조: 57 의
// api_delivery_menu_check(p_store) 가 매장 인자를 받으므로 그대로 재사용.

const AS_DM_KIND_LABEL = {      // pos.js 의 DM_KIND_LABEL 과 같은 말
    app_only:    "POS 에 없음",
    hidden:      "앱에서 숨김",
    channel_gap: "한쪽 앱만",
    price_diff:  "가격 다름",
};

let asSeq = 0;   // 매장을 빠르게 바꿀 때 늦게 온 대조 응답 버리기

function asTile(label, value, sub) {
    return `<div class="tile"><div class="label">${escape(label)}</div>`
        + `<div class="value">${value}</div>`
        + (sub ? `<div class="sub">${sub}</div>` : "") + `</div>`;
}

function renderAdsStoreAds(name) {
    const mine = adsRows.filter((r) => r.store === name);
    const hint = $("adv-ads-hint");
    if (!mine.length) {
        $("adv-kpis").innerHTML = "";
        hint.hidden = false;
        hint.textContent = "이 매장의 광고 집행 자료가 아직 없습니다 — "
            + "아래 '광고 집행 현황'에서 넣으면 여기에 잡힙니다.";
        $("t-adv-ads").innerHTML = "";
        return;
    }
    hint.hidden = true;
    const sum = (key) => mine.reduce((a, r) => a + (Number(r[key]) || 0), 0);
    const yms = mine.map((r) => r.ym);
    $("adv-kpis").innerHTML = [
        asTile("광고비 합계", escape(won(sum("cost"))),
            `${ymLabel(Math.min(...yms))} ~ ${ymLabel(Math.max(...yms))}`),
        asTile("노출 수", escape(int(sum("impressions"))), ""),
        asTile("클릭 수", escape(int(sum("clicks"))), ""),
        asTile("광고로 들어온 주문", escape(int(sum("orders"))), ""),
    ].join("");
    table($("t-adv-ads"),
        ["월", "채널", "광고 이름", "광고비", "노출 수", "클릭 수",
         "광고로 들어온 주문", "출처"],
        mine.map((r) => [
            ymLabel(r.ym), escape(r.channel), escape(r.campaign || "—"),
            wonFull(r.cost),
            r.impressions == null ? "—" : int(r.impressions),
            r.clicks == null ? "—" : int(r.clicks),
            r.orders == null ? "—" : int(r.orders),
            r.source === "web" ? "웹 입력" : escape(r.source || "반입"),
        ]),
        { html: true });
}

async function renderAdsStoreMenus(name, seq) {
    const meta = $("adv-dm-meta");
    const view = $("t-adv-dm");
    meta.textContent = "불러오는 중…";
    const { data, error } = await db.rpc("api_delivery_menu_check", { p_store: name });
    if (seq !== asSeq) return;
    if (error) {
        // 57 이 아직 없는 환경(PGRST202)은 전체 카드(pos.js)와 같은 문구로.
        const missing = error.code === "PGRST202"
            || /Could not find the function/i.test(error.message || "");
        meta.textContent = "";
        view.innerHTML = missing
            ? '<p class="hint">배달앱 메뉴 대조는 아직 이 환경에 들어오지 '
              + "않았습니다. 반영되면 자동으로 나타납니다.</p>"
            : '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + "</p>";
        return;
    }
    const d = data || {};
    if (!d.collected_at) {
        meta.textContent = "";
        view.innerHTML = '<p class="hint">배달앱 메뉴 반입이 아직 없습니다 — '
            + "반입되면 자동으로 대조합니다.</p>";
        return;
    }
    const items = d.items || [];
    const counts = d.counts || {};
    const parts = Object.keys(AS_DM_KIND_LABEL)
        .filter((k) => counts[k])
        .map((k) => `${AS_DM_KIND_LABEL[k]} ${int(counts[k])}`);
    meta.textContent = `기준 ${String(d.collected_at).slice(0, 10)}`
        + (parts.length ? ` · ${parts.join(" · ")}` : "");
    if (!items.length) {
        view.innerHTML = '<p class="hint">이 매장은 배달앱 메뉴판과 POS 가 '
            + "어긋난 항목이 없습니다.</p>";
        return;
    }
    table(view,
        ["종류", "앱", "메뉴", "분류", "앱 가격", "POS 가격"],
        items.map((it) => [
            AS_DM_KIND_LABEL[it.kind] || it.kind,
            it.platform === "baemin" ? "배민" : "요기요",
            it.menu_name + (it.hidden && it.kind !== "hidden" ? " (숨김)" : ""),
            it.category || "—",
            it.price == null ? "—" : wonFull(it.price),
            it.pos_price == null ? "—" : wonFull(it.pos_price),
        ]));
}

// adsOnly: 광고 추가·삭제 뒤 loadAds 가 부르는 경로 — 메뉴 대조는 그대로 두고
// 광고 실적 쪽만 다시 그립니다(대조는 광고 편집으로 안 변합니다).
function refreshAdsStore({ adsOnly } = {}) {
    const select = $("adv-store");
    if (!select) return;
    const name = select.value;
    const empty = $("adv-empty");
    const detail = $("adv-detail");
    if (!name) {
        empty.hidden = false;
        detail.hidden = true;
        $("adv-meta").textContent = "";
        return;
    }
    empty.hidden = true;
    detail.hidden = false;
    $("adv-meta").textContent = name;
    renderAdsStoreAds(name);
    if (!adsOnly) renderAdsStoreMenus(name, ++asSeq);
}

async function initAdsStoreView() {
    const select = $("adv-store");
    const { data: stores } = await fetchStores();
    for (const s of stores || []) {
        const option = document.createElement("option");
        // 광고 행·메뉴 대조 rpc 둘 다 매장 이름이 키입니다.
        option.value = s.name;
        option.textContent = s.name;
        select.append(option);
    }
    searchify(select);
    select.addEventListener("change", () => refreshAdsStore());
}

export async function initAds() {
    $("ads-save").addEventListener("click", saveAd);
    initAdsStoreView();

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
