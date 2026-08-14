// 매장 정보 · 배달앱 계정 — app.js 에서 뽑아낸 shell 분리 조각
// (docs/web-split-plan.md). 2차 암호(S.credPass)는 메모리 전용이며,
// 영역을 떠날 때 nav 쪽이 credLock 으로 잠급니다.

import { escape } from "./util.js";
import { $, fillStoreSelect } from "./dom.js";
import { db } from "./client.js";
import { S } from "./state.js";

// ---- 매장 정보 · 배달앱 계정 ---------------------------------------------
//
// 29_store_credentials.sql 이 짝입니다. 이 화면만 2차 암호를 받습니다.
//
// [암호를 어디에 두는가]
//   화면이 살아 있는 동안 **메모리에만** 둡니다. localStorage 에 넣지 않습니다 —
//   그러면 브라우저를 닫아도 남아서 '자리 비울 때 잠긴다' 는 목적이 무너집니다.
//   탭을 옮기거나 새로 고치면 다시 받습니다.
//
// [비밀번호를 왜 가리는가]
//   담당자 요구(2026-07-30). 열람 기록은 남기지 않기로 했으므로, 최소한
//   화면에 그냥 떠 있지는 않게 합니다. 누르면 그 줄만 펼칩니다.

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
        $("cred-body").hidden = false;
        $("cred-hint").textContent = `계정 ${credRows.length}건`;
        drawCredentials();
        await loadCredChanges();
    } finally {
        $("cred-open").disabled = false;
    }
}

export function credLock() {
    S.credPass = null;
    credRows = [];
    $("cred-body").hidden = true;
    $("cred-gate").hidden = false;
    $("cred-hint").textContent = "";
    $("cred-table").innerHTML = "";
    $("cred-changes").innerHTML = "";
}

function drawCredentials() {
    const only = $("cred-store").value;
    const rows = only ? credRows.filter((r) => r.store === only) : credRows;
    if (!rows.length) {
        $("cred-table").innerHTML =
            '<p class="note">등록된 계정이 없습니다. 아래에서 추가하세요.</p>';
        return;
    }
    const body = rows.map((r, i) => `<tr>
        <td>${escape(r.store)}</td>
        <td>${escape(r.channel)}</td>
        <td>${escape(r.login_id)}</td>
        <td><button class="linkish cred-peek" data-i="${i}"
                    type="button">●●●●●● 보기</button>
            <span class="cred-pw" data-i="${i}" hidden>${escape(r.password || "(없음)")}</span></td>
        <td>${escape(r.note || "")}</td>
        <td>${escape((r.updated_at || "").slice(0, 10))} ${escape(r.updated_by || "")}</td>
    </tr>`).join("");
    $("cred-table").innerHTML = `<table><thead><tr>
        <th>매장</th><th>채널</th><th>아이디</th><th>비밀번호</th><th>메모</th><th>마지막 수정</th>
        </tr></thead><tbody>${body}</tbody></table>`;

    for (const b of $("cred-table").querySelectorAll(".cred-peek")) {
        b.addEventListener("click", () => {
            const span = $("cred-table")
                .querySelector(`.cred-pw[data-i="${b.dataset.i}"]`);
            span.hidden = !span.hidden;
            b.hidden = !span.hidden;
        });
    }
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
            // 저장한 값이 실제로 들어갔는지 다시 읽어 확인합니다.
            const re = await db.rpc("api_store_credentials", { p_passcode: S.credPass });
            credRows = ((re.data || [])[0] || {}).items || [];
            drawCredentials();
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
    fillStoreSelect($("cred-store"), storeNames, "전체 매장");
    fillStoreSelect($("cred-f-store"), storeNames, null);
    $("cred-open").addEventListener("click", credOpen);
    $("cred-pass").addEventListener("keydown", (e) => {
        if (e.key === "Enter") credOpen();
    });
    $("cred-lock").addEventListener("click", credLock);
    $("cred-store").addEventListener("change", drawCredentials);
    $("cred-save").addEventListener("click", credSave);
}
