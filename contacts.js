// 점주 연락처·계약 (44_store_contacts) — app.js 에서 뽑아낸 shell 분리 조각
// (docs/web-split-plan.md). credentials 와 같은 2차 암호 게이트(S.ctPass).

import { int } from "./format.js";
import { escape } from "./util.js";
import { table, $, fillStoreSelect } from "./dom.js";
import { db } from "./client.js";
import { S } from "./state.js";

// ---- 점주 연락처·계약 (44_store_contacts, QUEUE #56) --------------------
//
// 배달앱 계정(credentials)과 같은 2차 암호 게이트를 씁니다. 암호는 메모리에만
// 두고, 매장 정보 영역을 떠나면 잠급니다(showArea 참조). 대량 반입은 수집 PC
// 도구(import_store_db --contacts)가 하고 이 화면은 열람 + 한 매장씩 수정.

let ctRows = [];

function ctFail(message) {
    const box = $("ct-error");
    box.textContent = message;
    box.hidden = false;
}

async function ctSummary() {
    const { data } = await db.rpc("api_store_contacts_summary", {});
    if (data && typeof data.stores_with_contacts === "number") {
        $("ct-summary").textContent = data.stores_with_contacts
            ? `${int(data.stores_with_contacts)}개 매장 등록 · 마지막 반입 `
              + (String(data.last_imported_at || "").slice(0, 10) || "—")
            : "등록된 연락처 없음";
    }
}

async function ctOpen() {
    const pass = $("ct-pass").value;
    if (!pass) return ctFail("암호를 입력해 주세요.");
    $("ct-error").hidden = true;
    $("ct-open").disabled = true;
    try {
        let data, error;
        try {
            ({ data, error } = await db.rpc("api_store_contacts", { p_passcode: pass }));
        } catch (thrown) {
            return ctFail(thrown.message || "열지 못했습니다.");
        }
        if (error) return ctFail(error.message || "열지 못했습니다.");
        if (!data || data.ok === false) {
            return ctFail((data && data.error) || "열지 못했습니다.");
        }
        S.ctPass = pass;
        ctRows = Array.isArray(data.contacts) ? data.contacts : [];
        $("ct-pass").value = "";
        $("ct-gate").hidden = true;
        $("ct-body").hidden = false;
        drawContacts();
    } finally {
        $("ct-open").disabled = false;
    }
}

export function ctLock() {
    S.ctPass = null;
    ctRows = [];
    if (!$("ct-body")) return;
    $("ct-body").hidden = true;
    $("ct-gate").hidden = false;
    $("ct-table").innerHTML = "";
    $("ct-save-msg").hidden = true;
}

function drawContacts() {
    const only = $("ct-store").value;
    const rows = only ? ctRows.filter((r) => r.store_name === only) : ctRows;
    if (!rows.length) {
        $("ct-table").innerHTML =
            '<p class="hint">등록된 연락처가 없습니다. 반입 도구가 들여오면 여기 나타납니다.</p>';
        return;
    }
    table($("ct-table"),
        ["매장", "가맹주", "점주 전화", "실운영자", "실운영자 연락처", "매장 전화",
         "이메일", "주소", "사업자번호", "계약기간", "양도양수", ""],
        rows.map((r, i) => [
            escape(r.store_name),
            escape(r.owner_name || "—"),
            escape(r.owner_phone || "—"),
            escape(r.operator_name || "—"),
            escape(r.operator_phone || "—"),
            escape(r.store_phone || "—"),
            escape(r.email || "—"),
            escape(r.address || "—"),
            escape(r.business_number || "—"),
            escape(r.contract_period || "—"),
            escape(r.transfer_note || "—"),
            `<button class="ghost ct-edit" data-i="${i}" type="button">수정</button>`,
        ]),
        { html: true });
    for (const b of $("ct-table").querySelectorAll(".ct-edit")) {
        b.addEventListener("click", () => ctFillForm(rows[Number(b.dataset.i)]));
    }
}

function ctFillForm(r) {
    $("ct-f-store").value = r.store_name;
    $("ct-f-owner").value = r.owner_name || "";
    $("ct-f-owner-phone").value = r.owner_phone || "";
    $("ct-f-operator").value = r.operator_name || "";
    $("ct-f-operator-phone").value = r.operator_phone || "";
    $("ct-f-store-phone").value = r.store_phone || "";
    $("ct-f-email").value = r.email || "";
    $("ct-f-address").value = r.address || "";
    $("ct-f-bizno").value = r.business_number || "";
    $("ct-f-contract").value = r.contract_period || "";
    $("ct-f-transfer").value = r.transfer_note || "";
    $("ct-f-owner").focus();
}

async function ctSave() {
    if (!S.ctPass) return;
    const msg = $("ct-save-msg");
    msg.hidden = true;
    const val = (id) => $(id).value.trim() || null;
    const args = {
        p_passcode: S.ctPass,
        p_store: $("ct-f-store").value,
        p_owner_name: val("ct-f-owner"),
        p_owner_phone: val("ct-f-owner-phone"),
        p_operator_name: val("ct-f-operator"),
        p_operator_phone: val("ct-f-operator-phone"),
        p_store_phone: val("ct-f-store-phone"),
        p_email: val("ct-f-email"),
        p_address: val("ct-f-address"),
        p_business_number: val("ct-f-bizno"),
        p_contract_period: val("ct-f-contract"),
        p_transfer_note: val("ct-f-transfer"),
    };
    $("ct-save").disabled = true;
    try {
        const { data, error } = await db.rpc("save_store_contact", args);
        const failed = error || !data || data.ok === false;
        msg.textContent = failed
            ? ((error && error.message) || (data && data.error) || "저장하지 못했습니다.")
            : `저장했습니다 · ${args.p_store}`;
        msg.hidden = false;
        if (!failed) {
            // 저장한 값이 실제로 들어갔는지 다시 읽어 확인합니다(cred 와 같은 규칙).
            const re = await db.rpc("api_store_contacts", { p_passcode: S.ctPass });
            if (re.data && re.data.ok !== false) {
                ctRows = re.data.contacts || [];
            }
            drawContacts();
            ctSummary();
        }
    } finally {
        $("ct-save").disabled = false;
    }
}

export function initContacts(storeNames) {
    if (!$("contacts-card")) return;
    fillStoreSelect($("ct-store"), storeNames, "전체");
    fillStoreSelect($("ct-f-store"), storeNames, null);
    $("ct-open").addEventListener("click", ctOpen);
    $("ct-pass").addEventListener("keydown", (e) => {
        if (e.key === "Enter") ctOpen();
    });
    $("ct-lock").addEventListener("click", ctLock);
    $("ct-store").addEventListener("change", drawContacts);
    $("ct-save").addEventListener("click", ctSave);
    ctSummary();
}
