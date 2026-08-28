// 매장 정보 · 배달앱 계정 게이트 — app.js 에서 뽑아낸 shell 분리 조각
// (docs/web-split-plan.md). 2차 암호(S.credPass)는 메모리 전용이며,
// 영역을 떠날 때 nav 쪽이 credLock 으로 잠급니다.
//
// 카드 #145 에서 열람 표가 채널별 계정 유무 표(account.js)로 흡수됐습니다.
// 이 모듈에 남은 것은 ① 게이트 열기/잠그기(자격증명을 받아 account.js 의
// setCredentialRows 로 넘김) ② 추가·수정 폼 ③ 수정 이력입니다.
//
// 29_store_credentials.sql(+64)이 짝입니다. 이 화면만 2차 암호를 받습니다.
//
// [암호를 어디에 두는가]
//   화면이 살아 있는 동안 **메모리에만** 둡니다. localStorage 에 넣지 않습니다 —
//   그러면 브라우저를 닫아도 남아서 '자리 비울 때 잠긴다' 는 목적이 무너집니다.
//   탭을 옮기거나 새로 고치면 다시 받습니다. 자격증명도 같은 규칙 — 게이트가
//   잠기면 여기와 account.js 양쪽에서 버립니다.

import { escape } from "./util.js";
import { $, fillStoreSelect } from "./dom.js";
import { db } from "./client.js";
import { S } from "./state.js";
import { setCredentialRows } from "./account.js";

let credRows = [];

function credFail(message) {
    const box = $("cred-error");
    box.textContent = message;
    box.hidden = false;
}

async function credOpen() {
    const pass = $("cred-pass").value;
    if (!pass) return credFail("암호를 입력해 주세요.");
    $("cred-error").hidden = true;
    $("cred-open").disabled = true;
    try {
        let data, error;
        try {
            // 암호가 틀리면 함수가 예외를 던집니다. 그것이 { error } 로 오기도 하고
            // (Supabase) 그대로 throw 되기도 해서(데모·네트워크 오류) 둘 다 받습니다.
            // 이유를 안 보여 주면 사용자는 왜 안 열리는지 모릅니다.
            ({ data, error } = await db.rpc("api_store_credentials", { p_passcode: pass }));
        } catch (thrown) {
            return credFail(thrown.message || "열지 못했습니다.");
        }
        if (error) return credFail(error.message || "열지 못했습니다.");
        S.credPass = pass;
        credRows = ((data || [])[0] || {}).items || [];
        $("cred-pass").value = "";
        $("cred-gate").hidden = true;
        $("cred-unlocked").hidden = false;
        $("cred-hint").textContent = `계정 ${credRows.length}건`;
        $("cred-body").hidden = false;
        $("cred-edit-hint").hidden = true;
        setCredentialRows(credRows);
        await loadCredChanges();
    } finally {
        $("cred-open").disabled = false;
    }
}

export function credLock() {
    S.credPass = null;
    credRows = [];
    setCredentialRows(null);
    $("cred-unlocked").hidden = true;
    $("cred-hint").textContent = "";
    $("cred-gate").hidden = false;
    $("cred-body").hidden = true;
    $("cred-edit-hint").hidden = false;
    $("cred-save-msg").hidden = true;
    $("cred-changes").innerHTML = "";
}

async function credSave() {
    if (!S.credPass) return;
    const msg = $("cred-save-msg");
    msg.hidden = true;
    const args = {
        p_passcode: S.credPass,
        p_store: $("cred-f-store").value,
        p_channel: $("cred-f-channel").value,
        p_login_id: $("cred-f-id").value.trim(),
        // 빈 칸이면 null 로 보냅니다 — 함수가 기존 비밀번호를 지우지 않습니다.
        p_password: $("cred-f-pw").value || null,
        p_note: $("cred-f-note").value.trim() || null,
    };
    if (!args.p_login_id) {
        msg.textContent = "아이디를 입력해 주세요.";
        msg.hidden = false;
        return;
    }
    $("cred-save").disabled = true;
    try {
        const { data, error } = await db.rpc("api_save_store_credential", args);
        msg.textContent = error
            ? (error.message || "저장하지 못했습니다.")
            : `저장했습니다 · ${args.p_store} ${args.p_channel}`;
        msg.hidden = false;
        if (!error) {
            $("cred-f-pw").value = "";
            // 저장한 값이 실제로 들어갔는지 다시 읽어 위 통합 표에 반영합니다.
            const re = await db.rpc("api_store_credentials", { p_passcode: S.credPass });
            credRows = ((re.data || [])[0] || {}).items || [];
            $("cred-hint").textContent = `계정 ${credRows.length}건`;
            setCredentialRows(credRows);
            await loadCredChanges();
        }
    } finally {
        $("cred-save").disabled = false;
    }
}

async function loadCredChanges() {
    const { data } = await db.from("store_credential_changes")
        .select("channel,changed_at,changed_by,what")
        .order("changed_at", { ascending: false }).limit(30);
    const rows = data || [];
    $("cred-changes").innerHTML = rows.length
        ? `<table><thead><tr><th>언제</th><th>채널</th><th>무엇</th><th>누가</th></tr></thead>
           <tbody>${rows.map((r) => `<tr>
             <td>${escape((r.changed_at || "").slice(0, 16).replace("T", " "))}</td>
             <td>${escape(r.channel)}</td><td>${escape(r.what)}</td>
             <td>${escape(r.changed_by || "")}</td></tr>`).join("")}</tbody></table>`
        : '<p class="note">아직 수정 이력이 없습니다.</p>';
}

export function initCredentials(storeNames) {
    fillStoreSelect($("cred-f-store"), storeNames, null);
    $("cred-open").addEventListener("click", credOpen);
    $("cred-pass").addEventListener("keydown", (e) => {
        if (e.key === "Enter") credOpen();
    });
    $("cred-lock").addEventListener("click", credLock);
    $("cred-save").addEventListener("click", credSave);
}
