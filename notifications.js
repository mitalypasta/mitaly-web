// 발송 이력 (31_notifications + 43_notify_dispatch) — app.js 에서 뽑아낸
// shell 분리 조각 (docs/web-split-plan.md). 종류·채널 표기는 수신처 화면도 씁니다.

import { int } from "./format.js";
import { escape, clip } from "./util.js";
import { $, table } from "./dom.js";
import { db } from "./client.js";
import { showTaskEvents } from "./tasks.js";

// ---- 발송 이력 (31_notifications + 43_notify_dispatch) --------------------
//
// 발송 자체는 수집 PC 도구의 일이고(tools/alert_negative_reviews.py 등),
// 웹은 이력(api_notifications)만 봅니다 — notify.py 머리 주석의 역할 분담.
// 그래서 이 카드에는 버튼이 '업무 이력' 하나뿐입니다.

export const NOTIFY_KIND_LABEL = {
    review_alert: "부정 리뷰",
    notice: "공문",
    store_close: "폐점 계정",
    announcement: "공지",
    report: "보고서",
    test: "시험",
};
export const NOTIFY_CHANNEL_LABEL = {
    mail: "메일", alimtalk: "알림톡", sms: "문자", cafe24: "카페24", webhook: "웹훅",
};
const NOTIFY_STATUS_TAG = {
    sent: '<span class="tag up">발송됨</span>',
    dry_run: '<span class="tag">dry-run</span>',
    failed: '<span class="tag warn">실패</span>',
};

let notifyRows = [];

async function refreshNotifications() {
    const { data, error } = await db.rpc("api_notifications", { p_limit: 200 });
    if (error) {
        $("t-notifications").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + '</p>';
        return;
    }
    notifyRows = Array.isArray(data) ? data : [];
    drawNotifications();
}

function drawNotifications() {
    const kind = $("nf-filter-kind").value;
    const rows = notifyRows.filter((n) => !kind || n.kind === kind);

    $("nf-summary").textContent = `${int(notifyRows.length)}건`;
    $("nf-shown").textContent = rows.length === notifyRows.length
        ? "" : `전체 ${int(notifyRows.length)}건 중 ${int(rows.length)}건`;

    if (!rows.length) {
        $("t-notifications").innerHTML =
            '<p class="hint">발송 이력이 없습니다. 수집 PC 도구가 보내면 여기 쌓입니다.</p>';
        return;
    }

    table($("t-notifications"),
        ["시각", "종류", "채널", "받는 곳", "제목", "상태", "업무"],
        rows.map((n) => [
            escape(String(n.created_at).replace("T", " ").slice(0, 16)),
            escape(NOTIFY_KIND_LABEL[n.kind] || n.kind || "—"),
            escape(NOTIFY_CHANNEL_LABEL[n.channel] || n.channel),
            escape(n.recipient),
            escape(clip(n.subject || "(제목 없음)", 40))
                + (n.error && n.status === "failed"
                    ? `<div class="meta">${escape(clip(n.error, 60))}</div>` : ""),
            NOTIFY_STATUS_TAG[n.status] || escape(n.status),
            n.task_id
                ? `<button class="ghost" data-act="task-events" data-task-id="${n.task_id}"`
                  + ` data-task-title="업무 #${n.task_id}">이력</button>`
                : "—",
        ]),
        { html: true });
}

export function initNotifications() {
    $("nf-filter-kind").addEventListener("change", drawNotifications);
    // '업무' 열의 이력 버튼 — 업무 목록 카드의 이력 패널(showTaskEvents)을
    // 그대로 씁니다. 위임 대상 컨테이너가 달라 여기서 한 번 더 겁니다.
    $("t-notifications").addEventListener("click", (event) => {
        const button = event.target.closest("button[data-act='task-events']");
        if (button) {
            showTaskEvents(Number(button.dataset.taskId), button.dataset.taskTitle);
        }
    });
    refreshNotifications();
}
