// POS 메뉴 (5번 영역, 50_pos_menu.sql) — app.js 에서 뽑아낸 shell 분리 조각
// (docs/web-split-plan.md).

import { won, wonFull, int } from "./format.js";
import { escape, debounce } from "./util.js";
import { $, table } from "./dom.js";
import { db } from "./client.js";
import { refreshTasksSummary, refreshTaskList, taskStatusTag } from "./tasks.js";

// ================================================================ POS 메뉴 (5번 영역)
//
// 50_pos_menu.sql 위의 화면입니다. 위쪽 기간·매장 필터는 매출 영역에서만
// 보이므로(showArea 참조) 이 카드는 자체 고르개를 갖습니다.
//
// 변경은 요청 → 승인(30_tasks) → 실행 순서이고, **승인이 곧 실행이 아닙니다.**
// 실제 POS 쓰기는 담당자 입회 아래 첫 건을 넣기 전까지 dry-run 만 쌓입니다
// (docs/pos-write-plan.md). 그래서 표에 승인 상태와 실행 상태를 따로 둡니다 —
// 하나로 합치면 "승인했는데 왜 POS 가 그대로냐" 를 화면이 못 답합니다.

let pmRows = [];
let pmSummary = {};

export async function initPosMenu() {
    // 계정을 바꾸면 분류·매장 목록이 통째로 달라집니다 — 굿모닝(HI5)과
    // 착한통신(INY)은 서로 다른 본부라 같은 분류 코드의 뜻이 다릅니다.
    $("pm-account").addEventListener("change", onPosAccountChange);
    $("pm-store").addEventListener("change", refreshPosMenu);
    $("pm-large").addEventListener("change", refreshPosMenu);
    $("pm-only-unavailable").addEventListener("change", refreshPosMenu);
    // 검색은 서버로 보냅니다 — 3,000종이 넘어 화면에 다 받아 두지 않습니다.
    $("pm-q").addEventListener("input", debounce(refreshPosMenu, 250));
    initPosMenuActions();

    $("dm-store").addEventListener("change", refreshDeliveryMenu);
    $("dm-kind").addEventListener("change", refreshDeliveryMenu);

    await refreshPosMenuSummary();
    await Promise.all([refreshPosMenu(), refreshPosMenuRequests(), refreshOilday(),
                       refreshDeliveryMenu()]);
}

// 배달앱 메뉴 대조 (QUEUE #61, 6번 영역, 57_delivery_menu.sql).
//
// 종류가 넷이고 **신뢰도가 서로 다릅니다.** 화면에서 섞어 놓으면 사람이
// 어느 것을 먼저 볼지 못 정하므로 종류를 앞 열에 두고 세어 보여 줍니다.
//   app_only    POS 상품 목록에 그 이름이 없음 → 점주가 임의로 올린 메뉴
//   hidden      배달앱 메뉴판에 올려 두고 숨김
//   channel_gap 같은 매장인데 배민·요기요 중 한쪽에만 있음 (POS 무관, 확실)
//   price_diff  매장 단독 메뉴의 POS 가격과 다름
//               ⚠️ 배달 수수료를 얹은 값일 수 있어 '오류' 가 아니라 '차이' 입니다.
//               본사 메뉴는 아예 안 봅니다 — POS 어느 채널이 배달 가격인지
//               아직 안 정해졌습니다(57 의 설계 판단 [1], 담당자 확인 대기).
const DM_KIND_LABEL = {
    app_only:    "POS 에 없음",
    hidden:      "앱에서 숨김",
    channel_gap: "한쪽 앱만",
    price_diff:  "가격 다름",
};

let dmData = null;

async function refreshDeliveryMenu() {
    const view = $("t-delivmenu");
    const meta = $("dm-meta");

    if (!dmData) {
        const { data, error } = await db.rpc("api_delivery_menu_check");
        if (error) {
            // 57 이 아직 안 들어간 환경이면 함수 자체가 없습니다(PostgREST PGRST202).
            // 배포가 SQL 적용보다 먼저 나갈 수 있어, 그때 직원 화면에 날 오류가
            // 뜨지 않도록 '준비 중' 으로 떨어뜨립니다.
            const missing = error.code === "PGRST202"
                || /Could not find the function/i.test(error.message || "");
            meta.textContent = "";
            view.innerHTML = missing
                ? '<p class="hint">배달앱 메뉴 대조는 아직 이 환경에 들어오지 '
                  + "않았습니다. 반영되면 자동으로 나타납니다.</p>"
                : '<p class="hint">불러오지 못했습니다: '
                  + escape(error.message) + "</p>";
            return;
        }
        dmData = data || {};
        fillDeliveryStoreSelect(dmData);
    }

    if (!dmData.collected_at) {
        meta.textContent = "";
        view.innerHTML = '<p class="hint">배달앱 메뉴 반입이 아직 없습니다 — '
            + "반입되면 자동으로 대조합니다.</p>";
        return;
    }

    const counts = dmData.counts || {};
    const parts = Object.keys(DM_KIND_LABEL)
        .filter((k) => counts[k])
        .map((k) => `${DM_KIND_LABEL[k]} ${int(counts[k])}`);
    meta.textContent = `기준 ${String(dmData.collected_at).slice(0, 10)} · `
        + `매장 ${int(dmData.stores)}곳 · 메뉴 ${int(dmData.menus)}개`
        + (parts.length ? ` · ${parts.join(" · ")}` : "");

    const store = $("dm-store").value;
    const kind = $("dm-kind").value;
    const items = (dmData.items || []).filter((it) =>
        (!store || it.store === store) && (!kind || it.kind === kind));

    const all = (dmData.items || []).length;
    $("dm-shown").textContent = items.length < all
        ? `${int(items.length)} / ${int(all)}건` : `${int(all)}건`;

    if (!items.length) {
        view.innerHTML = '<p class="hint">조건에 맞는 항목이 없습니다.</p>';
        return;
    }

    table(view,
        ["종류", "매장", "앱", "메뉴", "분류", "앱 가격", "POS 가격"],
        items.map((it) => [
            DM_KIND_LABEL[it.kind] || it.kind,
            it.store,
            it.platform === "baemin" ? "배민" : "요기요",
            it.menu_name + (it.hidden && it.kind !== "hidden" ? " (숨김)" : ""),
            it.category || "—",
            // 메뉴 가격은 won() 이 아니라 wonFull() 입니다 — won() 은 만 단위로
            // 줄여서 67,800원이 '7만' 으로 나옵니다(POS 메뉴 카드와 같은 이유).
            it.price == null ? "—" : wonFull(it.price),
            it.pos_price == null ? "—" : wonFull(it.pos_price),
        ]));
}

function fillDeliveryStoreSelect(data) {
    const select = $("dm-store");
    select.length = 1;
    const stores = [...new Set((data.items || []).map((it) => it.store))].sort();
    for (const name of stores) {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        select.append(opt);
    }
}

// 오일데이 원복 점검 (QUEUE #62, 56_oilday_check.sql). 반값은 정상 상품의
// 가격 변경이 아니라 별도 '(이벤트)' 상품을 켜고 끄는 운영이라(2026-08-06
// 실측 — 정상 가격을 반값으로 고친 사례 0건), 행사날이 아닌데 켜져 있는
// 오일메뉴 이벤트 상품을 목록으로 보여줍니다.
async function refreshOilday() {
    const meta = $("od-meta");
    const view = $("t-oilday");
    const { data, error } = await db.rpc("api_oilday_check");
    if (error) {
        view.innerHTML = '<p class="hint">불러오지 못했습니다: '
            + escape(error.message) + "</p>";
        return;
    }
    const check = data || {};
    const items = check.items || [];

    if (!check.snapshot_at) {
        meta.textContent = "";
        view.innerHTML = '<p class="hint">POS 메뉴 반입이 아직 없습니다 — '
            + "반입되면 자동으로 판정합니다.</p>";
        return;
    }

    const snapDate = String(check.snapshot_at).slice(0, 10);
    meta.textContent = `기준 스냅샷 ${snapDate} · 행사일 매월 ${check.event_day}일`;

    // 행사날 스냅샷이면 켜져 있는 것이 정상입니다 — 판정하지 않습니다(설계 판단 [3]).
    if (check.is_event_day) {
        view.innerHTML = '<p class="hint">기준 스냅샷이 행사일(' + int(check.event_day)
            + "일)에 반입된 것이라 이벤트 상품이 켜져 있는 것이 정상입니다. "
            + "행사 다음 날 반입분으로 다시 판정합니다.</p>";
        return;
    }

    if (!items.length) {
        view.innerHTML = '<p class="hint">켜진 채 남은 오일메뉴 이벤트 상품이 '
            + "없습니다 — 전 매장 원복 완료.</p>";
        return;
    }

    table(view,
        ["계정", "매장(분류)", "상품", "가격", "상태"],
        items.map((it) => [
            it.account,
            it.store_name || it.medium_name || "—",
            it.item_name,
            won(it.price),
            it.soldout_name || it.soldout_code || "—",
        ]));
}

async function onPosAccountChange() {
    // 고른 계정에 없는 분류·매장이 남아 있으면 빈 표가 나옵니다. 비우고 다시 채웁니다.
    $("pm-large").value = "";
    $("pm-store").value = "";
    fillPosLargeSelect();
    await fillPosStoreSelect();
    await refreshPosMenu();
}

// 분류 고르개. 계정을 고르면 그 계정 것만, 아니면 계정 이름을 붙여 보여줍니다
// (004 처럼 코드가 같고 뜻이 다른 분류가 있어 이름만으로는 구분이 안 됩니다).
function fillPosLargeSelect() {
    const account = $("pm-account").value;
    const select = $("pm-large");
    select.length = 1;
    for (const g of (pmSummary.by_large || [])) {
        if (account && g.account !== account) continue;
        const opt = document.createElement("option");
        opt.value = g.code;
        opt.textContent = (account ? "" : `[${g.account}] `)
            + `${g.name || g.code} (${int(g.items)})`;
        select.append(opt);
    }
}

async function fillPosStoreSelect() {
    const select = $("pm-store");
    select.length = 1;
    const { data } = await db.rpc("api_pos_menu_stores",
        { p_account: $("pm-account").value || null });
    for (const s of Array.isArray(data) ? data : []) {
        const opt = document.createElement("option");
        opt.value = s.store;
        // 매장 대장에 없는 표기(폐점·이름 차이)도 고를 수 있어야 합니다 —
        // 빼면 그 매장 메뉴는 화면에서 영영 못 봅니다.
        opt.textContent = s.matched
            ? `${s.store} (${int(s.items)})`
            : `${s.store} (${int(s.items)}) — 대장에 없음`;
        select.append(opt);
    }
}

// 매장 칸 밑에 붙는 한 줄. 계정을 안 좁혔으면 어느 본부 것인지 밝힙니다 —
// 두 계정이 섞이면 같은 매장 이름이 양쪽에 다 나올 수 있습니다.
function pmStoreNote(row) {
    const parts = [];
    if (row.store_scope === "common") parts.push("본사 메뉴");
    if (!$("pm-account").value) parts.push(escape(row.account));
    return parts.length ? `<div class="meta">${parts.join(" · ")}</div>` : "";
}

function pmSoldoutTag(row) {
    const label = escape(row.soldout_name || row.soldout_code || "—");
    return row.unavailable
        ? `<span class="tag warn">${label}</span>`
        : `<span class="tag">${label}</span>`;
}

export async function refreshPosMenuSummary() {
    const { data, error } = await db.rpc("api_pos_menu_summary");
    if (error) {
        $("pm-meta").textContent = "불러오지 못했습니다: " + error.message;
        return;
    }
    pmSummary = data || {};
    const d = pmSummary;
    const has = Number(d.items) > 0;
    $("pm-kpis").hidden = !has;
    if (!has) {
        $("pm-meta").textContent = "아직 반입 전입니다";
        return;
    }
    $("pm-items").textContent = int(d.items);
    $("pm-unavailable").textContent = int(d.unavailable);
    // 이 값은 메뉴 수가 아니라 **매장 수**입니다 (count(distinct store_id)).
    // 옆 타일 둘이 상품 종수라 라벨을 '메뉴가 붙은 매장' 으로 못박아 뒀습니다.
    $("pm-stores").textContent = int(d.stores) + "곳";
    $("pm-open").textContent = int(d.open_requests);
    $("pm-collected").textContent = d.collected_at
        ? String(d.collected_at).slice(0, 10) + " 기준" : "";
    // 못 맞춘 매장 표기는 숨기지 않습니다 — 보여야 고칩니다(미매핑 품목과 같은 태도).
    $("pm-unmatched").textContent = Number(d.unmatched)
        ? `매장 못 맞춘 표기 ${int(d.unmatched)}개` : "";
    // 머리말은 계정별로 씁니다. 계정마다 본부가 달라 합계만 보면 뜻이 흐려집니다.
    $("pm-meta").textContent = (d.by_account || [])
        .map((a) => `${a.account}(${a.hq_code || "?"}) ${int(a.items)}종`).join(" · ");

    const accountSelect = $("pm-account");
    if (accountSelect.options.length <= 1) {
        for (const a of d.by_account || []) {
            const opt = document.createElement("option");
            opt.value = a.account;
            opt.textContent = `${a.account} (${int(a.items)})`;
            accountSelect.append(opt);
        }
    }
    fillPosLargeSelect();
    if ($("pm-store").options.length <= 1) await fillPosStoreSelect();
}

export async function refreshPosMenu() {
    const args = { p_limit: 300 };
    if ($("pm-account").value) args.p_account = $("pm-account").value;
    if ($("pm-store").value) args.p_store = $("pm-store").value;
    if ($("pm-large").value) args.p_large = $("pm-large").value;
    if ($("pm-q").value.trim()) args.p_q = $("pm-q").value.trim();
    if ($("pm-only-unavailable").checked) args.p_only_unavailable = true;

    const { data, error } = await db.rpc("api_pos_menus", args);
    if (error) {
        pmRows = [];
        $("t-posmenu").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + "</p>";
        return;
    }
    const d = data || {};
    pmRows = d.items || [];
    $("pm-shown").textContent = Number(d.total) > Number(d.shown)
        ? `${int(d.total)}건 중 ${int(d.shown)}건 표시` : `${int(d.shown)}건`;

    if (!pmRows.length) {
        $("t-posmenu").innerHTML = '<p class="hint">조건에 맞는 메뉴가 없습니다.</p>';
        return;
    }

    table($("t-posmenu"),
        ["상태", "매장", "분류", "메뉴", "상품코드", "판매가", "처리"],
        pmRows.map((r) => [
            pmSoldoutTag(r),
            escape(r.store) + pmStoreNote(r),
            escape(r.category || "—"),
            escape(r.item_name),
            escape(r.item_code),
            r.price == null ? "—" : wonFull(r.price),
            r.change_task_id
                ? taskStatusTag(r.change_task_status)
                    + `<div class="meta">업무 #${int(r.change_task_id)}</div>`
                : `<button class="ghost" data-act="pm-request"`
                    + ` data-menu-item-id="${r.menu_item_id}"`
                    + ` data-to="${r.unavailable ? "0" : "1"}"`
                    + ` data-item="${escape(r.item_name)}"`
                    + ` data-store="${escape(r.store)}"`
                    + ` data-scope="${escape(r.store_scope)}">`
                    + `${r.unavailable ? "판매 재개 요청" : "품절 요청"}</button>`,
        ]),
        { html: true });
}

// 실행 칸. '승인됨' 과 'POS 에 반영됨' 은 다른 것이라 따로 보여줍니다.
function pmExecutionTag(row) {
    if (row.applied) return '<span class="tag up">반영됨</span>';
    if (row.last_mode === "live" && row.last_ok === false) {
        return '<span class="tag down">실패</span>';
    }
    if (row.last_mode === "dry_run") {
        return '<span class="tag">dry-run</span>'
            + '<div class="meta">POS 는 그대로입니다</div>';
    }
    if (row.task_status === "done") return '<span class="tag h-warn">실행 대기</span>';
    return "—";
}

export async function refreshPosMenuRequests() {
    const { data, error } = await db.rpc("api_pos_menu_requests", { p_limit: 100 });
    if (error) {
        $("t-posmenu-requests").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + "</p>";
        return;
    }
    const rows = Array.isArray(data) ? data : [];
    $("pm-req-meta").textContent = rows.length ? `${int(rows.length)}건` : "";
    // 목록을 다시 그리면 열려 있던 이력 패널은 옛 요청 것이라 닫습니다.
    $("posmenu-exec-panel").hidden = true;
    if (!rows.length) {
        $("t-posmenu-requests").innerHTML =
            '<p class="hint">아직 변경 요청이 없습니다.</p>';
        return;
    }
    table($("t-posmenu-requests"),
        ["승인", "실행", "매장", "메뉴", "바꿀 내용", "요청 사유", "요청일", "이력"],
        rows.map((r) => [
            taskStatusTag(r.task_status)
                + `<div class="meta">업무 #${int(r.task_id)}</div>`,
            pmExecutionTag(r),
            escape(r.store || "—"),
            escape(r.item_name) + `<div class="meta">${escape(r.item_code)}</div>`,
            escape(r.field) + " "
                + escape(r.before_label || r.before_value || "(없음)")
                + " → " + escape(r.after_label || r.after_value),
            escape(r.reason || "—"),
            escape(String(r.created_at).slice(0, 10)),
            Number(r.executions)
                ? `<button class="ghost" data-act="pm-executions"`
                    + ` data-request-id="${r.request_id}"`
                    + ` data-item="${escape(r.item_name)}">${int(r.executions)}건</button>`
                : "—",
        ]),
        { html: true });
}

// 한 요청의 실행 이력. dry-run 이 몇 번 돌았는지, 실제로 나간 건 언제인지가
// 여기 있습니다 — 목록의 배지 한 칸으로는 그 경위를 못 보여줍니다.
async function showPosMenuExecutions(requestId, itemName) {
    const panel = $("posmenu-exec-panel");
    panel.hidden = false;
    $("posmenu-exec-title").textContent = `${itemName} — 실행 이력`;
    $("t-posmenu-executions").innerHTML = '<p class="hint">불러오는 중…</p>';

    const { data, error } = await db.rpc("api_pos_menu_executions",
        { p_request_id: requestId });
    if (error) {
        $("t-posmenu-executions").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + "</p>";
        return;
    }
    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) {
        $("t-posmenu-executions").innerHTML = '<p class="hint">실행 이력이 없습니다.</p>';
        return;
    }
    table($("t-posmenu-executions"),
        ["언제", "방식", "결과", "POS 응답", "다시 읽은 값", "메모"],
        rows.map((e) => [
            escape(String(e.executed_at).replace("T", " ").slice(0, 16)),
            e.mode === "live"
                ? '<span class="tag warn">실제 전송</span>'
                : '<span class="tag">dry-run</span>',
            e.ok ? '<span class="tag up">성공</span>'
                 : '<span class="tag down">실패</span>',
            escape(e.response_code || "—")
                + (e.response_msg ? `<div class="meta">${escape(e.response_msg)}</div>` : ""),
            escape(e.verified_value || "—"),
            escape(e.note || "—"),
        ]),
        { html: true });
}

function initPosMenuActions() {
    $("t-posmenu-requests").addEventListener("click", (event) => {
        const button = event.target.closest("button[data-act='pm-executions']");
        if (!button) return;
        showPosMenuExecutions(Number(button.dataset.requestId), button.dataset.item);
    });

    // 목록은 매번 새로 그려지므로 컨테이너에 한 번만 위임합니다.
    $("t-posmenu").addEventListener("click", async (event) => {
        const button = event.target.closest("button[data-act='pm-request']");
        if (!button) return;

        const to = button.dataset.to;
        const what = to === "0" ? "판매 재개" : "품절 처리";
        let message = `${button.dataset.store} · ${button.dataset.item}\n`
            + `${what} 를 승인 대기로 올립니다.`;
        if (button.dataset.scope === "common") {
            // 본사 마스터 상품이라 전 매장에 걸릴 수 있습니다 — 누르기 전에
            // 알려야 합니다. 매장 단위 여부는 아직 확인 전입니다(입회 시험 항목).
            message += "\n\n이 메뉴는 본사 메뉴입니다."
                + " 한 매장이 아니라 전 매장에 걸릴 수 있습니다.";
        }
        if (!window.confirm(message)) return;

        const reason = window.prompt("요청 사유를 적어 주세요. 이력에 남습니다.", "");
        if (reason === null) return;

        const label = button.textContent;
        button.disabled = true;
        button.textContent = "처리 중…";

        const { data, error } = await db.rpc("request_pos_menu_change", {
            p_menu_item_id: Number(button.dataset.menuItemId),
            p_change_type: "soldout",
            p_after_value: to,
            p_reason: reason.trim() ? reason.trim() : null,
        });

        if (error || (data && data.ok === false)) {
            window.alert(error ? error.message : (data.reason || "요청하지 못했습니다"));
            button.disabled = false;
            button.textContent = label;
            return;
        }

        // 업무 영역의 승인 대기 숫자가 이 요청을 비추므로 같이 새로 그립니다 —
        // 영역 전환은 다시 조회하지 않아(showArea 원칙) 여기서 안 하면 옛 숫자가 남습니다.
        await Promise.all([
            refreshPosMenu(), refreshPosMenuRequests(), refreshPosMenuSummary(),
            refreshTasksSummary(), refreshTaskList(),
        ]);
    });
}
