// 답글 대행 동의 매장 (42_consents + 65 source) — app.js 에서 뽑아낸
// shell 분리 조각 (docs/web-split-plan.md).

import { int } from "./format.js";
import { escape, clip } from "./util.js";
import { $, table } from "./dom.js";
import { db } from "./client.js";

// ---- 답글 대행 동의 매장 (42_consents + 65 source) ------------------------
//
// 답글 등록의 선결 조건인 목록입니다(본사 답변 4번). 본사 명단 반입과 웹
// 기록을 병행합니다(담당자 지시 2026-08-13 ②). 쓰기는 42 의 DEFINER 함수
// 2종(record/withdraw)만 부릅니다 — 이력 규칙(철회는 남기고, 재동의는 철회
// 뒤에만, 반입이 철회를 자동으로 안 되살림)은 전부 서버 쪽 그대로입니다.

async function loadConsents() {
    const withWithdrawn = $("cs-withdrawn").checked;
    const { data, error } = await db.rpc("api_review_reply_consents",
                                         { p_include_withdrawn: withWithdrawn });
    if (error) {
        $("t-consents").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + '</p>';
        return;
    }
    const items = Array.isArray(data?.items) ? data.items : [];
    $("cs-summary").textContent = `동의 ${int(data.live)}곳`
        + (data.withdrawn ? ` · 철회 ${int(data.withdrawn)}곳` : "");
    $("cs-shown").textContent = withWithdrawn ? `${int(items.length)}건 표시` : "";

    if (!items.length) {
        $("t-consents").innerHTML =
            '<p class="hint">동의 매장이 아직 없습니다. 답글 등록은 이 목록이'
            + ' 채워진 뒤에 켤 수 있습니다. 동의서를 받았으면 위 칸에서 바로'
            + ' 기록하세요.</p>';
        return;
    }
    table($("t-consents"),
        ["매장", "동의일", "대표자", "출처", "상태", "비고", ""],
        items.map((c) => [
            escape(c.store),
            escape(c.signed_at || "—"),
            escape(c.signer_name || "—"),
            c.source === "import" ? "본사 명단" : "웹 기록",
            c.withdrawn_at
                ? `<span class="tag warn">철회 ${escape(String(c.withdrawn_at).slice(0, 10))}</span>`
                : '<span class="tag up">동의</span>',
            escape(clip(c.note || c.withdraw_note || "", 40)),
            c.withdrawn_at
                ? `<button type="button" class="ghost" data-act="again" data-store="${escape(c.store)}">다시 동의</button>`
                : `<button type="button" class="ghost" data-act="withdraw" data-id="${c.consent_id}" data-store="${escape(c.store)}">철회</button>`,
        ]),
        { html: true });
}

async function saveConsent() {
    const notice = $("cs-notice");
    notice.textContent = "";
    // RPC 대기 중 버튼을 잠급니다 — 더블클릭이 겹치면 중복 동의 시도가
    // 서버 거절('이미 살아 있는 동의')로 튀어 나옵니다(행 버튼들과 같은 패턴).
    const button = $("cs-save");
    button.disabled = true;
    try {
        const { data, error } = await db.rpc("record_review_reply_consent", {
            p_store: $("cs-store").value,
            p_signed_at: $("cs-date").value || null,
            p_signer: $("cs-signer").value,
            p_note: $("cs-note").value,
        });
        if (error) {
            notice.textContent = "기록하지 못했습니다: " + error.message;
            return;
        }
        if (!data?.ok) {
            notice.textContent = data?.reason || "기록하지 못했습니다.";
            return;
        }
        notice.textContent = `동의를 기록했습니다 — ${$("cs-store").value.trim()}`;
        $("cs-store").value = "";
        $("cs-signer").value = "";
        $("cs-note").value = "";
        // 동의일도 비웁니다 — 남겨 두면 다음 매장 기록에 앞 매장의 동의일이
        // 잘못 붙습니다('다시 동의' 흐름이 날짜를 비우는 것과 같은 이유).
        $("cs-date").value = "";
        await loadConsents();
    } finally {
        button.disabled = false;
    }
}

export async function initConsents() {
    $("cs-withdrawn").addEventListener("change", loadConsents);
    $("cs-save").addEventListener("click", saveConsent);
    $("t-consents").addEventListener("click", async (event) => {
        const button = event.target.closest("button[data-act]");
        if (!button) return;
        if (button.dataset.act === "again") {
            // 재동의는 새 동의서가 근거입니다 — 새 줄로만 기록합니다(42 [1]).
            $("cs-store").value = button.dataset.store;
            $("cs-date").value = "";
            $("cs-notice").textContent =
                `${button.dataset.store} 를 위 칸에 올렸습니다 — 새 동의서의 동의일을 넣고 기록하세요.`;
            $("cs-store").scrollIntoView({ behavior: "smooth", block: "center" });
            return;
        }
        const why = prompt(`${button.dataset.store} 의 동의를 철회합니다.\n`
            + "철회하면 그 매장 답글 등록이 바로 멈춥니다. 사유(선택):");
        if (why === null) return;      // 취소
        button.disabled = true;
        const { data, error } = await db.rpc("withdraw_review_reply_consent", {
            p_consent_id: Number(button.dataset.id),
            p_note: why,
        });
        if (error || !data?.ok) {
            $("cs-notice").textContent = "철회하지 못했습니다: "
                + (error?.message || data?.reason || "");
            button.disabled = false;
            return;
        }
        $("cs-notice").textContent = `철회했습니다 — ${button.dataset.store}`;
        await loadConsents();
    });

    // 매장 이름 자동완성 — 목록에서 고르면 오타로 '매장을 찾지 못했습니다' 를
    // 겪지 않습니다(기록 함수는 이름 정확 일치).
    const { data: stores } = await db.from("stores").select("name").order("name");
    for (const s of stores || []) {
        const opt = document.createElement("option");
        opt.value = s.name;
        $("cs-store-list").append(opt);
    }
    await loadConsents();
}
