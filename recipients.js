// 수신처 (43 notify_recipients + 65 + 72) — app.js 에서 뽑아낸 shell 분리 조각
// (docs/web-split-plan.md).

import { int } from "./format.js";
import { escape } from "./util.js";
import { $, table } from "./dom.js";
import { db } from "./client.js";
import { NOTIFY_KIND_LABEL, NOTIFY_CHANNEL_LABEL } from "./notifications.js";

// ---- 수신처 (43 notify_recipients + 65 이름·담당 SV + 72 웹 입력) ---------
//
// 본사 양식 반입(tools/import_recipients.py)과 웹 직접 입력을 병행합니다
// (담당자 지시 2026-08-13 ①). 저장은 사람 단위(같은 메일의 종류 행을 한 번에
// 맞춤 — 72 설계 판단 [2]). 삭제 버튼은 없습니다 — 체크를 끄면 발송이 멈추고,
// 껐다 켠 자취가 updated_at 으로 남습니다.
//
// [표가 사람 단위인 이유 — 3라운드 2차 담당자 피드백]
//   DB 는 '사람 × 받을 것' 이 한 행이라(반입 양식 그대로) 표를 행대로 그리면
//   같은 이름이 종류 수만큼 반복돼 "왜 두 번 나오냐" 가 됩니다. 그래서 표는
//   사람당 한 줄로 접고, 받을 것을 체크 열로 폅니다 — 체크를 만지면 바로
//   저장됩니다(있던 행은 켜고 끄기, 없던 행은 사람 단위 저장으로 만듦).

// 열 차례는 입력 폼의 체크박스(rc-kinds)와 같게 둡니다.
const RC_KINDS = ["report", "review_alert", "notice", "announcement", "store_close"];

let rcItems = [];
let rcGroups = [];   // 사람(받는 곳×채널) 단위 묶음 — 표의 행

function rcGroupItems(items) {
    const map = new Map();
    for (const r of items) {
        const key = `${r.channel}|${r.recipient}`;
        if (!map.has(key)) map.set(key, { channel: r.channel, recipient: r.recipient, rows: [] });
        map.get(key).rows.push(r);
    }
    for (const g of map.values()) {
        g.base = g.rows.find((r) => r.enabled) || g.rows[0];
    }
    return [...map.values()];
}

async function refreshRecipients() {
    const { data, error } = await db.rpc("api_notify_recipients");
    if (error) {
        $("t-recipients").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + '</p>';
        return;
    }
    rcItems = Array.isArray(data?.items) ? data.items : [];
    rcGroups = rcGroupItems(rcItems);
    $("rc-summary").textContent = rcItems.length
        ? `${int(rcGroups.length)}명 · 켜진 항목 ${int(data.enabled)}건` : "";
    if (!rcItems.length) {
        $("t-recipients").innerHTML =
            '<p class="hint">등록된 수신처가 없습니다 — 지금은 보고서·알림이'
            + ' 만들어져도 아무 데도 가지 않습니다. 위 칸에서 바로 넣을 수'
            + ' 있습니다.</p>';
        return;
    }

    const kindCell = (g, gi, kind) => {
        const row = g.rows.find((r) => r.kind === kind);
        // 웹 저장·켜고 끄기는 메일 채널만 있습니다(72 설계 판단 [3]) —
        // 다른 채널 행은 상태만 보여줍니다.
        if (g.channel !== "mail") return row?.enabled ? "받음" : "—";
        return `<input type="checkbox" data-act="rc-kind" data-g="${gi}"`
            + ` data-kind="${kind}"${row?.enabled ? " checked" : ""}`
            + ` title="체크하면 바로 저장됩니다">`;
    };

    table($("t-recipients"),
        ["이름", "받는 곳",
         ...RC_KINDS.map((k) => NOTIFY_KIND_LABEL[k] || k), "담당 SV", ""],
        rcGroups.map((g, gi) => [
            escape(g.base.display_name || "—"),
            escape(g.recipient)
                + (g.channel !== "mail"
                    ? ` <span class="meta">${escape(NOTIFY_CHANNEL_LABEL[g.channel] || g.channel)}</span>`
                    : ""),
            ...RC_KINDS.map((k) => kindCell(g, gi, k)),
            escape(g.base.sv_name || "—"),
            g.channel === "mail"
                ? `<button type="button" class="ghost" data-act="edit" data-id="${g.base.id}">고치기</button>`
                : "—",
        ]),
        { html: true });
}

// 체크 하나 = 저장 하나. 있던 행은 행 단위 켜고 끄기(toggle), 없던 행은 사람
// 단위 저장(save — 지금 켜진 것 + 이번 체크)으로 만듭니다.
async function toggleKind(box) {
    const group = rcGroups[Number(box.dataset.g)];
    const kind = box.dataset.kind;
    if (!group) return;
    const row = group.rows.find((r) => r.kind === kind);

    box.disabled = true;
    let result;
    if (row) {
        result = await db.rpc("api_notify_recipient_toggle",
            { p_id: row.id, p_enabled: box.checked });
    } else {
        const kinds = group.rows.filter((r) => r.enabled).map((r) => r.kind);
        kinds.push(kind);
        result = await db.rpc("api_notify_recipient_save", {
            p_recipient: group.recipient,
            p_kinds: kinds,
            p_display_name: group.base.display_name,
            p_sv_name: group.base.sv_name,
            p_note: group.base.note,
        });
    }
    const { data, error } = result;
    if (error || !data?.ok) {
        $("rc-notice").textContent = "바꾸지 못했습니다: "
            + (error?.message || data?.reason || "");
        box.checked = !box.checked;
        box.disabled = false;
        return;
    }
    $("rc-notice").textContent =
        `${group.base.display_name || group.recipient} — `
        + `${NOTIFY_KIND_LABEL[kind] || kind} ${box.checked ? "받음" : "끔"}`;
    await refreshRecipients();
}

// '고치기' 는 그 사람의 행들을 위 입력 칸에 올려놓습니다 — 저장이 사람 단위라
// 화면도 사람 단위로 고치는 것이 맞습니다(체크 상태 = 지금 켜진 종류).
function rcFillForm(recipient) {
    const rows = rcItems.filter(
        (r) => r.recipient === recipient && r.channel === "mail");
    if (!rows.length) return;
    const base = rows.find((r) => r.enabled) || rows[0];
    $("rc-name").value = base.display_name || "";
    $("rc-mail").value = recipient;
    $("rc-sv").value = base.sv_name || "";
    $("rc-note").value = base.note || "";
    const on = new Set(rows.filter((r) => r.enabled).map((r) => r.kind));
    for (const box of $("rc-kinds").querySelectorAll("input[type=checkbox]"))
        box.checked = on.has(box.value);
    $("rc-notice").textContent =
        `${base.display_name || recipient} 을(를) 위 칸에 올렸습니다 — 고친 뒤 저장을 누르세요.`;
}

// 저장은 사람 단위라(72 설계 판단 [2]) 체크 안 한 종류가 전부 꺼지고,
// 이름·SV·메모도 빈칸이면 null 로 덮입니다. 그래서 **이미 있는 주소를 빈
// 폼에 직접 치고** '공지' 하나만 체크해 저장하면, 그 사람의 보고서·부정
// 리뷰 수신이 조용히 꺼집니다(2026-09-11 감사). 표의 '고치기' 로 들어오면
// 안 겪는 길이라 눈에 안 띄었습니다.
//
// 서버가 lower(trim(...)) 으로 주소를 맞추므로(72:53) 여기서도 같게 봅니다.
const rcNorm = (mail) => String(mail || "").trim().toLowerCase();

function rcExistingRows(mail) {
    const key = rcNorm(mail);
    if (!key) return [];
    return rcItems.filter((r) => r.channel === "mail" && rcNorm(r.recipient) === key);
}

// 메일 칸에서 손을 떼면 이미 있는 주소인지 보고, 맞으면 지금 상태를
// 올려 줍니다 — 체크가 미리 채워지면 '안 건드린 종류' 가 꺼질 일이 없습니다.
function rcPrefillFromMail() {
    const rows = rcExistingRows($("rc-mail").value);
    if (!rows.length) return;
    rcFillForm(rows[0].recipient);
    const on = rows.filter((r) => r.enabled).map((r) => NOTIFY_KIND_LABEL[r.kind] || r.kind);
    $("rc-notice").textContent = `이미 있는 주소입니다 — 지금 받는 것: `
        + (on.length ? on.join(", ") : "없음") + ". 고친 뒤 저장을 누르세요.";
}

// 저장이 무엇을 끄고 무엇을 지우는지 미리 셉니다(빈 폼 저장의 안전망 —
// 위 채우기를 안 거치고 바로 누르는 길이 남아 있습니다).
function rcOverwriteWarning(kinds) {
    const rows = rcExistingRows($("rc-mail").value);
    if (!rows.length) return null;
    const off = rows.filter((r) => r.enabled && !kinds.includes(r.kind))
        .map((r) => NOTIFY_KIND_LABEL[r.kind] || r.kind);
    const base = rows.find((r) => r.enabled) || rows[0];
    const wiped = [["이름", base.display_name, "rc-name"],
                   ["담당 SV", base.sv_name, "rc-sv"],
                   ["메모", base.note, "rc-note"]]
        .filter(([, had, id]) => had && !$(id).value.trim())
        .map(([label]) => label);
    if (!off.length && !wiped.length) return null;
    return [`${rcNorm($("rc-mail").value)} 은(는) 이미 있습니다.`,
            off.length ? `끕니다: ${off.join(", ")}` : null,
            wiped.length ? `지웁니다: ${wiped.join(", ")}` : null,
            "그대로 저장할까요?"].filter(Boolean).join("\n");
}

async function saveRecipient() {
    const notice = $("rc-notice");
    notice.textContent = "";
    const kinds = [...$("rc-kinds").querySelectorAll("input:checked")]
        .map((box) => box.value);
    const warning = rcOverwriteWarning(kinds);
    if (warning && !window.confirm(warning)) return;
    // RPC 대기 중 버튼을 잠급니다 — 이중 제출 방지(행 버튼들과 같은 패턴).
    // 저장은 업서트라 중복 행은 안 생기지만, 연타가 같은 요청을 겹쳐 보냅니다.
    const button = $("rc-save");
    button.disabled = true;
    try {
        const { data, error } = await db.rpc("api_notify_recipient_save", {
            p_recipient: $("rc-mail").value,
            p_kinds: kinds,
            p_display_name: $("rc-name").value,
            p_sv_name: $("rc-sv").value,
            p_note: $("rc-note").value,
        });
        if (error) {
            notice.textContent = "저장하지 못했습니다: " + error.message;
            return;
        }
        if (!data?.ok) {
            notice.textContent = data?.reason || "저장하지 못했습니다.";
            return;
        }
        notice.textContent = `저장했습니다 — ${data.recipient} · 받을 것 ${data.kinds_on}종`
            + (data.kinds_off ? ` (끈 것 ${data.kinds_off}종)` : "");
        $("rc-name").value = "";
        $("rc-mail").value = "";
        $("rc-sv").value = "";
        $("rc-note").value = "";
        for (const box of $("rc-kinds").querySelectorAll("input[type=checkbox]"))
            box.checked = false;
        await refreshRecipients();
    } finally {
        button.disabled = false;
    }
}

export async function initRecipients() {
    $("rc-save").addEventListener("click", saveRecipient);
    // change = 칸에서 손을 뗐을 때. input(한 글자마다)이면 치는 도중에
    // 폼이 덮여 사용자와 싸웁니다.
    $("rc-mail").addEventListener("change", rcPrefillFromMail);
    $("t-recipients").addEventListener("click", (event) => {
        const button = event.target.closest("button[data-act='edit']");
        if (!button) return;
        const row = rcItems.find((r) => r.id === Number(button.dataset.id));
        if (row) rcFillForm(row.recipient);
    });
    // 체크 열 — 표는 매번 새로 그려지므로 컨테이너에 위임합니다(행 버튼과
    // 같은 패턴, 체크박스라 click 이 아니라 change 를 받습니다).
    $("t-recipients").addEventListener("change", (event) => {
        const box = event.target.closest("input[data-act='rc-kind']");
        if (box) toggleKind(box);
    });
    await refreshRecipients();
}
