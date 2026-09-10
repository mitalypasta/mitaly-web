// 공지 (12번 영역, 53_announcements.sql) — app.js 에서 뽑아낸 shell 분리 조각
// (docs/web-split-plan.md).

import { int } from "./format.js";
import { escape, clip } from "./util.js";
import { $, table, setHero, heroFail } from "./dom.js";
import { db, fetchStores } from "./client.js";
import { refreshTasksSummary, refreshTaskList, taskStatusTag } from "./tasks.js";

// ---- 공지 (12번 영역, 53_announcements.sql) --------------------------------
//
// 자리는 카카오 채널이고(docs/area12-comms.md) 웹은 작성·승인·이력만 봅니다.
// 발송은 수집 PC 도구(tools/send_announcements.py)의 일 — 발송 이력 카드와
// 같은 역할 분담입니다. 대상 미리 세기는 가맹점DB(api_store_profiles)의
// 지역·SV 를 씁니다.

let anStores = [];     // {id, name}
let anProfiles = [];   // {store_id, region, sv_name, ...}

export async function initComms() {
    const { data: stores } = await fetchStores();
    anStores = stores || [];
    for (const s of anStores) {
        const opt = document.createElement("option");
        opt.value = s.id;
        opt.textContent = s.name;
        $("an-stores").append(opt);
    }
    const { data: profiles } = await db.rpc("api_store_profiles");
    anProfiles = Array.isArray(profiles) ? profiles : [];

    $("an-audience").addEventListener("change", onAnnouncementAudienceChange);
    $("an-value").addEventListener("change", drawAnnouncementTargetCount);
    $("an-stores").addEventListener("change", drawAnnouncementTargetCount);
    $("an-submit").addEventListener("click", submitAnnouncement);
    onAnnouncementAudienceChange();
    await refreshAnnouncements();
}

function onAnnouncementAudienceChange() {
    const kind = $("an-audience").value;
    $("an-value-field").hidden = kind !== "region" && kind !== "sv";
    $("an-stores-field").hidden = kind !== "stores";
    if (kind === "region" || kind === "sv") {
        const key = kind === "region" ? "region" : "sv_name";
        const values = [...new Set(anProfiles.map((p) => p[key]).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b));
        $("an-value-label").textContent = kind === "region" ? "지역" : "담당 SV";
        $("an-value").innerHTML = "";
        for (const v of values) {
            const opt = document.createElement("option");
            opt.value = v;
            opt.textContent = v;
            $("an-value").append(opt);
        }
    }
    drawAnnouncementTargetCount();
}

// 미리 세는 숫자는 안내용입니다 — 확정은 서버(create_announcement)가 그
// 시점 스냅샷으로 다시 셉니다(53 설계 판단 [2]).
function drawAnnouncementTargetCount() {
    const kind = $("an-audience").value;
    let count = 0;
    if (kind === "all") count = anStores.length;
    else if (kind === "stores") count = $("an-stores").selectedOptions.length;
    else {
        const key = kind === "region" ? "region" : "sv_name";
        const value = $("an-value").value;
        count = anProfiles.filter((p) => p[key] === value).length;
    }
    $("an-target-count").textContent = count ? `대상 약 ${count}곳` : "대상 없음";
}

async function submitAnnouncement() {
    const kind = $("an-audience").value;
    const storeIds = [...$("an-stores").selectedOptions].map((o) => Number(o.value));
    const notice = $("an-notice");
    notice.textContent = "";

    // RPC 대기 중 버튼을 잠급니다 — 더블클릭이 같은 공지를 두 건 접수하고
    // 승인 대기 업무까지 두 개 만듭니다(행 버튼들의 disabled 패턴과 동일).
    const button = $("an-submit");
    button.disabled = true;
    try {
        const { data, error } = await db.rpc("create_announcement", {
            p_title: $("an-title").value,
            p_body: $("an-body").value,
            p_audience_kind: kind,
            p_audience_value: kind === "region" || kind === "sv" ? $("an-value").value : null,
            p_store_ids: kind === "stores" ? storeIds : null,
        });
        if (error) {
            notice.textContent = "접수하지 못했습니다: " + error.message;
            return;
        }
        if (!data?.ok) {
            notice.textContent = data?.reason || "접수하지 못했습니다.";
            return;
        }
        notice.textContent = `접수했습니다 — 대상 ${data.target_count}곳, `
            + `승인 대기 업무 #${data.task_id} 가 만들어졌습니다.`;
        $("an-title").value = "";
        $("an-body").value = "";
        await Promise.all([refreshAnnouncements(),
                           typeof refreshTaskList === "function" ? refreshTaskList() : null,
                           typeof refreshTasksSummary === "function" ? refreshTasksSummary() : null]);
    } finally {
        button.disabled = false;
    }
}

const AN_AUDIENCE_LABEL = { all: "전체", region: "지역", sv: "담당 SV", stores: "선택 매장" };

export async function refreshAnnouncements() {
    const { data, error } = await db.rpc("api_announcements", { p_limit: 100 });
    if (error) {
        $("t-announcements").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + '</p>';
        heroFail("comms-hero", error.message);
        return;
    }
    const rows = Array.isArray(data) ? data : [];
    $("comms-summary").textContent = rows.length ? `${int(rows.length)}건` : "";

    // ---- hero: 이 화면의 답 -------------------------------------------
    // 답 = 담당자가 눌러야 나가는 건 = 승인 대기. 이미 발송된 것과 반려된 것은
    // 오늘 할 일이 아닙니다.
    const waiting = rows.filter((a) => a.task_status === "waiting_approval").length;
    const sentAny = rows.filter((a) => Number(a.sent) > 0).length;
    const failedAny = rows.reduce((n, a) => n + (Number(a.failed) || 0), 0);
    setHero("comms-hero", {
        num: `${int(waiting)}건`,
        tone: waiting > 0 ? "critical" : failedAny > 0 ? "attn" : "good",
        badge: waiting > 0 ? "승인 필요" : failedAny > 0 ? "확인" : "정상",
        facts: rows.length
            ? `전체 ${int(rows.length)}건 · 발송됨 ${int(sentAny)}`
              + (failedAny ? ` · 발송 실패 ${int(failedAny)}` : "")
            : "아직 공지가 없습니다.",
    });
    if (!rows.length) {
        $("t-announcements").innerHTML =
            '<p class="hint">아직 공지가 없습니다. 위 폼에서 접수하면 여기 나타납니다.</p>';
        return;
    }
    table($("t-announcements"),
        ["상태", "제목", "대상", "발송", "열람", "작성"],
        rows.map((a) => {
            const audience = AN_AUDIENCE_LABEL[a.audience_kind] || a.audience_kind;
            const sent = a.sent
                ? `발송 ${int(a.sent)}`
                : (a.dry_run ? `dry-run ${int(a.dry_run)}` : "—");
            return [
                taskStatusTag(a.task_status),
                escape(a.title)
                    + `<div class="meta">${escape(clip(a.body, 80))}</div>`,
                escape(audience + (a.audience_value ? ` ${a.audience_value}` : ""))
                    + `<div class="meta">${int(a.target_count)}곳</div>`,
                sent + (a.failed ? `<div class="meta">실패 ${int(a.failed)}</div>` : ""),
                a.reads ? int(a.reads) + "곳" : "—",
                escape(String(a.created_at).slice(0, 10))
                    + `<div class="meta">업무 #${int(a.task_id)}</div>`,
            ];
        }),
        { html: true });
}
