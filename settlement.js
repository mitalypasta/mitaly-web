// 정산 · 로열티 (3번 영역, 41_settlement.sql) — app.js 에서 뽑아낸
// shell 분리 조각 (docs/web-split-plan.md). 기간 범위는 S.filterRange 를 읽습니다.

import { won, wonFull, int, ymLabel } from "./format.js";
import { escape, monthsBetween } from "./util.js";
import { $, table } from "./dom.js";
import { db } from "./client.js";
import { S } from "./state.js";
import { refreshTasksSummary, refreshTaskList, taskStatusTag } from "./tasks.js";

// ---- 정산 · 로열티 (3번 영역, 41_settlement.sql) --------------------------
//
// 청구는 매출(agg_month)로 계산한 예상치(source=computed)이고, 본사 청구·입금
// 원자료가 반입되면 그 값(source=hq)이 우선합니다. 판정·검증 규칙은 전부
// 서버 함수에 있고 화면은 받은 값을 그리기만 합니다(조회는 jsonb 한 줄, D10).
// 이 화면의 월 선택은 위 공통 필터(기간·매장)와 별개입니다 — 정산은 언제나
// '한 달' 단위라 기간(부터~까지) 필터가 뜻이 없습니다.

// 청구 출처(computed/hq)와 입금 출처(web/hq)를 같이 씁니다.
const SETTLE_SOURCE_LABEL = { computed: "매출 계산", hq: "본사 자료", web: "웹 입력" };

let stRows = [];   // api_royalty_month 의 stores. 입금 내역 패널이 다시 씁니다.

export function initSettlement() {
    const sel = $("st-ym");
    const months = S.filterRange ? monthsBetween(S.filterRange.min, S.filterRange.max) : [];
    for (const ym of [...months].reverse()) {
        const option = document.createElement("option");
        option.value = String(ym);
        option.textContent = ymLabel(ym);
        sel.append(option);
    }
    if (months.length) sel.value = String(months[months.length - 1]);

    $("pay-date").value = new Date().toISOString().slice(0, 10);

    sel.addEventListener("change", refreshSettlementMonth);
    $("st-generate").addEventListener("click", generateInvoices);
    $("pay-submit").addEventListener("click", submitPayment);
    initSettlementActions();

    Promise.all([refreshSettlementMonth(), refreshReceivables()]);
}

function settleYm() { return Number($("st-ym").value) || null; }

function settleStatusTag(status) {
    const label = escape(status);
    if (status === "미수") return `<span class="tag warn">${label}</span>`;
    if (status === "완납") return `<span class="tag up">${label}</span>`;
    if (status === "미청구") return `<span class="tag h-warn">${label}</span>`;
    return `<span class="tag">${label}</span>`;
}

async function refreshSettlementMonth() {
    $("settlement-payments-panel").hidden = true;
    const ym = settleYm();
    if (!ym) return;

    const { data, error } = await db.rpc("api_royalty_month", { p_ym: ym });
    if (error) {
        stRows = [];
        $("t-settlement").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + "</p>";
        return;
    }
    const d = data || {};
    stRows = d.stores || [];
    const t = d.totals || {};

    $("st-month-meta").textContent =
        `요율 ${d.rate_pct}% · 납기 ${d.due_date || "—"} — 본사가 정합니다`;
    $("st-outstanding").textContent = won(t.outstanding) + "원";
    $("st-outstanding-sub").textContent = `미수 매장 ${int(t.overdue_stores)}곳`;
    $("st-billed").textContent = won(t.billed) + "원";
    $("st-billed-sub").textContent = `청구 ${int(t.billed_stores)}곳`;
    $("st-paid").textContent = won(t.paid) + "원";
    $("st-unbilled").textContent = int(t.unbilled_stores);

    // 입금 폼의 매장 목록 = 이 달 청구가 있는 매장. 선택은 유지합니다.
    const paySelect = $("pay-invoice");
    const keep = paySelect.value;
    paySelect.innerHTML = "";
    for (const s of stRows.filter((r) => r.invoice_id != null)) {
        const option = document.createElement("option");
        option.value = String(s.invoice_id);
        option.textContent = `${s.store} · ${ymLabel(ym)}`;
        paySelect.append(option);
    }
    if (keep && [...paySelect.options].some((o) => o.value === keep)) {
        paySelect.value = keep;
    }

    if (!stRows.length) {
        $("t-settlement").innerHTML =
            '<p class="hint">이 달에는 매출도 청구도 없습니다. 다른 달을 골라 보세요.</p>';
        return;
    }

    table($("t-settlement"),
        ["상태", "매장", "매출액", "청구액", "출처", "입금", "미수", "납기", "처리"],
        stRows.map((s) => [
            settleStatusTag(s.status),
            escape(s.store)
                + (s.trade_area ? `<div class="meta">${escape(s.trade_area)}</div>` : ""),
            s.sales_amount != null ? wonFull(s.sales_amount) : "—",
            s.invoice_id != null
                ? wonFull(s.billed_amount)
                    + `<div class="meta">요율 ${escape(String(s.rate_pct))}%</div>`
                // 생성 전 미리보기 — 서버와 같은 규칙(round(매출×요율/100))입니다.
                : `<span class="meta">예상 ${wonFull(Math.round((s.sales_amount || 0) * (d.rate_pct || 0) / 100))}</span>`,
            s.source ? escape(SETTLE_SOURCE_LABEL[s.source] || s.source) : "—",
            wonFull(s.paid_amount)
                + (s.payments && s.payments.length
                    ? `<div class="meta">${int(s.payments.length)}건</div>` : ""),
            s.outstanding == null ? "—"
                : s.outstanding < 0
                    ? `${wonFull(s.outstanding)} <span class="tag h-warn">과입금</span>`
                    : wonFull(s.outstanding)
                        + (s.overdue_days > 0 && s.outstanding > 0
                            ? `<div class="meta">연체 ${int(s.overdue_days)}일</div>` : ""),
            s.due_date ? escape(s.due_date) : "—",
            s.invoice_id != null
                ? `<button class="ghost" data-act="pay-prefill" data-invoice-id="${s.invoice_id}">입금</button>`
                    + (s.payments && s.payments.length
                        ? ` <button class="ghost" data-act="pay-history" data-invoice-id="${s.invoice_id}">내역</button>`
                        : "")
                : "—",
        ]),
        { html: true });
}

async function generateInvoices() {
    const ym = settleYm();
    if (!ym) return;
    const button = $("st-generate");
    const msg = $("st-generate-msg");
    button.disabled = true;
    msg.textContent = "계산 중…";

    const { data, error } = await db.rpc("generate_royalty_invoices", { p_ym: ym });

    button.disabled = false;
    if (error || (data && data.ok === false)) {
        msg.textContent = error ? error.message : (data.reason || "생성하지 못했습니다");
        return;
    }
    msg.textContent = `매장 ${int(data.stores)}곳 · ${int(data.written)}건 반영`
        + (data.hq_kept ? ` · 본사 자료 ${int(data.hq_kept)}건 유지` : "");
    await Promise.all([refreshSettlementMonth(), refreshReceivables()]);
}

async function submitPayment() {
    const notice = $("pay-notice");
    const button = $("pay-submit");
    const invoiceId = Number($("pay-invoice").value);
    const amount = Number($("pay-amount").value);

    if (!invoiceId) {
        notice.className = "notice error";
        notice.textContent = "매장을 고르세요. 청구가 없는 달이면 먼저 '청구 생성·갱신'을 누르세요.";
        return;
    }
    if (!$("pay-date").value) {
        notice.className = "notice error";
        notice.textContent = "입금일을 입력하세요.";
        return;
    }
    if (!amount || amount <= 0) {
        notice.className = "notice error";
        notice.textContent = "금액은 0보다 커야 합니다.";
        return;
    }

    button.disabled = true;
    notice.className = "notice";
    notice.textContent = "기록하는 중…";

    const { data, error } = await db.rpc("record_royalty_payment", {
        p_invoice_id: invoiceId,
        p_paid_on: $("pay-date").value,
        p_amount: amount,
        p_note: $("pay-note").value.trim() || null,
    });

    button.disabled = false;
    if (error || (data && data.ok === false)) {
        notice.className = "notice error";
        notice.textContent = error ? error.message : (data.reason || "기록하지 못했습니다");
        return;
    }

    notice.className = "notice";
    notice.textContent = data.outstanding > 0
        ? `기록했습니다. 남은 미수 ${wonFull(data.outstanding)}.`
        : data.outstanding < 0
            ? `기록했습니다. ${wonFull(-data.outstanding)} 과입금 상태입니다.`
            : "기록했습니다. 완납됐습니다.";
    $("pay-amount").value = "";
    $("pay-note").value = "";
    await Promise.all([refreshSettlementMonth(), refreshReceivables()]);
}

function showSettlementPayments(invoiceId) {
    const row = stRows.find((s) => s.invoice_id === invoiceId);
    if (!row) return;
    const panel = $("settlement-payments-panel");
    panel.hidden = false;
    panel.dataset.invoiceId = String(invoiceId);
    $("settlement-payments-title").textContent =
        `입금 내역 — ${row.store} · ${ymLabel(settleYm())}`;

    const list = row.payments || [];
    if (!list.length) {
        $("t-settlement-payments").innerHTML =
            '<p class="hint">아직 입금 기록이 없습니다.</p>';
        return;
    }
    table($("t-settlement-payments"),
        ["입금일", "금액", "메모", "출처", "상태"],
        list.map((p) => [
            escape(p.paid_on),
            wonFull(p.amount),
            escape(p.note || "—"),
            escape(SETTLE_SOURCE_LABEL[p.source] || p.source || "—"),
            p.canceled
                ? '<span class="tag">취소됨</span>'
                : `<button class="ghost" data-act="cancel-payment" data-payment-id="${p.payment_id}">취소</button>`,
        ]),
        { html: true });
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function initSettlementActions() {
    $("t-settlement").addEventListener("click", (event) => {
        const button = event.target.closest("button[data-act]");
        if (!button) return;
        const invoiceId = Number(button.dataset.invoiceId);
        if (button.dataset.act === "pay-prefill") {
            $("pay-invoice").value = String(invoiceId);
            $("pay-amount").focus();
            $("settlement-payment-card").scrollIntoView({ behavior: "smooth", block: "start" });
        } else if (button.dataset.act === "pay-history") {
            showSettlementPayments(invoiceId);
        }
    });

    $("t-settlement-payments").addEventListener("click", async (event) => {
        const button = event.target.closest("button[data-act='cancel-payment']");
        if (!button) return;
        const ok = window.confirm("이 입금 기록을 취소할까요? 기록은 취소 표시로 남습니다.");
        if (!ok) return;

        button.disabled = true;
        const { data, error } = await db.rpc("cancel_royalty_payment",
            { p_payment_id: Number(button.dataset.paymentId) });
        if (error || (data && data.ok === false)) {
            window.alert(error ? error.message : (data.reason || "취소하지 못했습니다"));
            button.disabled = false;
            return;
        }
        const invoiceId = Number($("settlement-payments-panel").dataset.invoiceId);
        await Promise.all([refreshSettlementMonth(), refreshReceivables()]);
        showSettlementPayments(invoiceId);
    });

    $("t-receivables").addEventListener("click", async (event) => {
        const button = event.target.closest("button[data-act='request-notice']");
        if (!button) return;
        const ok = window.confirm(
            `${button.dataset.store} · ${ymLabel(Number(button.dataset.ym))}분 미수 `
            + `${wonFull(Number(button.dataset.outstanding))}의 안내 발송을 승인 대기로 올립니다.`);
        if (!ok) return;

        const label = button.textContent;
        button.disabled = true;
        button.textContent = "처리 중…";

        const { data, error } = await db.rpc("request_receivable_notice",
            { p_invoice_id: Number(button.dataset.invoiceId) });
        if (error || (data && data.ok === false)) {
            window.alert(error ? error.message : (data.reason || "요청하지 못했습니다"));
            button.disabled = false;
            button.textContent = label;
            return;
        }
        // 업무 영역의 승인 대기 숫자가 이 요청을 비추므로 같이 새로 그립니다
        // (advance_task 뒤 refreshViolations 를 부르는 것과 같은 이유).
        await Promise.all([refreshReceivables(), refreshTasksSummary(), refreshTaskList()]);
    });
}

async function refreshReceivables() {
    const { data, error } = await db.rpc("api_royalty_receivables");
    if (error) {
        $("t-receivables").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + "</p>";
        return;
    }
    const d = data || {};
    const items = d.items || [];
    const totals = d.totals || {};

    $("st-recv-meta").textContent = items.length
        ? `${int(totals.count)}건 · ${wonFull(totals.outstanding)}`
        : "";

    if (!items.length) {
        $("t-receivables").innerHTML = '<p class="hint">미수가 없습니다.</p>';
        return;
    }

    table($("t-receivables"),
        ["매장", "연월", "청구액", "입금", "미수", "납기", "연체", "지연이자(참고)", "발송 승인"],
        items.map((r) => [
            escape(r.store),
            ymLabel(r.ym),
            wonFull(r.amount),
            wonFull(r.paid_amount),
            wonFull(r.outstanding),
            escape(r.due_date),
            `<span class="tag warn">${int(r.overdue_days)}일</span>`,
            r.late_interest_est == null ? "—"
                : wonFull(r.late_interest_est)
                    + `<div class="meta">연 ${escape(String(d.late_interest_pct_year))}%</div>`,
            r.notice_task_id
                ? taskStatusTag(r.notice_task_status)
                    + `<div class="meta">업무 #${int(r.notice_task_id)}</div>`
                : `<button class="ghost" data-act="request-notice"`
                    + ` data-invoice-id="${r.invoice_id}" data-store="${escape(r.store)}"`
                    + ` data-ym="${r.ym}" data-outstanding="${r.outstanding}">발송 승인 요청</button>`,
        ]),
        { html: true });
}
