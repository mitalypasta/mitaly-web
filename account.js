// 계정 관리 (기반) — 채널별 계정 '유무만' 그립니다. app.js 에서 뽑은 영역
// 모듈(docs/web-split-plan.md). db + foundation 만 import.
//
// api_account_presence(44)는 아이디·비밀번호를 읽지도 않는 함수입니다.

import { db } from "./client.js";
import { int } from "./format.js";
import { escape } from "./util.js";
import { table, $ } from "./dom.js";

let apData = null;   // { channels: [...], stores: [{store_name, has: {...}}], totals: {...} }

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
    drawAccountPresence();
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
    table($("ap-table"),
        ["매장", ...columns],
        list.map((s) => [
            s.store_name,
            ...columns.map((ch) => (s.has[ch] ? "✓" : "")),
        ]));
}
