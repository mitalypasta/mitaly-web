// AI 1차 응대 (1번 영역, 38_inquiry_answers.sql) — app.js 에서 뽑아낸
// shell 분리 조각 (docs/web-split-plan.md).

import { int } from "./format.js";
import { escape } from "./util.js";
import { $ } from "./dom.js";
import { db } from "./client.js";
import { TASK_SOURCE_LABEL } from "./tasks.js";

// ================================================================ AI 1차 응대 (1번 영역)
//
// 38_inquiry_answers.sql · tools/answer_inquiry.py 가 짝입니다.
//
// [왜 이관된 건도 보여주는가]
//   이관은 "아무 일도 안 일어난 것" 이 아니라 AI 가 내린 판정입니다. 어느 규칙이
//   왜 넘겼는지를 사람이 봐야 규칙을 고칠 수 있습니다. 다만 매일 볼 것은
//   아니라 기본값은 숨김입니다.
//
// [왜 근거를 같이 보여주는가]
//   답이 틀렸을 때 매뉴얼이 틀린 건지 모델이 지어낸 건지 갈라야 합니다.
//   cs-manual.md 는 PPTX 에서 뽑아 제목이 '슬라이드 6' 이라 뜻이 없어서
//   생성기가 발췌(excerpt)를 같이 남깁니다.

let inquiryRows = [];

export async function initInquiries() {
    $("iq-filter").addEventListener("change", refreshInquiries);
    $("iq-hide-escalated").addEventListener("change", drawInquiries);
    initInquiryActions();
    await refreshInquiries();
}

async function refreshInquiries() {
    const status = $("iq-filter").value;
    const { data, error } = await db.rpc("api_inquiry_answers", {
        p_status: status || null,
        p_routing: null,
        p_limit: 100,
    });
    if (error) {
        inquiryRows = [];
        $("iq-list").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + '</p>';
        return;
    }
    inquiryRows = Array.isArray(data) ? data : [];
    drawInquiries();
    refreshInquirySummary();
}

async function refreshInquirySummary() {
    const { data, error } = await db.rpc("api_inquiry_answer_summary");
    if (error) return;
    const rate = data.answer_rate;
    $("inquiry-summary").textContent =
        `검토 대기 ${int(data.pending)}건 · 이관 ${int(data.escalated)}건`
        + (rate == null ? "" : ` · 자동 응대율 ${rate}%`);

    // 홈 '오늘 할 일' 타일. 같은 숫자를 두 번 묻지 않으려고 여기서 채웁니다
    // (미처리 업무 타일이 refreshTasksSummary 에서 채워지는 것과 같은 방식).
    const homeInquiry = $("home-inquiry");
    if (homeInquiry) homeInquiry.textContent = int(data.pending);
}

function drawInquiries() {
    const hideEscalated = $("iq-hide-escalated").checked;
    const rows = inquiryRows.filter((r) => !hideEscalated || r.routing !== "escalate");

    $("iq-shown").textContent = rows.length === inquiryRows.length
        ? `${int(rows.length)}건`
        : `전체 ${int(inquiryRows.length)}건 중 ${int(rows.length)}건`;

    if (!rows.length) {
        $("iq-list").innerHTML =
            '<p class="hint">해당하는 1차 응대가 없습니다. 문의가 접수되면 '
            + '<code>tools/answer_inquiry.py</code> 가 초안을 만듭니다.</p>';
        return;
    }

    $("iq-list").innerHTML = rows.map(inquiryBlock).join("");
}

const INQUIRY_STATUS_LABEL = {
    draft: "검토 대기", approved: "승인됨", rejected: "반려", sent: "발송됨",
};

function inquiryBlock(r) {
    const escalated = r.routing === "escalate";
    const tag = escalated
        ? '<span class="tag h-warn">이관</span>'
        : `<span class="tag${r.status === "approved" || r.status === "sent" ? " up" : ""}">`
          + `${escape(INQUIRY_STATUS_LABEL[r.status] || r.status)}</span>`;

    const head = `<div class="iq-head">${tag}`
        + `<b>${escape(r.task_title)}</b>`
        + `<span class="meta">${escape(r.store_name || "매장 무관")} · `
        + `${escape(TASK_SOURCE_LABEL[r.source] || r.source)} · `
        + `${escape(String(r.received_at).slice(0, 10))}</span></div>`;

    const body = r.task_body
        ? `<p class="iq-quote">${escape(r.task_body)}</p>` : "";

    if (escalated) {
        return `<article class="iq" data-answer-id="${r.answer_id}">${head}${body}`
            + `<p class="hint">규칙 「${escape(r.rule_category || "판단 불가")}」에 걸려 `
            + `답변을 만들지 않았습니다. 넘길 곳: `
            + `<b>${escape(r.escalate_to || "담당 SV")}</b></p></article>`;
    }

    const sources = (r.sources || []).map((s) =>
        `<li><b>${escape(s.doc)}</b> · ${escape(s.heading)}`
        + (s.excerpt ? `<br><span class="meta">${escape(s.excerpt)}</span>` : "")
        + `</li>`).join("");

    const editable = r.status === "draft" || r.status === "approved";
    const buttons = r.status === "draft"
        ? `<button data-act="iq-approve" data-answer-id="${r.answer_id}">승인</button>`
          + ` <button class="ghost" data-act="iq-save" data-answer-id="${r.answer_id}">고친 내용 저장</button>`
          + ` <button class="ghost" data-act="iq-reject" data-answer-id="${r.answer_id}">반려</button>`
        : (r.status === "approved"
            ? `<button class="ghost" data-act="iq-save" data-answer-id="${r.answer_id}">고친 내용 저장</button>`
              + ` <button class="ghost" data-act="iq-reject" data-answer-id="${r.answer_id}">반려</button>`
            : "");

    return `<article class="iq" data-answer-id="${r.answer_id}">`
        + head + body
        + `<textarea class="iq-text" data-answer-id="${r.answer_id}" rows="5"`
        + `${editable ? "" : " readonly"}>${escape(r.contents || "")}</textarea>`
        + (sources ? `<details class="iq-sources"><summary>근거 ${(r.sources || []).length}건</summary>`
                     + `<ul>${sources}</ul></details>` : "")
        + (r.reject_reason
            ? `<p class="hint">반려 사유: ${escape(r.reject_reason)}</p>` : "")
        + `<div class="iq-actions">${buttons}<span class="meta">`
        + `${escape(r.model || "")}</span></div></article>`;
}

function initInquiryActions() {
    $("iq-list").addEventListener("click", async (event) => {
        const button = event.target.closest("button[data-answer-id]");
        if (!button) return;

        const answerId = Number(button.dataset.answerId);
        const act = button.dataset.act;
        const label = button.textContent;

        let call, payload;
        if (act === "iq-approve") {
            call = "approve_inquiry_answer";
            payload = { p_answer_id: answerId };
        } else if (act === "iq-reject") {
            const reason = window.prompt("반려 사유를 적어 주세요.", "");
            if (reason === null) return;
            call = "reject_inquiry_answer";
            payload = { p_answer_id: answerId, p_reason: reason };
        } else if (act === "iq-save") {
            const box = document.querySelector(`textarea.iq-text[data-answer-id="${answerId}"]`);
            call = "edit_inquiry_answer";
            payload = { p_answer_id: answerId, p_contents: box ? box.value : "" };
        } else {
            return;
        }

        button.disabled = true;
        button.textContent = "처리 중…";

        const { data, error } = await db.rpc(call, payload);
        if (error || (data && data.ok === false)) {
            window.alert(error ? error.message : (data.reason || "처리하지 못했습니다"));
            button.disabled = false;
            button.textContent = label;
            return;
        }
        await refreshInquiries();
    });
}
