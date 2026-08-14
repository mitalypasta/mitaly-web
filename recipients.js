// 수신처 (43 notify_recipients + 65 + 72) — app.js 에서 뽑아낸 shell 분리 조각
// (docs/web-split-plan.md).

import { int } from "./format.js";
import { escape, clip } from "./util.js";
import { $, table } from "./dom.js";
import { db } from "./client.js";
import { NOTIFY_KIND_LABEL, NOTIFY_CHANNEL_LABEL } from "./notifications.js";

// ---- 수신처 (43 notify_recipients + 65 이름·담당 SV + 72 웹 입력) ---------
//
// 본사 양식 반입(tools/import_recipients.py)과 웹 직접 입력을 병행합니다
// (담당자 지시 2026-08-13 ①). 저장은 사람 단위(같은 메일의 종류 행을 한 번에
// 맞춤 — 72 설계 판단 [2]), 켜고 끄기는 행 단위입니다. 삭제 버튼은 없습니다 —
// 끄면 발송이 멈추고, 껐다 켠 자취가 updated_at 으로 남습니다.

let rcItems = [];

async function refreshRecipients() {
    const { data, error } = await db.rpc("api_notify_recipients");
    if (error) {
        $("t-recipients").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + '</p>';
        return;
    }
    rcItems = Array.isArray(data?.items) ? data.items : [];
    $("rc-summary").textContent = rcItems.length
        ? `${int(data.enabled)}곳 사용 중 / 전체 ${int(data.total)}곳` : "";
    if (!rcItems.length) {
        $("t-recipients").innerHTML =
            '<p class="hint">등록된 수신처가 없습니다 — 지금은 보고서·알림이'
            + ' 만들어져도 아무 데도 가지 않습니다. 위 칸에서 바로 넣을 수'
            + ' 있습니다.</p>';
        return;
    }
    table($("t-recipients"),
        ["종류", "이름", "받는 곳", "담당 SV", "상태", "메모", ""],
        rcItems.map((r) => [
            escape(NOTIFY_KIND_LABEL[r.kind] || r.kind),
            escape(r.display_name || "—"),
            escape(r.recipient)
                + (r.channel !== "mail"
                    ? ` <span class="meta">${escape(NOTIFY_CHANNEL_LABEL[r.channel] || r.channel)}</span>`
                    : ""),
            escape(r.sv_name || "—"),
            r.enabled ? '<span class="tag up">사용</span>' : '<span class="tag">꺼짐</span>',
            escape(clip(r.note || "", 40)),
            `<button type="button" class="ghost" data-act="toggle" data-id="${r.id}">`
                + (r.enabled ? "끄기" : "켜기") + "</button> "
                + `<button type="button" class="ghost" data-act="edit" data-id="${r.id}">고치기</button>`,
        ]),
        { html: true });
}

// '고치기' 는 그 사람의 행들을 위 입력 칸에 올려놓습니다 — 저장이 사람 단위라
// 화면도 사람 단위로 고치는 것이 맞습니다(체크 상태 = 지금 켜진 종류).
function rcFillForm(recipient) {
    const rows = rcItems.filter(
        (r) => r.recipient === recipient && r.channel === "mail");
    if (!rows.length) return;
    const base = rows.find((r) => r.enabled) || rows[0];
    $("rc-name").value = base.display_name || "";
    $("rc-mail").value = recipient;
    $("rc-sv").value = base.sv_name || "";
    $("rc-note").value = base.note || "";
    const on = new Set(rows.filter((r) => r.enabled).map((r) => r.kind));
    for (const box of $("rc-kinds").querySelectorAll("input[type=checkbox]"))
        box.checked = on.has(box.value);
    $("rc-notice").textContent =
        `${base.display_name || recipient} 을(를) 위 칸에 올렸습니다 — 고친 뒤 저장을 누르세요.`;
}

async function saveRecipient() {
    const notice = $("rc-notice");
    notice.textContent = "";
    const kinds = [...$("rc-kinds").querySelectorAll("input:checked")]
        .map((box) => box.value);
    const { data, error } = await db.rpc("api_notify_recipient_save", {
        p_recipient: $("rc-mail").value,
        p_kinds: kinds,
        p_display_name: $("rc-name").value,
        p_sv_name: $("rc-sv").value,
        p_note: $("rc-note").value,
    });
    if (error) {
        notice.textContent = "저장하지 못했습니다: " + error.message;
        return;
    }
    if (!data?.ok) {
        notice.textContent = data?.reason || "저장하지 못했습니다.";
        return;
    }
    notice.textContent = `저장했습니다 — ${data.recipient} · 받을 것 ${data.kinds_on}종`
        + (data.kinds_off ? ` (끈 것 ${data.kinds_off}종)` : "");
    $("rc-name").value = "";
    $("rc-mail").value = "";
    $("rc-sv").value = "";
    $("rc-note").value = "";
    for (const box of $("rc-kinds").querySelectorAll("input[type=checkbox]"))
        box.checked = false;
    await refreshRecipients();
}

export async function initRecipients() {
    $("rc-save").addEventListener("click", saveRecipient);
    $("t-recipients").addEventListener("click", async (event) => {
        const button = event.target.closest("button[data-act]");
        if (!button) return;
        const row = rcItems.find((r) => r.id === Number(button.dataset.id));
        if (!row) return;
        if (button.dataset.act === "edit") {
            rcFillForm(row.recipient);
            return;
        }
        button.disabled = true;
        const { data, error } = await db.rpc("api_notify_recipient_toggle", {
            p_id: row.id, p_enabled: !row.enabled });
        if (error || !data?.ok) {
            $("rc-notice").textContent = "바꾸지 못했습니다: "
                + (error?.message || data?.reason || "");
            button.disabled = false;
            return;
        }
        await refreshRecipients();
    });
    await refreshRecipients();
}
