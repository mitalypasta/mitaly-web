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

    // 매장 상태(103)는 표의 폐점 배지·상태 필터가 씁니다 — 한 번만 받고 캐시.
    const [{ data, error }] = await Promise.all([
        db.rpc("api_royalty_month", { p_ym: ym }), stsLoadLifecycle()]);
    if (error) {
        stRows = [];
        $("sts-month-shown").textContent = "";
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
        drift.textContent = `청구를 만든 뒤 매출이 바뀐 매장 ${int(driftIds.size)}곳 — `
            + "'청구 생성·갱신'을 누르면 지금 매출로 다시 계산됩니다.";
    }

    // 청구가 안 만들어진 매장은 미납이어도 미수 목록에 영영 안 잡힙니다.
    // 자동 생성 배치가 없는 동안은 이 안내가 유일한 신호입니다.
    const unbilledWarn = $("st-unbilled-warn");
    unbilledWarn.hidden = !(t.unbilled_stores > 0);
    if (t.unbilled_stores > 0) {
        unbilledWarn.textContent = (t.billed_stores > 0
                ? `아직 청구가 없는 매장 ${int(t.unbilled_stores)}곳`
                : "이 달 청구가 아직 없습니다")
            + " — '청구 생성·갱신'을 누르면 만들어집니다."
            + " 청구가 없으면 미수 목록에도 안 잡힙니다.";
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

    stMonthView = { ratePct: d.rate_pct, driftIds };
    renderSettlementMonthTable();
}

// 월별 표 — 상태 필터(sts-month-filter)만 바뀌면 재조회 없이 여기만 다시
// 그립니다. 타일·안내문은 서버 총계(전 매장)라 필터를 안 탑니다.
let stMonthView = { ratePct: null, driftIds: new Set() };

function stsMonthBadge(name) {
    const state = stsStateOf(name);
    return state === "closed" || state === "planned_close"
        ? " " + stsStateTag(state) : "";
}

function renderSettlementMonthTable() {
    const filter = $("sts-month-filter").value;
    const rows = stRows.filter((s) => stsMatchesFilter(s.store, filter));
    $("sts-month-shown").textContent = filter && stRows.length
        ? `${int(rows.length)} / ${int(stRows.length)}곳` : "";
    if (!stRows.length) {
        $("t-settlement").innerHTML =
            '<p class="hint">이 달에는 매출도 청구도 없습니다. 다른 달을 골라 보세요.</p>';
        return;
    }
    if (!rows.length) {
        $("t-settlement").innerHTML =
            '<p class="hint">이 상태의 매장은 이 달에 매출도 청구도 없습니다.</p>';
        return;
    }

    // 열 이름은 위 타일의 말과 같게 갑니다(청구한 돈 → 들어온 돈 → 못 받은
    // 돈). '출처' 열은 뺐습니다 — 청구액 밑의 메타('요율 N%'/'본사 확정')가
    // 같은 정보를 이미 보여줍니다. 상권 표기도 뺐습니다(피드백 4).
    table($("t-settlement"),
        ["상태", "매장", "이 달 매출", "청구한 돈", "들어온 돈", "못 받은 돈", "납기일", "처리"],
        rows.map((s) => [
            settleStatusTag(s.status),
            escape(s.store) + stsMonthBadge(s.store),
            s.sales_amount != null ? wonFull(s.sales_amount) : "—",
            s.invoice_id != null
                ? wonFull(s.billed_amount)
                    // hq 금액은 매출×요율 계산이 아닐 수 있어 요율 라벨을 붙이면
                    // "이 요율로 계산됐다"는 오해가 됩니다 — '본사 확정'으로 갈랐습니다.
                    + (s.source === "hq"
                        ? '<div class="meta">본사 확정</div>'
                        : `<div class="meta">매출 × ${escape(String(s.rate_pct))}%</div>`)
                    + (stMonthView.driftIds.has(s.invoice_id)
                        ? '<div><span class="tag h-warn">갱신 필요</span>'
                            + `<div class="meta">청구 당시 매출 ${wonFull(s.billed_sales)}</div></div>`
                        : "")
                // 생성 전 미리보기 — 서버와 같은 규칙(round(매출×요율/100)).
                // 요율은 그 매장의 유효 요율(apply_rate_pct, 84)입니다.
                : `<span class="meta">예상 ${wonFull(Math.round((s.sales_amount || 0)
                        * (s.apply_rate_pct ?? stMonthView.ratePct ?? 0) / 100))}</span>`,
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
    // 진행 중인 달은 서버(107)가 거부합니다 — 왕복 없이 같은 이유를 먼저 보여 줍니다.
    const now = new Date();
    const thisYm = now.getFullYear() * 100 + (now.getMonth() + 1);
    if (ym >= thisYm) {
        msg.textContent = "이번 달은 아직 끝나지 않았습니다 — 다음 달 1일 이후에 생성하세요. "
            + "지금 예상액은 표의 '예상' 값으로 보세요.";
        return;
    }
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
        rateNotice("요율은 0~100 사이 숫자로 적어 주세요.", true);
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
    // 매장별 로열티의 실요율 타일도 같은 값을 보므로 캐시를 버립니다.
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

// ---- 매장별 로열티 — 옛 '매장 보기' (카드 #131 · 제목은 #142 · 전 기간은 #160) --
//
// 매장 대시보드와 같은 문법 — searchify 콤보로 매장을 고르면 그 매장의
// 청구·입금·미수·실요율 타일 + 전 기간 정산 표가 채워집니다.
// 원천은 api_royalty_store(104) 하나 — 그 매장의 매출·청구가 있는 달을 전부
// 한 번에 줍니다. 종전에는 api_royalty_month 를 최근 12개월 달마다 부르고
// 이름으로 골라내서, 마지막 매출월이 창 밖인 매장(여수시청점 등 40곳)은
// 전부 '자료 없음' 이었습니다(HQ-FEEDBACK-20260908 2절). 매장 상태(운영·폐점)는
// api_store_lifecycle_status(103)를 한 번 받아 이름으로 조인합니다
// (store_db.js 와 같은 패턴) — 헤더 배지 + 콤보·월별 표의 상태 필터.

// 103 의 state 5값 → 라벨·태그 색(lifecycle.js 와 같은 말·같은 색).
const STS_STATE_LABEL = {
    operating: "운영", planned_open: "오픈 예정", planned_close: "폐점 예정",
    closed: "폐점", unknown: "기록 없음",
};
const STS_STATE_CLASS = {
    operating: "tag up", planned_open: "tag st-early", planned_close: "tag h-warn",
    closed: "tag down", unknown: "tag",
};

let stsStores = [];                 // fetchStores 결과 [{id, name}] — 콤보 원본
let stsLifecycle = new Map();       // store_name → { state, last_sales_ym, … }
let stsLifecyclePromise = null;
let stsSeq = 0;                     // 매장을 빠르게 바꿀 때 늦게 온 응답 버리기

// 103 적용 전 환경(state 키 없음 · 이벤트 있는 매장만 옴)도 같은 5값으로
// 접습니다 — lifecycle.js 와 같은 폴백.
function stsNormalizeState(v) {
    return v.state || (v.status === "open" ? "operating"
        : v.status === "close" ? "closed" : (v.status || "unknown"));
}

function stsLoadLifecycle() {
    if (!stsLifecyclePromise) {
        stsLifecyclePromise = db.rpc("api_store_lifecycle_status").then((r) => {
            // 못 받아도 정산 화면은 그려져야 합니다 — 그 경우 전부 '기록 없음'.
            if (!r.error && Array.isArray(r.data)) {
                stsLifecycle = new Map(r.data.map((v) => [v.store_name, {
                    ...v, state: stsNormalizeState(v),
                }]));
            }
            return stsLifecycle;
        });
    }
    return stsLifecyclePromise;
}

function stsStateOf(name) {
    const v = stsLifecycle.get(name);
    return v ? v.state : "unknown";
}

// 상태 필터 — 운영/폐점/전체. '운영' 은 폐점이 아닌 전부(기록 없음·예정 포함,
// store_db.js 의 sdb-status 와 같은 판정).
function stsMatchesFilter(name, filter) {
    if (!filter) return true;
    return (filter === "closed") === (stsStateOf(name) === "closed");
}

function stsStateTag(state) {
    const key = STS_STATE_LABEL[state] ? state : "unknown";
    return `<span class="${STS_STATE_CLASS[key]}">${escape(STS_STATE_LABEL[key])}</span>`;
}

// 콤보 항목을 상태 필터로 다시 채웁니다. 고른 매장이 필터 밖으로 나가면
// 선택을 비웁니다(빈 상태 안내로 돌아감).
function stsFillStores() {
    const select = $("sts-store");
    const filter = $("sts-filter").value;
    const keep = select.value;
    while (select.options.length > 1) select.remove(1);
    for (const s of stsStores) {
        if (!stsMatchesFilter(s.name, filter)) continue;
        const option = document.createElement("option");
        option.value = String(s.id);
        option.textContent = s.name + (stsStateOf(s.name) === "closed" ? " — 폐점" : "");
        select.append(option);
    }
    // option 을 지우면 select 값이 비므로 남아 있으면 되돌리고(콤보 표시도
    // 따라옴), 필터 밖으로 나갔으면 빈 상태 안내로 돌아갑니다.
    if (keep && [...select.options].some((o) => o.value === keep)) {
        select.value = keep;
    } else if (keep) {
        select.value = "";
        refreshSettlementStore();
    }
    stsEmptyMeta();
}

// 매장을 안 골랐을 때 헤더 메타 — 콤보에 든 매장 수 · 폐점 수.
function stsEmptyMeta() {
    if ($("sts-store").value) return;
    const closed = stsStores.filter((s) => stsStateOf(s.name) === "closed").length;
    $("sts-meta").textContent = stsStores.length
        ? `매장 ${int(stsStores.length)}곳` + (closed ? ` · 폐점 ${int(closed)}곳` : "")
        : "";
}

// 청구 생성·입금·요율 저장 뒤 — 조회는 rpc 한 번이라 캐시가 없고, 고른
// 매장이 있으면 다시 그리기만 합니다.
function stsInvalidate() {
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
    const storeId = Number($("sts-store").value) || null;
    const empty = $("sts-empty");
    const detail = $("sts-detail");
    const badge = $("sts-badge");
    if (!storeId) {
        empty.hidden = false;
        detail.hidden = true;
        badge.hidden = true;
        stsEmptyMeta();
        return;
    }
    const seq = ++stsSeq;
    $("sts-meta").textContent = "불러오는 중…";

    let d;
    try {
        const [r] = await Promise.all([
            db.rpc("api_royalty_store", { p_store_id: storeId }),
            stsLoadLifecycle(),
        ]);
        if (r.error) throw new Error(r.error.message);
        d = r.data;
    } catch (e) {
        if (seq !== stsSeq) return;
        empty.hidden = true;
        detail.hidden = false;
        badge.hidden = true;
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

    // 서버는 없는 매장 id 면 행이 없어 null 을 줍니다(104 설계 판단 [6]).
    if (!d) {
        badge.hidden = true;
        $("sts-meta").textContent = "";
        $("sts-kpis").innerHTML = "";
        $("t-sts-months").innerHTML = '<p class="hint">매장을 찾지 못했습니다.</p>';
        $("sts-note").textContent = "";
        return;
    }

    const months = d.months || [];
    const t = d.totals || {};
    const state = stsStateOf(d.store);

    // 헤더 — 상태 배지 + '기간 · 마지막 매출'. 마지막 매출이 자료 최신월보다
    // 앞이면 끊긴 개월을 같이 적습니다(폐점 판정은 사람 몫 — #158 대조표).
    badge.hidden = false;
    badge.innerHTML = stsStateTag(state);
    const gap = d.last_sales_ym && d.data_ym
        ? (Math.floor(d.data_ym / 100) * 12 + d.data_ym % 100)
            - (Math.floor(d.last_sales_ym / 100) * 12 + d.last_sales_ym % 100)
        : null;
    $("sts-meta").textContent = (months.length
            ? `전 기간 ${int(t.months)}개월 · ${ymLabel(months[0].ym)} ~ ${ymLabel(months[months.length - 1].ym)}`
            : "매출·청구 기록 없음")
        + ` · 마지막 매출 ${d.last_sales_ym ? ymLabel(d.last_sales_ym) : "—"}`
        + (gap > 0 ? ` (자료 최신월 ${ymLabel(d.data_ym)}, ${int(gap)}개월 끊김)` : "");

    const overdue = Number(t.overdue_outstanding) || 0;
    $("sts-kpis").innerHTML = [
        stsTile("① 청구한 돈 (전 기간 합계)", escape(wonFull(t.billed)),
            `청구 ${int(t.billed_months)}개월 · 매출 ${int(t.sales_months)}개월`),
        stsTile("② 들어온 돈 (입금)", escape(wonFull(t.paid)),
            t.billed_months > 0 ? `완납 ${int(t.paid_months)}개월` : ""),
        stsTile("③ 못 받은 돈 (연체)", escape(wonFull(overdue)),
            overdue > 0
                ? `연체 ${int(t.overdue_months)}개월 · 최장 ${int(t.max_overdue_days)}일 — 아래 미수 목록에서 처리`
                : (Number(t.outstanding) > 0
                    ? `납기 전 ${escape(wonFull(t.outstanding))} 남음`
                    : "미수 없음"),
            overdue > 0),
        stsTile("로열티 요율",
            d.rate_pct != null ? `${escape(String(d.rate_pct))}%` : "—",
            d.rate_override
                ? "이 매장 개별 요율 — 아래 '로열티 수정'에서 바꿉니다"
                : "공통 요율"),
    ].join("");

    if (!months.length) {
        $("t-sts-months").innerHTML =
            '<p class="hint">이 매장은 매출도 청구도 기록이 없습니다.</p>';
    } else {
        // 표는 최신 달부터. 열 이름은 월별 표와 같은 말(같은 돈 = 같은 이름).
        const list = [...months].reverse();
        table($("t-sts-months"),
            ["월", "상태", "이 달 매출", "청구한 돈", "들어온 돈", "못 받은 돈", "납기일"],
            list.map((s) => [
                ymLabel(s.ym),
                settleStatusTag(s.status),
                s.sales_amount != null ? wonFull(s.sales_amount) : "—",
                s.invoice_id != null
                    ? wonFull(s.billed_amount)
                        + (s.source === "hq"
                            ? '<div class="meta">본사 확정</div>'
                            : `<div class="meta">매출 × ${escape(String(s.rate_pct))}%</div>`)
                    : "—",
                wonFull(s.paid_amount)
                    + (s.payment_count > 1
                        ? `<div class="meta">${int(s.payment_count)}건</div>` : ""),
                s.outstanding == null ? "—"
                    : s.outstanding < 0
                        ? `${wonFull(s.outstanding)} <span class="tag h-warn">과입금</span>`
                        : wonFull(s.outstanding)
                            + (s.overdue_days > 0 && s.outstanding > 0
                                ? `<div class="meta">연체 ${int(s.overdue_days)}일</div>` : ""),
                s.due_date ? escape(s.due_date) : "—",
            ]),
            { html: true });
    }

    $("sts-note").textContent =
        (state === "closed"
            ? "폐점 매장입니다 — 옛 기록은 열람용이고, 남은 미수는 아래 미수 목록에서 처리합니다. "
            : "")
        + "청구·입금은 아래 '월별 로열티 청구'와 같은 원천입니다 — 청구가 없는 달은 "
        + "'청구 없음'으로 보이고, 그 달을 골라 '청구 생성·갱신'을 누르면 만들어집니다.";
}

async function initSettlementStoreView() {
    const select = $("sts-store");
    $("sts-filter").addEventListener("change", stsFillStores);
    $("sts-month-filter").addEventListener("change", renderSettlementMonthTable);
    // 오픈·폐점 화면에서 기록을 남기면 배지·필터가 낡습니다 — store_db.js 와
    // 같은 신호로 다시 받습니다.
    window.addEventListener("mitaly:storedb-refresh", async () => {
        stsLifecyclePromise = null;
        await stsLoadLifecycle();
        stsFillStores();
        renderSettlementMonthTable();
        if (select.value) refreshSettlementStore();
    });

    const [{ data: stores }] = await Promise.all([fetchStores(), stsLoadLifecycle()]);
    stsStores = stores || [];
    // 104 는 store_id 를 받으므로 값은 id 입니다(sd-store 와 같음).
    stsFillStores();
    searchify(select);
    select.addEventListener("change", refreshSettlementStore);
    // 월별 표는 lifecycle 없이 먼저 그려졌을 수 있어 배지를 다시 붙입니다.
    renderSettlementMonthTable();
}

async function refreshReceivables() {
    const { data, error } = await db.rpc("api_royalty_receivables");
    if (error) {
        $("t-receivables").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + "</p>";
        // hero 가 '집계 중…' 에 멈춰 있으면 사람은 아직 계산 중인 줄 압니다.
        // 모른다는 것을 모른다고 말해야 합니다.
        $("settlement-hero-num").textContent = "—";
        $("settlement-hero-badge").hidden = true;
        $("settlement-hero-facts").textContent =
            "미수를 불러오지 못했습니다: " + error.message;
        return;
    }
    const d = data || {};
    const items = d.items || [];
    const totals = d.totals || {};

    $("st-recv-meta").textContent = items.length
        ? `${int(totals.count)}건 · ${wonFull(totals.outstanding)}`
        : "";

    // ---- hero: 이 화면의 답 (디자인 시스템 v1 · 카드 3계급) ----------------
    //
    // 답은 '지금 못 받은 돈 전부' 입니다. 위 월별 표의 미수 타일과 숫자가 다른데
    // 그게 맞습니다 — 저쪽은 **고른 달**, 여기는 납기가 지난 청구를 달에 상관없이
    // 다 모은 것(api_royalty_receivables)입니다. 화면이 안고 오는 질문은 후자입니다.
    //
    // 금액은 원 단위 정확 표기(wonFull). 정산은 대사 화면이라 만/억 반올림을
    // 쓰지 않습니다 — 매출 헤드라인과 다른 규칙입니다.
    const recvCount = Number(totals.count || 0);
    const recvAmount = Number(totals.outstanding || 0);
    const worstDays = items.reduce(
        (m, r) => Math.max(m, Number(r.overdue_days || 0)), 0);
    const worstRow = items.find(
        (r) => Number(r.overdue_days || 0) === worstDays);

    $("settlement-hero-num").textContent = recvCount ? wonFull(recvAmount) : "0원";
    const sBadge = $("settlement-hero-badge");
    sBadge.hidden = false;
    sBadge.className = "hero-badge " + (recvCount ? "hb-critical" : "hb-good");
    sBadge.textContent = recvCount ? "조치 필요" : "정상";

    $("settlement-hero-facts").textContent = recvCount
        ? `${int(recvCount)}건 · 매장 ${new Set(items.map((r) => r.store)).size}곳`
            + (worstRow ? ` — 가장 오래된 건 ${worstRow.store} ${int(worstDays)}일` : "")
            + " · 아래 목록에서 입금 기록하거나 발송 승인을 요청합니다."
        : "납기가 지난 미수가 없습니다.";

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
