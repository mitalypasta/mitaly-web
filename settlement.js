// 정산 · 로열티 (3번 영역, 41_settlement.sql) — app.js 에서 뽑아낸
// shell 분리 조각 (docs/web-split-plan.md). 기간 범위는 S.filterRange 를 읽습니다.

import { wonFull, int, ymLabel } from "./format.js";
import { escape, monthsBetween } from "./util.js";
import { $, table, searchify } from "./dom.js";
import { db, fetchStores } from "./client.js";
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

// 서버 상태값 → 화면 라벨. 값 자체는 서버 판정(41)이고 여기서는 읽히는
// 말로만 바꿉니다(2026-08-16 담당자 피드백 2 — 태그가 자체로 읽혀야 함).
const SETTLE_STATUS_LABEL = {
    "미수": "미수(연체)", "완납": "완납", "부분 입금": "부분 입금",
    "기한 전": "납기 전", "미청구": "청구 없음",
};

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
    initRoyaltyRates();
    initSettlementStoreView();

    Promise.all([refreshSettlementMonth(), refreshReceivables()]);
}

function settleYm() { return Number($("st-ym").value) || null; }

// "YYYY-MM-DD" + n일. new Date("YYYY-MM-DD") 는 UTC 자정으로 읽히므로 UTC
// 게터로만 다뤄야 KST 에서 하루 밀리지 않습니다.
function dateAddDays(iso, days) {
    const d = new Date(iso);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

function settleStatusTag(status) {
    const label = escape(SETTLE_STATUS_LABEL[status] || status);
    if (status === "미수") return `<span class="tag warn">${label}</span>`;
    if (status === "완납") return `<span class="tag up">${label}</span>`;
    if (status === "미청구") return `<span class="tag h-warn">${label}</span>`;
    // 서버가 내는 나머지 두 상태도 전용 색을 받습니다 — 회색 기본 태그로
    // 뭉개지면 '부분 입금'(돈이 들어오는 중)이 눈에 안 띕니다.
    if (status === "부분 입금") return `<span class="tag st-partial">${label}</span>`;
    if (status === "기한 전") return `<span class="tag st-early">${label}</span>`;
    return `<span class="tag">${label}</span>`;
}

async function refreshSettlementMonth() {
    $("settlement-payments-panel").hidden = true;
    const ym = settleYm();
    if (!ym) return;

    const { data, error } = await db.rpc("api_royalty_month", { p_ym: ym });
    if (error) {
        stRows = [];
        $("st-drift").hidden = true;
        $("st-unbilled-warn").hidden = true;
        $("t-settlement").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + "</p>";
        return;
    }
    const d = data || {};
    stRows = d.stores || [];
    const t = d.totals || {};

    $("st-month-meta").textContent =
        `기본 요율 ${d.rate_pct}% · 납기 ${d.due_date || "—"}`;
    // 타일은 돈의 흐름 순서(청구 → 입금 → 남은 돈)로 읽힙니다(피드백 1).
    // 정산은 대사(맞춰보기) 화면이라 금액 타일도 표 셀처럼 원 단위 정확 표기
    // 입니다 — 만/억 반올림(won)은 다른 화면의 매출 헤드라인에만 씁니다.
    $("st-billed").textContent = wonFull(t.billed);
    $("st-billed-sub").textContent = `매장 ${int(t.billed_stores)}곳에 청구`;
    $("st-paid").textContent = wonFull(t.paid);
    $("st-paid-sub").textContent = t.billed_stores > 0
        ? `완납 ${int(t.paid_stores || stRows.filter((s) => s.status === "완납").length)}곳`
        : "";
    $("st-outstanding").textContent = wonFull(t.outstanding);
    $("st-outstanding-sub").textContent = t.outstanding > 0
        ? `매장 ${int(t.overdue_stores)}곳 — 아래 미수 목록에서 처리`
        : "다 들어왔습니다";
    // 남은 돈이 있으면 타일 값이 빨간 강조를 받습니다(0원은 강조 없음).
    $("st-outstanding-tile").classList.toggle("t-urgent", Number(t.outstanding) > 0);

    // 스냅샷 어긋남 — 청구는 생성 시점 매출 스냅샷(billed_sales)이고 '매출'
    // 열은 live 라, 청구 뒤 매출이 소급 수집되면 한 행 안에서 계산이 안 맞게
    // 됩니다. 신호가 없으면 언제 '청구 생성·갱신'을 눌러야 하는지 알 수 없어
    // 행 배지 + 상단 안내로 알립니다(hq 청구는 본사 확정값이라 비교 대상 아님).
    // 문구는 짧고 행동 중심(피드백 1) — 왜인지는 행 배지의 메타가 보여줍니다.
    const driftIds = new Set(stRows
        .filter((s) => s.invoice_id != null && s.source === "computed"
            && s.billed_sales != null && s.sales_amount != null
            && Number(s.billed_sales) !== Number(s.sales_amount))
        .map((s) => s.invoice_id));
    const drift = $("st-drift");
    drift.hidden = driftIds.size === 0;
    if (driftIds.size) {
        drift.textContent = `갱신 필요 ${int(driftIds.size)}곳 — `
            + "'청구 생성·갱신'을 누르면 지금 매출로 다시 계산됩니다.";
    }

    // 청구가 안 만들어진 매장은 미납이어도 미수 목록에 영영 안 잡힙니다.
    // 자동 생성 배치가 없는 동안은 이 안내가 유일한 신호입니다.
    const unbilledWarn = $("st-unbilled-warn");
    unbilledWarn.hidden = !(t.unbilled_stores > 0);
    if (t.unbilled_stores > 0) {
        unbilledWarn.textContent = (t.billed_stores > 0
                ? `청구 없는 매장 ${int(t.unbilled_stores)}곳`
                : "이 달 청구가 아직 없습니다")
            + " — '청구 생성·갱신'을 누르면 만들어집니다.";
    }

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

    // 열 이름은 위 타일의 말과 같게 갑니다(청구한 돈 → 들어온 돈 → 못 받은
    // 돈). '출처' 열은 뺐습니다 — 청구액 밑의 메타('요율 N%'/'본사 확정')가
    // 같은 정보를 이미 보여줍니다. 상권 표기도 뺐습니다(피드백 4).
    table($("t-settlement"),
        ["상태", "매장", "이 달 매출", "청구한 돈", "들어온 돈", "못 받은 돈", "납기일", "처리"],
        stRows.map((s) => [
            settleStatusTag(s.status),
            escape(s.store),
            s.sales_amount != null ? wonFull(s.sales_amount) : "—",
            s.invoice_id != null
                ? wonFull(s.billed_amount)
                    // hq 금액은 매출×요율 계산이 아닐 수 있어 요율 라벨을 붙이면
                    // "이 요율로 계산됐다"는 오해가 됩니다 — '본사 확정'으로 갈랐습니다.
                    + (s.source === "hq"
                        ? '<div class="meta">본사 확정</div>'
                        : `<div class="meta">매출 × ${escape(String(s.rate_pct))}%</div>`)
                    + (driftIds.has(s.invoice_id)
                        ? '<div><span class="tag h-warn">갱신 필요</span>'
                            + `<div class="meta">청구 당시 매출 ${wonFull(s.billed_sales)}</div></div>`
                        : "")
                // 생성 전 미리보기 — 서버와 같은 규칙(round(매출×요율/100)).
                // 요율은 그 매장의 유효 요율(apply_rate_pct, 84)입니다.
                : `<span class="meta">예상 ${wonFull(Math.round((s.sales_amount || 0)
                        * (s.apply_rate_pct ?? d.rate_pct ?? 0) / 100))}</span>`,
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
    stsInvalidate();
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

    // 입금일이 청구 연월과 동떨어지면 확인을 받습니다 — 막지는 않습니다
    // (실제로 소급 기록·오래된 미수의 뒤늦은 입금이 있습니다). 서버
    // (record_royalty_payment)는 날짜 존재만 보므로 여기서 잡아야 합니다.
    const paidOn = $("pay-date").value;
    const row = stRows.find((s) => s.invoice_id === invoiceId);
    const ym = settleYm();
    if (row && ym) {
        const ymStart = `${String(ym).slice(0, 4)}-${String(ym).slice(4, 6)}-01`;
        const warn = paidOn < ymStart
            ? `입금일(${paidOn})이 청구 연월(${ymLabel(ym)})보다 앞입니다.`
            : row.due_date && paidOn > dateAddDays(row.due_date, 365)
                ? `입금일(${paidOn})이 납기(${row.due_date})보다 1년 넘게 뒤입니다.`
                : null;
        if (warn && !window.confirm(warn + " 날짜가 맞는지 확인하세요. 그대로 기록할까요?")) {
            return;
        }
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
    stsInvalidate();
    await Promise.all([refreshSettlementMonth(), refreshReceivables()]);
}

// 미수 목록 → 그 달 월뷰로 전환하고 입금 폼에 청구를 채웁니다. 그 달이 월
// 선택(filterRange) 밖이면 항목을 만들어 끼웁니다 — 청구는 남아 있는데 매출
// 조회 범위가 좁혀진 옛 달도 입금을 넣을 수 있어야 합니다.
async function jumpToPayment(ym, invoiceId) {
    if (!ym || !invoiceId) return;
    const sel = $("st-ym");
    if (![...sel.options].some((o) => o.value === String(ym))) {
        const option = document.createElement("option");
        option.value = String(ym);
        option.textContent = ymLabel(ym);
        // 목록은 최신 달부터(내림차순)라 첫 번째 더 작은 달 앞에 끼웁니다.
        const before = [...sel.options].find((o) => Number(o.value) < ym);
        sel.insertBefore(option, before || null);
    }
    sel.value = String(ym);
    await refreshSettlementMonth();
    const paySelect = $("pay-invoice");
    if ([...paySelect.options].some((o) => o.value === String(invoiceId))) {
        paySelect.value = String(invoiceId);
    }
    $("pay-amount").focus();
    $("settlement-payment-card").scrollIntoView({ behavior: "smooth", block: "start" });
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
        stsInvalidate();
        await Promise.all([refreshSettlementMonth(), refreshReceivables()]);
        showSettlementPayments(invoiceId);
    });

    $("t-receivables").addEventListener("click", async (event) => {
        const payButton = event.target.closest("button[data-act='recv-pay']");
        if (payButton) {
            await jumpToPayment(Number(payButton.dataset.ym),
                                Number(payButton.dataset.invoiceId));
            return;
        }
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

// ---- 로열티 수정 플로팅 (84_royalty_store_rate.sql) ------------------------
//
// 매장을 찾아 그 매장만 다른 요율을 줍니다. 공통 요율은 본사 값
// (settlement_settings)이라 여기서 못 바꾸고, 예외 매장만 넣고 뺍니다.
// 바꾼 요율은 다음 '청구 생성·갱신'부터 반영됩니다(청구는 생성 시점 스냅샷).

let rateStores = [];        // api_royalty_store_rates 의 stores
let rateDefaultPct = null;
let rateSelected = null;    // 고른 매장 { store_id, store, rate_pct }

function rateNotice(text, isError) {
    const notice = $("rate-notice");
    notice.className = isError ? "notice error" : "notice";
    notice.textContent = text;
}

function renderRateList() {
    const query = $("rate-search").value.trim();
    const list = $("rate-list");
    const rows = rateStores.filter((s) => !query || s.store.includes(query));
    if (!rows.length) {
        list.innerHTML = '<p class="hint">찾는 매장이 없습니다.</p>';
        return;
    }
    list.innerHTML = rows.map((s) =>
        `<button type="button" class="rate-row${
            rateSelected && rateSelected.store_id === s.store_id ? " is-on" : ""
        }" data-store-id="${s.store_id}">${escape(s.store)}<span class="rate-now">${
            s.rate_pct != null
                ? `${escape(String(s.rate_pct))}%<span class="tag st-partial">개별</span>`
                : `${rateDefaultPct != null ? escape(String(rateDefaultPct)) + "%" : "—"} (공통)`
        }</span></button>`).join("");
}

async function openRateModal() {
    $("royalty-modal").hidden = false;
    $("rate-form").hidden = true;
    $("rate-search").value = "";
    rateSelected = null;
    rateNotice("", false);
    $("rate-list").innerHTML = '<p class="hint">불러오는 중…</p>';

    const { data, error } = await db.rpc("api_royalty_store_rates");
    if (error) {
        $("rate-list").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + "</p>";
        return;
    }
    const d = data || {};
    rateStores = d.stores || [];
    rateDefaultPct = d.default_rate_pct;
    $("rate-default-meta").textContent =
        `공통 요율 ${rateDefaultPct != null ? rateDefaultPct : "—"}% · 다른 요율을 줄 매장만 고르세요`;
    renderRateList();
    $("rate-search").focus();
}

function pickRateStore(storeId) {
    rateSelected = rateStores.find((s) => s.store_id === storeId) || null;
    if (!rateSelected) return;
    $("rate-form").hidden = false;
    $("rate-form-label").textContent = `${rateSelected.store} 요율(%)`;
    $("rate-input").value = rateSelected.rate_pct != null
        ? String(rateSelected.rate_pct)
        : (rateDefaultPct != null ? String(rateDefaultPct) : "");
    rateNotice(rateSelected.rate_pct != null
        ? `지금 ${rateSelected.rate_pct}% (개별 요율)`
        : `지금 ${rateDefaultPct}% (공통 요율)`, false);
    renderRateList();
    $("rate-input").focus();
}

async function saveRate(reset) {
    if (!rateSelected) return;
    const rate = reset ? null : Number($("rate-input").value);
    if (!reset && (!Number.isFinite(rate) || rate < 0 || rate > 100)) {
        rateNotice("요율(%)은 0 이상 100 이하 숫자여야 합니다.", true);
        return;
    }
    $("rate-save").disabled = true;
    $("rate-reset").disabled = true;
    const { data, error } = await db.rpc("set_royalty_store_rate", {
        p_store_id: rateSelected.store_id,
        p_rate_pct: rate,
    });
    $("rate-save").disabled = false;
    $("rate-reset").disabled = false;
    if (error || (data && data.ok === false)) {
        rateNotice(error ? error.message : (data.reason || "저장하지 못했습니다"), true);
        return;
    }
    rateSelected.rate_pct = rate;
    rateNotice((reset
            ? `${rateSelected.store}을(를) 공통 요율 ${rateDefaultPct}%로 되돌렸습니다.`
            : `${rateSelected.store} 요율을 ${rate}%로 저장했습니다.`)
        + " 이미 만들어진 청구는 그대로입니다 — '청구 생성·갱신'을 누르면 반영됩니다.",
        false);
    renderRateList();
    // 미청구 매장의 '예상 청구' 미리보기가 이 요율을 쓰므로 같이 새로 그립니다.
    // 매장 보기의 실요율 타일도 같은 값을 보므로 캐시를 버립니다.
    stsInvalidate();
    await refreshSettlementMonth();
}

function initRoyaltyRates() {
    $("st-rate-edit").addEventListener("click", openRateModal);
    $("rate-close").addEventListener("click", () => { $("royalty-modal").hidden = true; });
    $("royalty-modal").addEventListener("click", (event) => {
        if (event.target === $("royalty-modal")) $("royalty-modal").hidden = true;
    });
    $("rate-search").addEventListener("input", renderRateList);
    $("rate-list").addEventListener("click", (event) => {
        const button = event.target.closest("button[data-store-id]");
        if (button) pickRateStore(Number(button.dataset.storeId));
    });
    $("rate-save").addEventListener("click", () => saveRate(false));
    $("rate-reset").addEventListener("click", () => saveRate(true));
}

// ---- 매장 보기 (카드 #131 · 담당자 지시 2026-08-21) ------------------------
//
// 매장 대시보드와 같은 문법 — searchify 콤보로 매장을 고르면 그 매장의
// 청구·입금·미수·실요율 타일 + 최근 12개월 정산 추이 표가 채워집니다.
// 새 SQL 없음: api_royalty_month(달마다 전 매장이 들어 있음)를 달 단위로
// 캐시해 매장을 바꿔도 재조회하지 않고, 미수 잔액은 api_royalty_receivables,
// 실요율은 api_royalty_store_rates(84)를 그대로 씁니다. 청구 생성·입금·요율
// 저장이 일어나면 stsInvalidate 가 캐시를 버리고 다시 그립니다.

const STS_MONTHS_SHOWN = 12;       // 추이 표 범위 — 최근 12개월
let stsMonths = [];                // 조회 대상 연월(오름차순)
const stsMonthCache = new Map();   // ym → api_royalty_month 응답 promise
let stsRatesPromise = null;        // api_royalty_store_rates 응답 promise
let stsSeq = 0;                    // 매장을 빠르게 바꿀 때 늦게 온 응답 버리기

function stsMonthData(ym) {
    if (!stsMonthCache.has(ym)) {
        stsMonthCache.set(ym, db.rpc("api_royalty_month", { p_ym: ym })
            .then((r) => {
                if (r.error) {
                    stsMonthCache.delete(ym);   // 실패는 캐시로 굳히지 않습니다
                    throw new Error(r.error.message);
                }
                return r.data || {};
            }));
    }
    return stsMonthCache.get(ym);
}

function stsRates() {
    if (!stsRatesPromise) {
        stsRatesPromise = db.rpc("api_royalty_store_rates")
            .then((r) => {
                if (r.error) {
                    stsRatesPromise = null;
                    throw new Error(r.error.message);
                }
                return r.data || {};
            });
    }
    return stsRatesPromise;
}

function stsInvalidate() {
    stsMonthCache.clear();
    stsRatesPromise = null;
    if ($("sts-store") && $("sts-store").value) refreshSettlementStore();
}

function stsTile(label, value, sub, urgent) {
    return `<div class="tile${urgent ? " t-urgent" : ""}">`
        + `<div class="label">${escape(label)}</div>`
        + `<div class="value">${value}</div>`
        + (sub ? `<div class="sub">${sub}</div>` : "")
        + `</div>`;
}

async function refreshSettlementStore() {
    const name = $("sts-store").value;
    const empty = $("sts-empty");
    const detail = $("sts-detail");
    if (!name) {
        empty.hidden = false;
        detail.hidden = true;
        $("sts-meta").textContent = "";
        return;
    }
    const seq = ++stsSeq;
    $("sts-meta").textContent = "불러오는 중…";

    let monthsData, rates, recv;
    try {
        [monthsData, rates, recv] = await Promise.all([
            Promise.all(stsMonths.map(stsMonthData)),
            stsRates(),
            // 미수는 입금 기록으로 수시로 변해 캐시하지 않습니다(조회 하나뿐).
            db.rpc("api_royalty_receivables").then((r) => {
                if (r.error) throw new Error(r.error.message);
                return r.data || {};
            }),
        ]);
    } catch (e) {
        if (seq !== stsSeq) return;
        empty.hidden = true;
        detail.hidden = false;
        $("sts-meta").textContent = "";
        $("sts-kpis").innerHTML = "";
        $("t-sts-months").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(e.message) + "</p>";
        $("sts-note").textContent = "";
        return;
    }
    if (seq !== stsSeq) return;      // 그 사이 다른 매장을 골랐으면 버립니다

    empty.hidden = true;
    detail.hidden = false;

    // 월별 추이 — 달마다 그 매장 행을 뽑습니다(없으면 매출·청구 둘 다 없는 달).
    const rows = stsMonths.map((ym, i) => {
        const s = (monthsData[i].stores || []).find((r) => r.store === name);
        return { ym, s };
    });

    const sum = (pick) => rows.reduce((a, r) => a + (r.s ? Number(pick(r.s)) || 0 : 0), 0);
    const billedSum = sum((s) => s.billed_amount);
    const paidSum = sum((s) => s.paid_amount);

    // 미수 잔액은 전 기간(청구가 살아 있는 한 12개월 밖도 잡힙니다).
    const myRecv = (recv.items || []).filter((r) => r.store === name);
    const recvSum = myRecv.reduce((a, r) => a + (Number(r.outstanding) || 0), 0);
    const maxOverdue = myRecv.reduce((a, r) => Math.max(a, r.overdue_days || 0), 0);

    // 실요율 — 개별 요율이 있으면 그 값, 없으면 공통 요율(84 규칙 그대로).
    const mine = (rates.stores || []).find((r) => r.store === name);
    const ratePct = mine && mine.rate_pct != null ? mine.rate_pct : null;

    $("sts-meta").textContent = stsMonths.length
        ? `최근 ${stsMonths.length}개월 · ${ymLabel(stsMonths[0])} ~ ${ymLabel(stsMonths[stsMonths.length - 1])}`
        : "";

    $("sts-kpis").innerHTML = [
        stsTile("① 청구한 돈 (기간 합계)", escape(wonFull(billedSum)),
            `청구 ${int(rows.filter((r) => r.s && r.s.invoice_id != null).length)}개월`),
        stsTile("② 들어온 돈 (입금)", escape(wonFull(paidSum)), ""),
        stsTile("③ 못 받은 돈 (전 기간)", escape(wonFull(recvSum)),
            recvSum > 0
                ? `연체 ${int(myRecv.length)}건 · 최장 ${int(maxOverdue)}일 — 아래 미수 목록에서 처리`
                : "미수 없음",
            recvSum > 0),
        stsTile("로열티 요율",
            ratePct != null
                ? `${escape(String(ratePct))}%`
                : (rates.default_rate_pct != null
                    ? `${escape(String(rates.default_rate_pct))}%` : "—"),
            ratePct != null
                ? "이 매장 개별 요율 — 아래 '로열티 수정'에서 바꿉니다"
                : "공통 요율"),
    ].join("");

    // 표는 최신 달부터. 열 이름은 월별 표와 같은 말(같은 돈 = 같은 이름).
    const list = [...rows].reverse();
    table($("t-sts-months"),
        ["월", "상태", "이 달 매출", "청구한 돈", "들어온 돈", "못 받은 돈", "납기일"],
        list.map(({ ym, s }) => !s
            ? [ymLabel(ym), '<span class="tag">자료 없음</span>', "—", "—", "—", "—", "—"]
            : [
                ymLabel(ym),
                settleStatusTag(s.status),
                s.sales_amount != null ? wonFull(s.sales_amount) : "—",
                s.invoice_id != null
                    ? wonFull(s.billed_amount)
                        + (s.source === "hq"
                            ? '<div class="meta">본사 확정</div>'
                            : `<div class="meta">매출 × ${escape(String(s.rate_pct))}%</div>`)
                    : "—",
                wonFull(s.paid_amount),
                s.outstanding == null ? "—"
                    : s.outstanding < 0
                        ? `${wonFull(s.outstanding)} <span class="tag h-warn">과입금</span>`
                        : wonFull(s.outstanding)
                            + (s.overdue_days > 0 && s.outstanding > 0
                                ? `<div class="meta">연체 ${int(s.overdue_days)}일</div>` : ""),
                s.due_date ? escape(s.due_date) : "—",
            ]),
        { html: true });

    $("sts-note").textContent =
        "청구·입금은 위 월별 로열티 청구 표와 같은 원천입니다 — 청구가 없는 달은 "
        + "'청구 없음'으로 보이고, '청구 생성·갱신'을 누르면 만들어집니다.";
}

async function initSettlementStoreView() {
    const months = S.filterRange
        ? monthsBetween(S.filterRange.min, S.filterRange.max) : [];
    stsMonths = months.slice(-STS_MONTHS_SHOWN);

    const select = $("sts-store");
    const { data: stores } = await fetchStores();
    for (const s of stores || []) {
        const option = document.createElement("option");
        // 정산 rpc 응답이 매장 이름으로 오므로 값도 이름입니다(sd-store 는 id).
        option.value = s.name;
        option.textContent = s.name;
        select.append(option);
    }
    searchify(select);
    select.addEventListener("change", refreshSettlementStore);
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

    // 열 이름은 월별 표와 같은 말을 씁니다 — 두 표를 오가며 읽어야 하는
    // 화면이라 같은 돈이 다른 이름으로 불리면 안 됩니다(피드백 2).
    table($("t-receivables"),
        ["매장", "청구 달", "청구한 돈", "들어온 돈", "못 받은 돈", "납기일", "연체", "지연이자(참고)", "처리"],
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
            // '입금' 은 그 달 월뷰로 전환해 입금 폼을 채웁니다 — 연체 매장
            // 입금을 넣으려고 월 선택을 손으로 되짚는 왕복을 없앱니다.
            `<button class="ghost" data-act="recv-pay"`
                + ` data-invoice-id="${r.invoice_id}" data-ym="${r.ym}">입금</button> `
                + (r.notice_task_id
                    ? taskStatusTag(r.notice_task_status)
                        + `<div class="meta">업무 #${int(r.notice_task_id)}</div>`
                    : `<button class="ghost" data-act="request-notice"`
                        + ` data-invoice-id="${r.invoice_id}" data-store="${escape(r.store)}"`
                        + ` data-ym="${r.ym}" data-outstanding="${r.outstanding}">발송 승인 요청</button>`),
        ]),
        { html: true });
}
