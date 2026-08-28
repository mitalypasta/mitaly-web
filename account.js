// 매장 정보 · 채널별 계정 — 유무 표와 배달앱 계정 열람을 한 표로(카드 #145).
// app.js 에서 뽑은 영역 모듈(docs/web-split-plan.md). db + foundation 만 import.
//
// 평소에는 api_account_presence(44)의 체크만 그립니다 — 그 함수는 아이디·
// 비밀번호를 읽지도 않습니다. credentials.js 의 2차 암호 게이트가 열리면
// setCredentialRows() 로 자격증명을 받아 체크 자리에 아이디(1행)·비밀번호(2행)를
// 그립니다. 자격증명은 게이트 전에는 이 모듈로 들어오지 않고, 잠그면
// setCredentialRows(null) 로 버립니다.
//
// [비밀번호를 게이트 뒤에도 가리는 이유]
//   담당자 요구(2026-07-30, 옛 배달앱 계정 카드의 관례 그대로) — 화면에 그냥
//   떠 있지 않게 하고, 누르면 그 칸만 펼칩니다. 펼친 값을 다시 누르면 도로
//   가립니다(100+행 표라 되돌릴 길이 필요합니다).
//
// [엑셀 내보내기는 항상 체크 모양]
//   table() 이 카드에 자동으로 붙이는 엑셀 버튼이 게이트가 열린 표를 그대로
//   내리면 비밀번호가 파일로 남습니다. 내보내기 등록(options.export)은 잠김
//   여부와 무관하게 유무(✓) 모양으로 고정합니다 — 계정표 파일이 필요하면
//   tools/export_credentials.py 가 그 일입니다.

import { db } from "./client.js";
import { int } from "./format.js";
import { escape } from "./util.js";
import { table, $ } from "./dom.js";

let apData = null;   // { channels: [...], stores: [{store_name, has: {...}}], totals: {...} }
let credRows = null; // null = 잠김 · 배열 = 게이트 통과(credentials.js 가 넣음)

export async function initAccountPresence() {
    const { data, error } = await db.rpc("api_account_presence");
    if (error) {
        $("ap-table").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + "</p>";
        return;
    }
    apData = data || { channels: [], stores: [], totals: {} };

    const channelSelect = $("ap-channel");
    for (const ch of apData.channels) {
        const opt = document.createElement("option");
        opt.value = ch;
        opt.textContent = ch;
        channelSelect.append(opt);
    }
    channelSelect.addEventListener("change", drawAccountPresence);
    $("ap-state").addEventListener("change", drawAccountPresence);

    // 비밀번호 펼치기/가리기 — 표를 다시 그려도 살아남게 위임 한 번으로 답니다.
    $("ap-table").addEventListener("click", (e) => {
        const peek = e.target.closest(".ap-peek");
        if (peek) {
            const pw = peek.nextElementSibling;
            pw.hidden = false;
            peek.hidden = true;
            return;
        }
        const pw = e.target.closest(".ap-pw");
        if (pw) {
            pw.hidden = true;
            pw.previousElementSibling.hidden = false;
        }
    });
    drawAccountPresence();
}

// credentials.js 가 게이트를 열고 닫을 때 부릅니다. rows = null 이면 잠김.
export function setCredentialRows(rows) {
    credRows = rows;
    if (apData) drawAccountPresence();
}

// 게이트 뒤 체크 칸 하나 — 아이디 1행 + 비밀번호 2행(가림·누르면 펼침).
// 값은 표기 그대로입니다(앞자리 0·부분 입력 포함, 가공 금지). 비밀번호가
// 없는 계정은 옛 카드 관례대로 '(없음)' 으로 보입니다. 메모·마지막 수정은
// 칸의 title(마우스 올림)로 남습니다 — 6열 표에 열을 더 낼 자리가 없습니다.
function credCell(c) {
    const tip = [
        c.note ? `메모: ${c.note}` : "",
        c.updated_at ? `마지막 수정: ${(c.updated_at || "").slice(0, 10)} ${c.updated_by || ""}` : "",
    ].filter(Boolean).join("\n");
    return `<div class="ap-cred"${tip ? ` title="${escape(tip)}"` : ""}>` +
        `<div class="ap-id">${escape(c.login_id ?? "")}</div>` +
        `<div><button type="button" class="linkish ap-peek">●●●●●●</button>` +
        `<span class="ap-pw" hidden>${escape(c.password || "(없음)")}</span></div>` +
        `</div>`;
}

function drawAccountPresence() {
    const channel = $("ap-channel").value;
    const state = $("ap-state").value;

    const withAny = apData.stores.filter((s) => Object.keys(s.has).length).length;
    $("ap-summary").textContent =
        apData.channels.map((ch) => `${ch} ${int(apData.totals[ch] || 0)}`).join(" · ")
        + ` · 계정 있는 매장 ${int(withAny)}/${int(apData.stores.length)}곳`;

    let list = apData.stores;
    if (channel) {
        if (state === "has") list = list.filter((s) => s.has[channel]);
        else if (state === "none") list = list.filter((s) => !s.has[channel]);
    } else if (state === "has") {
        list = list.filter((s) => Object.keys(s.has).length);
    } else if (state === "none") {
        list = list.filter((s) => !Object.keys(s.has).length);
    }

    if (!list.length) {
        $("ap-table").innerHTML = '<p class="hint">조건에 맞는 매장이 없습니다.</p>';
        return;
    }

    const columns = channel ? [channel] : apData.channels;
    const headers = ["매장", ...columns];

    // 유무(✓)만 — 잠김 상태의 화면이자, 항상 이 모양으로 나가는 엑셀 등록분.
    const presenceRows = list.map((s) => [
        s.store_name,
        ...columns.map((ch) => (s.has[ch] ? "✓" : "")),
    ]);

    if (!credRows) {
        table($("ap-table"), headers, presenceRows);
        return;
    }

    // 게이트 통과 — 매장|채널 로 자격증명을 찾아 체크 자리에 넣습니다.
    // 계정 행이 있으면 유무 체크와 무관하게 그립니다(값이 곧 근거) · 행이
    // 없는 체크는 체크대로 둡니다(계정은 등록됐는데 값이 안 온 칸을 지어내지
    // 않습니다).
    const byKey = new Map();
    for (const c of credRows) byKey.set(`${c.store}|${c.channel}`, c);
    const rows = list.map((s) => [
        escape(s.store_name),   // html:true 라 셀을 만드는 쪽이 escape 책임
        ...columns.map((ch) => {
            const c = byKey.get(`${s.store_name}|${ch}`);
            if (c) return credCell(c);
            return s.has[ch] ? "✓" : "";
        }),
    ]);
    table($("ap-table"), headers, rows,
        { html: true, export: { headers, rows: presenceRows } });
}
