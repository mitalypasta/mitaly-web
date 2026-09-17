// 설정 탭 — SV 관리 (123_sv_admin.sql · 담당자 지시 2026-09-17)
//
// SV 명단(이름·직함·전화·이메일·사용)과 매장 담당 배정을 한 카드에서 고칩니다.
// 이름을 바꾸면 서버 함수 하나가 매장 담당·수신처 담당·명단을 같이 바꿉니다
// (123 설계 판단 [3]). 이미 있는 다른 이름으로는 못 바꿉니다 — 합치기는 매장
// 배정에서 옮기는 것으로 합니다.
//
// [모든 화면에 반영]
//   저장이 끝나면 svfilter.reloadSvFilter() 가 헤더 담당자 목록·판정 표를 다시
//   받고 mitaly:sv-changed 를 쏩니다(담당자 필터를 쓰는 화면은 이미 이것을
//   듣습니다). 담당 이름을 **자기 사본으로 들고 있는** 화면(방문·공지 대상·
//   수신처·전매장 현황·선택 매장·홈 SV 카드·가맹점 DB)은 따로
//   mitaly:sv-data-changed 를 듣고 다시 받습니다. 새 화면이 sv_name 을 캐시하면
//   거기에도 한 줄 더하세요.
//
// [배정 표는 전역 담당자 필터를 안 받습니다]
//   담당을 **옮기는** 표라, 헤더에서 한 SV 를 골라 둔 채로는 다른 SV 의 매장을
//   못 가져옵니다. 표에 data-sv-store-col="-1" 을 달아 svfilter 의 DOM 그물을
//   비켜 가고(행에 data-store 도 안 답니다), 카드 자체의 '현재 담당' 고르개로
//   좁힙니다.

import { int } from "./format.js";
import { escape } from "./util.js";
import { $ } from "./dom.js";
import { db } from "./client.js";
import { reloadSvFilter } from "./svfilter.js";

const UNASSIGNED = "미배정";
const STATE_LABEL = { operating: "운영", planned_open: "오픈 예정",
                      planned_close: "폐점 예정", closed: "폐점", unknown: "기록 없음" };

let svList = [];        // api_sv_admin().svs
let svStores = [];      // api_sv_admin().stores
let editingName = null; // 고치는 중인 SV 의 원래 이름 (null = 새로 만들기)
const picked = new Set();   // 배정 표에서 고른 store_id
let selfRefresh = false;    // 이 카드가 쏜 storedb-refresh 는 다시 받지 않습니다

async function loadSvAdmin() {
    const { data, error } = await db.rpc("api_sv_admin");
    if (error) {
        $("sva-list").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + "</p>";
        return false;
    }
    svList = Array.isArray(data?.svs) ? data.svs : [];
    svStores = Array.isArray(data?.stores) ? data.stores : [];
    const alive = new Set(svStores.map((s) => s.store_id));
    for (const id of [...picked]) if (!alive.has(id)) picked.delete(id);
    drawSvList();
    fillSvSelects();
    drawAssign();
    return true;
}

// ---- 명단 --------------------------------------------------------------

function drawSvList() {
    const unassigned = svStores.filter((s) => !s.sv_name).length;
    $("sva-summary").textContent = `SV ${int(svList.length)}명`
        + (unassigned ? ` · 미배정 매장 ${int(unassigned)}곳` : "");
    if (!svList.length) {
        $("sva-list").innerHTML = '<p class="hint">SV 가 없습니다.</p>';
        return;
    }
    const head = ["이름", "직함", "전화", "이메일", "담당 매장", "수신처", "상태", ""]
        .map((h, i) => `<th scope="col"${i > 0 && i !== 4 && i !== 5 ? ' class="tl"' : ""}>${escape(h)}</th>`)
        .join("");
    const body = svList.map((sv) => {
        const closed = sv.stores - sv.stores_open;
        return `<tr${sv.active ? "" : ' class="sva-off"'}>`
            + `<td>${escape(sv.name)}`
            + (sv.in_roster ? "" : ' <span class="tag">연락처 없음</span>')
            + "</td>"
            + `<td class="tl">${escape(sv.title || "—")}</td>`
            + `<td class="tl">${escape(sv.phone || "—")}</td>`
            + `<td class="tl">${escape(sv.email || "—")}</td>`
            + `<td>${int(sv.stores_open)}${closed ? ` <span class="meta">(+폐점 ${int(closed)})</span>` : ""}</td>`
            + `<td>${int(sv.recipients)}</td>`
            + `<td class="tl">${sv.active ? "사용" : "사용 안 함"}</td>`
            + `<td><button type="button" class="linkish" data-sva-edit="${escape(sv.name)}">고치기</button></td>`
            + "</tr>";
    }).join("");
    // 매장 표가 아닙니다 — 전역 담당자 필터의 DOM 그물이 짐작하지 않게 -1.
    $("sva-list").innerHTML =
        `<table data-sv-store-col="-1"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function fillForm(sv) {
    editingName = sv ? sv.name : null;
    $("sva-name").value = sv?.name || "";
    $("sva-title").value = sv?.title || "";
    $("sva-phone").value = sv?.phone || "";
    $("sva-email").value = sv?.email || "";
    $("sva-active").checked = sv ? !!sv.active : true;
    $("sva-save").textContent = sv ? "SV 저장" : "SV 추가";
    $("sva-notice").textContent = sv ? `${sv.name} 을(를) 고치는 중입니다.` : "";
    if (sv) $("sva-name").focus();
}

async function saveSv() {
    const notice = $("sva-notice");
    const name = $("sva-name").value.trim();
    const old = editingName;
    const sv = old ? svList.find((s) => s.name === old) : null;

    // 이름을 바꾸면 무엇이 같이 바뀌는지 먼저 보여 줍니다(123 설계 판단 [1]·[3]).
    if (sv && name && name !== old) {
        const lines = [`'${old}' → '${name}' 으로 바꿉니다.`];
        if (sv.stores) lines.push(`담당 매장 ${int(sv.stores)}곳의 담당 이름도 바뀝니다.`);
        if (sv.recipients) lines.push(`수신처 ${int(sv.recipients)}명의 담당 SV 도 바뀝니다.`);
        lines.push("그대로 저장할까요?");
        if (!window.confirm(lines.join("\n"))) return;
    }

    const button = $("sva-save");
    button.disabled = true;
    try {
        const { data, error } = await db.rpc("api_sv_save", {
            p_old_name: old,
            p_name: name,
            p_title: $("sva-title").value,
            p_phone: $("sva-phone").value,
            p_email: $("sva-email").value,
            p_active: $("sva-active").checked,
        });
        if (error || !data?.ok) {
            notice.textContent = "저장하지 못했습니다: " + (error?.message || data?.reason || "");
            return;
        }
        notice.textContent = data.renamed_from
            ? `저장했습니다 — ${data.renamed_from} → ${data.name}`
              + ` · 매장 ${int(data.stores)}곳 · 수신처 ${int(data.recipients)}건 변경`
            : `저장했습니다 — ${data.name}`;
        const message = notice.textContent;
        fillForm(null);
        notice.textContent = message;
        await afterChange({ renamedFrom: data.renamed_from, renamedTo: data.name });
    } finally {
        button.disabled = false;
    }
}

// ---- 매장 배정 ----------------------------------------------------------

function fillSvSelects() {
    const names = svList.map((s) => s.name);
    const filter = $("sva-f-sv");
    const cur = filter.value;
    filter.innerHTML = '<option value="">전체</option>'
        + names.map((n) => `<option value="${escape(n)}">${escape(n)}</option>`).join("")
        + `<option value="${UNASSIGNED}">${UNASSIGNED}</option>`;
    filter.value = [...filter.options].some((o) => o.value === cur) ? cur : "";

    const target = $("sva-target");
    const tcur = target.value;
    target.innerHTML = '<option value="">담당 SV 고르기</option>'
        + svList.filter((s) => s.active)
            .map((s) => `<option value="${escape(s.name)}">${escape(s.name)}</option>`).join("")
        + `<option value="${UNASSIGNED}">담당 비우기(미배정)</option>`;
    target.value = [...target.options].some((o) => o.value === tcur) ? tcur : "";
}

function assignRows() {
    const who = $("sva-f-sv").value;
    const q = $("sva-f-q").value.trim();
    const withClosed = $("sva-f-closed").checked;
    return svStores.filter((s) =>
        (!who || (who === UNASSIGNED ? !s.sv_name : s.sv_name === who))
        && (withClosed || s.state !== "closed")
        && (!q || s.store_name.includes(q)));
}

// 고른 수·배정 버튼·'전부 고르기' 체크만 맞춥니다 — 체크 하나마다 표를 다시
// 그리면 긴 목록의 스크롤 자리가 흔들립니다.
function drawPicked(rows = assignRows()) {
    const shownPicked = rows.filter((s) => picked.has(s.store_id)).length;
    $("sva-picked").textContent = picked.size
        ? `${int(picked.size)}곳 고름` + (picked.size !== shownPicked ? ` (이 목록 밖 ${int(picked.size - shownPicked)}곳)` : "")
        : "";
    $("sva-assign").disabled = !picked.size;
    const all = document.getElementById("sva-all");
    if (all) all.checked = rows.length > 0 && shownPicked === rows.length;
}

function drawAssign() {
    const rows = assignRows();
    drawPicked(rows);
    if (!rows.length) {
        $("sva-stores").innerHTML = '<p class="hint">조건에 맞는 매장이 없습니다.</p>';
        return;
    }
    const allOn = rows.every((s) => picked.has(s.store_id));
    const head = `<th scope="col"><input type="checkbox" id="sva-all" aria-label="이 목록 전부 고르기"${allOn ? " checked" : ""}></th>`
        + '<th scope="col" class="tl">매장</th><th scope="col" class="tl">담당 SV</th><th scope="col" class="tl">상태</th>';
    const body = rows.map((s) =>
        `<tr><td><input type="checkbox" data-sva-store="${s.store_id}"${picked.has(s.store_id) ? " checked" : ""}`
        + ` aria-label="${escape(s.store_name)}"></td>`
        + `<td class="tl">${escape(s.store_name)}</td>`
        + `<td class="tl">${s.sv_name ? escape(s.sv_name) : `<span class="meta">${UNASSIGNED}</span>`}</td>`
        + `<td class="tl">${s.state === "closed" ? '<span class="tag down">폐점</span>' : escape(STATE_LABEL[s.state] || s.state)}</td>`
        + "</tr>").join("");
    // 전역 담당자 필터를 비켜 갑니다(머리주석 '배정 표는…').
    $("sva-stores").innerHTML =
        `<table data-sv-store-col="-1"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

async function assignPicked() {
    const target = $("sva-target").value;
    const notice = $("sva-a-notice");
    if (!target) { notice.textContent = "담당 SV 를 골라 주세요."; return; }
    const ids = [...picked];
    const label = target === UNASSIGNED ? "담당을 비웁니다" : `${target} 에게 배정합니다`;
    if (!window.confirm(`${int(ids.length)}곳 — ${label}. 그대로 저장할까요?`)) return;

    const button = $("sva-assign");
    button.disabled = true;
    try {
        const { data, error } = await db.rpc("api_sv_assign",
            { p_store_ids: ids, p_sv_name: target });
        if (error || !data?.ok) {
            notice.textContent = "저장하지 못했습니다: " + (error?.message || data?.reason || "");
            return;
        }
        notice.textContent = `저장했습니다 — ${int(data.stores)}곳 · ${data.sv_name || UNASSIGNED}`;
        picked.clear();
        await afterChange({});
    } finally {
        button.disabled = !picked.size;
    }
}

// ---- 저장 뒤 — 이 카드 + 모든 화면 ---------------------------------------

async function afterChange({ renamedFrom = null, renamedTo = null }) {
    await loadSvAdmin();
    // 헤더 담당자 목록·판정 표 → mitaly:sv-changed (담당자 필터를 쓰는 화면 전부).
    await reloadSvFilter({ renamedFrom, renamedTo });
    selfRefresh = true;
    try {
        // 담당 이름 사본을 들고 있는 화면들(머리주석 '모든 화면에 반영').
        document.dispatchEvent(new CustomEvent("mitaly:sv-data-changed",
            { detail: { renamedFrom, renamedTo } }));
        // 가맹점 DB 표·정산 매장별 카드는 이 신호로 다시 받습니다(lifecycle.js 와 같은 길).
        window.dispatchEvent(new Event("mitaly:storedb-refresh"));
    } finally {
        selfRefresh = false;
    }
}

export async function initSvAdmin() {
    $("sva-save").addEventListener("click", saveSv);
    $("sva-new").addEventListener("click", () => fillForm(null));
    $("sva-list").addEventListener("click", (e) => {
        const b = e.target.closest("[data-sva-edit]");
        if (!b) return;
        const sv = svList.find((s) => s.name === b.dataset.svaEdit);
        if (sv) fillForm(sv);
    });

    for (const id of ["sva-f-sv", "sva-f-closed"]) $(id).addEventListener("change", drawAssign);
    $("sva-f-q").addEventListener("input", drawAssign);
    $("sva-stores").addEventListener("change", (e) => {
        if (e.target.id === "sva-all") {
            for (const s of assignRows()) {
                if (e.target.checked) picked.add(s.store_id); else picked.delete(s.store_id);
            }
            drawAssign();
            return;
        }
        const box = e.target.closest("[data-sva-store]");
        if (!box) return;
        const id = Number(box.dataset.svaStore);
        if (box.checked) picked.add(id); else picked.delete(id);
        drawPicked();
    });
    $("sva-assign").addEventListener("click", assignPicked);

    // 다른 화면(가맹점 DB 표의 한 줄 수정)이 담당을 바꿔도 이 카드가 따라갑니다.
    window.addEventListener("mitaly:storedb-refresh", () => { if (!selfRefresh) loadSvAdmin(); });
    document.addEventListener("mitaly:sv-data-changed", () => { if (!selfRefresh) loadSvAdmin(); });
    fillForm(null);
    await loadSvAdmin();
}
