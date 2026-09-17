// 가맹점 DB (9번 기반) — api_store_profiles(35) 표 + 인라인 수정 + 신규 등록.
// app.js 에서 뽑은 영역 모듈(docs/web-split-plan.md). db + foundation 만 import.
//
// 수정은 행 단위 인라인. RLS update 를 열지 않고 전용 함수(save_store_profile,
// 44 → 87 재정의 — updated_by 기록)로만 저장합니다. 근무인원·좌석수·
// 월임차료·특이사항은 KPI 엑셀 02 반입분(87 · 큐 #109)입니다.
//
// 분류·SV·지역·주문방식·포스는 자유 텍스트 대신 datalist(기존 값 후보 +
// 직접 입력 허용)입니다 — SV·지역 필터가 실값 distinct 로 만들어지므로
// '서울'/'서울시' 처럼 표기가 갈리면 필터가 쪼개집니다(큐 #104 진단 [B]).
// 폐점 상태는 api_store_lifecycle_status(27)를 조인해 배지·필터로 보여줍니다
// (진단 [F] — 기록이 없는 매장은 '운영' 으로 칩니다).

import { db, fetchStores, fetchAllStores, invalidateStores } from "./client.js";
import { int } from "./format.js";
import { escape, debounce } from "./util.js";
import { table, $ } from "./dom.js";
import { svFilterRows, reloadSvFilter } from "./svfilter.js";

const SDB_COLS = [
    ["category", "분류"],
    ["sv_name", "담당 SV"],
    ["region", "지역"],
    ["order_method", "주문방식"],
    ["pos", "포스"],
    ["business_start_date", "영업시작일"],
    // KPI 엑셀 02 반입분(87) — 근무인원은 3.5 같은 소수가 실값이라 number
    // 입력에 step 을 좁히지 않습니다. 월임차료는 VAT 별도 금액입니다.
    ["staff_count", "근무인원"],
    ["seat_count", "좌석수"],
    ["monthly_rent", "월임차료"],
    ["special_note", "특이사항"],
];
// datalist 후보를 채우는 텍스트 열(영업시작일·숫자 3열·특이사항 제외 —
// 특이사항은 자유 서술이라 후보 목록이 도움이 안 됩니다).
const SDB_TEXT_KEYS = ["category", "sv_name", "region", "order_method", "pos"];
// number 입력으로 편집하고 화면에는 천 단위로 그리는 열.
const SDB_NUM_KEYS = ["staff_count", "seat_count", "monthly_rent"];
let sdbRows = [];          // [{store_id, store_name, category, ... , has_profile}]
let sdbEditingId = null;   // 지금 편집 중인 store_id (한 번에 한 행만)
let sdbStatus = new Map(); // store_name → 'open' | 'close' (27 최근 이벤트)

export async function initStoreDb() {
    const ok = await loadStoreDbData();
    if (!ok) return;

    for (const id of ["sdb-region", "sdb-status"]) {
        $(id).addEventListener("change", drawStoreDb);
    }
    // 담당자는 헤더(sv-global) 하나뿐입니다 — 여기 있던 'sdb-sv' 는 헤더와
    // 값을 공유하지 않아 두 조건이 겹쳤습니다(2026-09-11 감사 · 카드 #168).
    document.addEventListener("mitaly:sv-changed", drawStoreDb);
    $("sdb-search").addEventListener("input", debounce(drawStoreDb, 150));
    $("sdb-n-submit").addEventListener("click", submitNewStore);
    // 오픈·폐점 화면에서 기록을 남기면 여기 폐점 배지·필터([F])가 낡습니다 —
    // 화면 간 import 없이 신호(custom event)로 다시 받습니다.
    window.addEventListener("mitaly:storedb-refresh", reloadStoreDb);
    drawStoreDb();
}

// 표 데이터 + 폐점 상태를 받아 sdbRows·sdbStatus·필터 후보를 맞춥니다.
// 처음(initStoreDb)과 등록·저장 후(reloadStoreDb) 둘 다 이 길을 씁니다 —
// 신규 값이 필터·datalist 에 바로 반영되게(진단 [H]).
async function loadStoreDbData() {
    const [profRes, storeRes, statusRes] = await Promise.all([
        db.rpc("api_store_profiles"),
        // 숨긴 매장(126)까지 받습니다 — 이 화면이 숨기기·복원을 하는 곳입니다.
        fetchAllStores(),
        db.rpc("api_store_lifecycle_status"),
    ]);
    if (profRes.error) {
        $("sdb-table").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(profRes.error.message) + "</p>";
        return false;
    }

    const byId = new Map();
    for (const p of (Array.isArray(profRes.data) ? profRes.data : [])) {
        byId.set(Number(p.store_id), { ...p, has_profile: true });
    }
    const hiddenAt = new Map((storeRes.data || []).map((s) => [Number(s.id), s.hidden_at || null]));
    for (const s of storeRes.data || []) {
        if (!byId.has(Number(s.id))) {
            byId.set(Number(s.id), {
                store_id: Number(s.id), store_name: s.name, has_profile: false,
                category: null, sv_name: null, region: null,
                order_method: null, pos: null, business_start_date: null,
                staff_count: null, seat_count: null, monthly_rent: null,
                special_note: null,
            });
        }
    }
    for (const r of byId.values()) r.hidden_at = hiddenAt.get(Number(r.store_id)) || null;
    sdbRows = [...byId.values()].sort((a, b) =>
        a.store_name.localeCompare(b.store_name, "ko"));

    // 폐점 상태(진단 [F]). 못 받아도 표는 그려져야 하므로 오류는 접습니다 —
    // 그 경우 전부 '운영' 으로 보입니다.
    if (!statusRes.error && Array.isArray(statusRes.data)) {
        sdbStatus = new Map(statusRes.data.map((v) => [v.store_name, v.status]));
    }

    refreshOptions();
    return true;
}

// SV·지역 필터와 datalist 후보를 지금 표에 있는 값으로 다시 만듭니다.
function refreshOptions() {
    fillDistinct($("sdb-region"), sdbRows.map((r) => r.region));
    for (const key of SDB_TEXT_KEYS) {
        fillDatalist($("sdb-dl-" + key), sdbRows.map((r) => r[key]));
    }
}

// SV·지역 필터는 실제 들어 있는 값으로만 만듭니다(빈 목록이면 그냥 '전체').
// 다시 부를 수 있게 기존 옵션을 지우고 다시 채웁니다 — 고른 값이 아직
// 있으면 유지합니다(진단 [H] — 등록·수정 후 새 값 반영).
function fillDistinct(select, values) {
    const current = select.value;
    const seen = [...new Set(values.filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, "ko"));
    while (select.options.length > 1) select.remove(1);
    for (const v of seen) {
        const opt = document.createElement("option");
        opt.value = v;
        opt.textContent = v;
        select.append(opt);
    }
    select.value = seen.includes(current) ? current : "";
}

function fillDatalist(datalist, values) {
    const seen = [...new Set(values.filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, "ko"));
    datalist.innerHTML = "";
    for (const v of seen) {
        const opt = document.createElement("option");
        opt.value = v;
        datalist.append(opt);
    }
}

function sdbClosed(r) {
    return sdbStatus.get(r.store_name) === "close";
}

function sdbFiltered() {
    const region = $("sdb-region").value;
    const status = $("sdb-status").value;
    const search = $("sdb-search").value.trim();
    // 담당자 조건이 먼저 — 이 배열을 세는 곳이 아래 건수·표입니다.
    // 숨긴 매장(126)은 '숨긴 매장' 을 고를 때만 — 다른 상태에서는 빠집니다.
    return svFilterRows(sdbRows, (r) => r.store_name, { withHidden: true }).filter((r) =>
        (status === "hidden" ? !!r.hidden_at : !r.hidden_at)
        && (!region || r.region === region)
        && (!status || status === "hidden" || (status === "closed") === sdbClosed(r))
        && (!search || r.store_name.includes(search)));
}

function drawStoreDb() {
    sdbEditingId = null;                       // 필터가 바뀌면 편집 행은 접습니다
    sdbRender();
}

// 저장·등록 알림. 성공 알림은 잠시 뒤 스스로 사라집니다 — 화면을 옮겨 다녀도
// '저장했습니다' 가 계속 남아 있었습니다(진단 [I]). 오류는 사용자가 지우기
// 전까지(다음 동작 전까지) 남습니다.
function sdbNotice(el, text, isError) {
    el.hidden = false;
    el.className = isError ? "notice error" : "notice";
    el.textContent = text;
    clearTimeout(el._hideTimer);
    if (!isError) {
        el._hideTimer = setTimeout(() => { el.hidden = true; }, 6000);
    }
}

function sdbEditRow(r) {
    const inputs = SDB_COLS.map(([key]) => {
        if (key === "business_start_date") {
            return `<td><input type="date" data-key="${key}"
                value="${escape(r[key] || "")}"></td>`;
        }
        if (SDB_NUM_KEYS.includes(key)) {
            // 근무인원은 소수 실값(3.5)이 있어 step="any"(step 기본 1이면
            // 브라우저가 소수 입력을 유효성 오류로 막습니다).
            const val = r[key] === null || r[key] === undefined ? "" : r[key];
            return `<td><input type="number" data-key="${key}" step="any"
                min="0" value="${escape(String(val))}"></td>`;
        }
        const list = SDB_TEXT_KEYS.includes(key) ? ` list="sdb-dl-${key}"` : "";
        return `<td><input type="text" data-key="${key}" autocomplete="off"${list}
            value="${escape(r[key] || "")}"></td>`;
    }).join("");
    // 매장 이름도 여기서 고칩니다(125). 저장하면 옛 이름은 수집 별칭으로 남습니다.
    return `<tr data-id="${r.store_id}" class="sdb-editing">`
        + `<td><input type="text" data-name autocomplete="off" aria-label="매장 이름"
            value="${escape(r.store_name)}"></td>${inputs}`
        + `<td><button type="button" class="primary" id="sdb-save">저장</button> `
        + `<button type="button" class="linkish" id="sdb-cancel">취소</button></td></tr>`;
}

// 표 한 벌을 그립니다. sdbEditingId 가 가리키는 행만 입력칸으로 바뀝니다.
function sdbRender() {
    const list = sdbFiltered();
    const shown = sdbRows.filter((r) => !r.hidden_at);
    const hidden = sdbRows.length - shown.length;
    const missing = shown.filter((r) => !r.has_profile).length;
    const closed = shown.filter(sdbClosed).length;
    $("sdb-summary").textContent =
        `${int(list.length)}곳 표시 · 전체 ${int(shown.length)}곳`
        + (closed ? ` · 폐점 ${int(closed)}곳` : "")
        + (hidden ? ` · 숨김 ${int(hidden)}곳` : "")
        + (missing ? ` · 프로필 없는 매장 ${int(missing)}곳` : "");

    if (!list.length) {
        $("sdb-table").innerHTML = '<p class="hint">조건에 맞는 매장이 없습니다.</p>';
        return;
    }

    const head = ["매장", ...SDB_COLS.map(([, label]) => label), ""]
        .map((h) => `<th scope="col">${escape(h)}</th>`).join("");
    const body = list.map((r) => {
        if (r.store_id === sdbEditingId) return sdbEditRow(r);
        const cells = SDB_COLS.map(([key]) => {
            const v = r[key];
            if (v === null || v === undefined || v === "") return "<td>—</td>";
            // 숫자 열은 천 단위로(월임차료). toLocaleString 은 3.5 같은
            // 근무인원 소수도 그대로 살립니다.
            return `<td>${SDB_NUM_KEYS.includes(key) ? int(v) : escape(v)}</td>`;
        }).join("");
        return `<tr data-id="${r.store_id}"><td>${escape(r.store_name)}`
            + (sdbClosed(r) ? ' <span class="tag down">폐점</span>' : "")
            + (r.hidden_at ? ' <span class="tag">숨김</span>' : "")
            + (r.has_profile ? "" : ' <span class="tag">프로필 없음</span>')
            + `</td>${cells}`
            + `<td><button type="button" class="linkish sdb-edit" data-id="${r.store_id}">수정</button>`
            + ` <button type="button" class="linkish sdb-hide" data-id="${r.store_id}">`
            + `${r.hidden_at ? "복원" : "숨기기"}</button></td></tr>`;
    }).join("");

    $("sdb-table").innerHTML =
        `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;

    for (const b of $("sdb-table").querySelectorAll(".sdb-hide")) {
        b.addEventListener("click", () => sdbToggleHidden(Number(b.dataset.id)));
    }
    for (const b of $("sdb-table").querySelectorAll(".sdb-edit")) {
        b.addEventListener("click", () => sdbStartEdit(Number(b.dataset.id)));
    }
    if (sdbEditingId !== null) {
        $("sdb-save").addEventListener("click", () => sdbSave(sdbEditingId));
        $("sdb-cancel").addEventListener("click", () => { sdbEditingId = null; sdbRender(); });
        $("sdb-table").querySelector(".sdb-editing input")?.focus();
    }
}

function sdbStartEdit(storeId) {
    sdbEditingId = storeId;
    sdbRender();
}

async function sdbSave(storeId) {
    const notice = $("sdb-notice");
    const row = $("sdb-table").querySelector(`tr[data-id="${storeId}"]`);
    const values = {};
    const nameInput = row.querySelector("input[data-name]");
    const local = sdbRows.find((r) => r.store_id === storeId);
    const oldName = local.store_name;
    const newName = (nameInput?.value || "").replace(/\s+/g, " ").trim();
    if (!newName) {
        sdbNotice(notice, "매장 이름을 넣어 주세요.", true);
        return;
    }
    const renaming = newName !== oldName;
    if (renaming && !window.confirm(
        `'${oldName}' → '${newName}' 으로 매장 이름을 바꿉니다.\n`
        + "모든 화면에 새 이름으로 보이고, 계정표·POS 에 남은 옛 이름으로 들어오는 매출·리뷰도 이 매장으로 모입니다.\n"
        + "그대로 저장할까요?")) return;

    for (const input of row.querySelectorAll("input[data-key]")) {
        const key = input.dataset.key;
        const text = input.value.trim();
        // 숫자 열은 숫자로 접어 보냅니다 — 못 읽는 값(브라우저가 대부분
        // 걸러 주지만)은 null 로. 빈 칸 = 지움(null)은 텍스트 열과 같습니다.
        values[key] = !text ? null
            : (SDB_NUM_KEYS.includes(key)
                ? (Number.isFinite(Number(text)) ? Number(text) : null)
                : text);
    }

    $("sdb-save").disabled = true;
    // 이름 먼저 — 겹치는 이름이면 여기서 멈추고 프로필은 안 건드립니다.
    if (renaming) {
        const res = await db.rpc("api_store_rename", { p_store_id: storeId, p_name: newName });
        if (res.error || !res.data?.ok) {
            $("sdb-save").disabled = false;
            sdbNotice(notice, "이름을 바꾸지 못했습니다: "
                + (res.error ? res.error.message : (res.data?.reason || "알 수 없는 이유")), true);
            return;
        }
        applyStoreRename(storeId, oldName, res.data.name);
    }
    const { data, error } = await db.rpc("save_store_profile", {
        p_store_id: storeId,
        p_category: values.category,
        p_sv_name: values.sv_name,
        p_region: values.region,
        p_order_method: values.order_method,
        p_pos: values.pos,
        p_business_start_date: values.business_start_date,
        p_staff_count: values.staff_count,
        p_seat_count: values.seat_count,
        p_monthly_rent: values.monthly_rent,
        p_special_note: values.special_note,
    });

    if (error || !data?.ok) {
        $("sdb-save").disabled = false;
        sdbNotice(notice, "저장하지 못했습니다: "
            + (error ? error.message : (data?.reason || "알 수 없는 이유")), true);
        return;
    }

    const svChanged = (local.sv_name || null) !== (values.sv_name || null);
    Object.assign(local, values, { has_profile: true });
    sdbEditingId = null;
    sdbNotice(notice, `${data.store_name} 저장했습니다.`
        + (renaming ? ` (옛 이름 ${oldName})` : ""));
    refreshOptions();          // 새 SV·지역 값이 필터·후보에 바로 잡히게 ([H])
    sdbRender();
    if (renaming) {
        await broadcastStoreRename(storeId, oldName, local.store_name);
    } else if (svChanged) {
        // 담당이 바뀌면 헤더 담당자 필터와 담당 이름 사본을 든 화면들이 낡습니다 —
        // SV 관리(sv_admin.js)와 같은 두 신호를 보냅니다.
        await reloadSvFilter();
        document.dispatchEvent(new CustomEvent("mitaly:sv-data-changed", { detail: {} }));
    }
}

// ---- 매장 숨기기·복원 (126) -------------------------------------------------
//
// 행을 지우지 않고 목록에서만 뺍니다(126 설계 판단 [1]). 숨기면 웹의 매장 목록·
// 선택기·매장 표에서 빠지고(전역 필터가 거릅니다), 과거 매출은 전사 합계에 남습니다.
async function sdbToggleHidden(storeId) {
    const notice = $("sdb-notice");
    const r = sdbRows.find((x) => x.store_id === storeId);
    if (!r) return;
    const hide = !r.hidden_at;
    const question = hide
        ? `'${r.store_name}' 을(를) 매장 목록에서 숨깁니다.\n`
          + "모든 화면의 매장 목록·선택기·매장 표에서 빠집니다. 과거 매출은 전사 합계에 남고, "
          + "'상태: 숨긴 매장' 에서 복원할 수 있습니다.\n숨길까요?"
        : `'${r.store_name}' 을(를) 다시 매장 목록에 보이게 합니다. 복원할까요?`;
    if (!window.confirm(question)) return;

    const { data, error } = await db.rpc("api_store_hide", { p_store_id: storeId, p_hidden: hide });
    if (error || !data?.ok) {
        sdbNotice(notice, (hide ? "숨기지" : "복원하지") + " 못했습니다: "
            + (error ? error.message : (data?.reason || "알 수 없는 이유")), true);
        return;
    }
    sdbNotice(notice, `${data.name} — ${hide ? "숨겼습니다" : "복원했습니다"}.`);
    if (sdbEditingId === storeId) sdbEditingId = null;
    invalidateStores();
    // 전역 필터가 숨긴 매장 목록을 다시 받아 모든 선택기·표에 거릅니다 → sv-changed.
    await reloadSvFilter();
    document.dispatchEvent(new CustomEvent("mitaly:stores-hidden-changed",
        { detail: { storeId, name: data.name, hidden: hide } }));
    document.dispatchEvent(new CustomEvent("mitaly:sv-data-changed", { detail: {} }));
    window.dispatchEvent(new Event("mitaly:storedb-refresh"));
}

// ---- 매장 이름 변경을 이 화면 + 모든 화면에 (125) --------------------------
//
// 이 화면의 표·상태 사본을 새 이름으로 옮깁니다(서버 재조회 전 즉시 반영).
function applyStoreRename(storeId, oldName, newName) {
    const local = sdbRows.find((r) => r.store_id === storeId);
    if (local) local.store_name = newName;
    if (sdbStatus.has(oldName)) {
        sdbStatus.set(newName, sdbStatus.get(oldName));
        sdbStatus.delete(oldName);
    }
    sdbRows.sort((a, b) => a.store_name.localeCompare(b.store_name, "ko"));
}

// 다른 화면들은 부팅 때 매장 목록(fetchStores)으로 선택기를 채우고, 일부는 이름을
// 값으로 씁니다(방문 기록 등). 그래서 ① 캐시를 비우고 ② 이미 그려진 선택기의
// 옵션 글자·값을 새 이름으로 바꾸고(꼬리 ' (폐점)'·' — 폐점' 유지) ③ 헤더 필터·
// 담당 사본·가맹점 DB 신호를 쏘고 ④ mitaly:store-renamed 로 이름을 들고 있는
// 화면이 다시 조회하게 합니다. 표는 각 화면이 다시 조회할 때 서버의 새 이름으로 그려집니다.
async function broadcastStoreRename(storeId, oldName, newName) {
    // 화면들이 들고 있는 매장 배열(방문·정산 등)은 fetchStores 캐시의 **같은 객체**
    // 입니다 — 캐시를 비우기 전에 그 객체의 이름을 바꾸면 그 화면들이 선택기를
    // 다시 그릴 때도 새 이름이 나옵니다(비우기만 하면 옛 배열로 다시 그립니다).
    try {
        const { data } = await fetchStores();
        for (const s of data || []) if (s.id === storeId) s.name = newName;
    } catch (e) { /* 캐시가 없으면 바꿀 사본도 없습니다 */ }
    invalidateStores();
    for (const option of document.querySelectorAll("option")) {
        const text = option.textContent;
        if (text === oldName || text.startsWith(oldName + " (") || text.startsWith(oldName + " — ")) {
            option.textContent = newName + text.slice(oldName.length);
        }
        if (option.value === oldName) option.value = newName;
    }
    await reloadSvFilter();
    document.dispatchEvent(new CustomEvent("mitaly:store-renamed",
        { detail: { storeId, oldName, newName } }));
    document.dispatchEvent(new CustomEvent("mitaly:sv-data-changed", { detail: {} }));
    window.dispatchEvent(new Event("mitaly:storedb-refresh"));
}

// 신규 매장 등록 — 매출 이력 0인 매장을 stores+프로필로 미리 만듭니다(44).
// 영업시작일을 넣으면 서버(register_store, 79)가 오픈 이벤트도 같이 남깁니다.
async function submitNewStore() {
    const notice = $("sdb-n-notice");
    const name = $("sdb-n-name").value.trim();
    if (!name) {
        sdbNotice(notice, "가맹점명은 꼭 넣어 주세요.", true);
        return;
    }

    $("sdb-n-submit").disabled = true;
    sdbNotice(notice, "등록하는 중…");

    const startDate = $("sdb-n-start").value || null;
    const { data, error } = await db.rpc("register_store", {
        p_name: name,
        p_category: $("sdb-n-category").value.trim() || null,
        p_sv_name: $("sdb-n-sv").value.trim() || null,
        p_region: $("sdb-n-region").value.trim() || null,
        p_order_method: $("sdb-n-order").value.trim() || null,
        p_pos: $("sdb-n-pos").value.trim() || null,
        p_business_start_date: startDate,
    });

    $("sdb-n-submit").disabled = false;
    if (error || !data?.ok) {
        sdbNotice(notice, "등록하지 못했습니다: "
            + (error ? error.message : (data?.reason || "알 수 없는 이유")), true);
        return;
    }

    sdbNotice(notice, `${data.store_name} 등록했습니다.`);
    if (startDate) {
        // 오픈·폐점 화면의 이력·요약이 낡습니다(79 가 오픈 이벤트를 만듦) —
        // 갱신 신호를 보냅니다(lifecycle.js 가 듣습니다).
        window.dispatchEvent(new Event("mitaly:lifecycle-refresh"));
    }
    for (const id of ["sdb-n-name", "sdb-n-category", "sdb-n-sv", "sdb-n-region",
                       "sdb-n-order", "sdb-n-pos", "sdb-n-start"]) {
        $(id).value = "";
    }
    // 서버가 정리한 값(트림·중복 검사)과 어긋나지 않게 처음부터 다시 받습니다.
    await reloadStoreDb();
}

// 등록 직후 서버 상태로 표를 다시 맞춥니다. 이벤트 리스너는 이미 걸려
// 있으므로 데이터만 다시 받습니다(필터·datalist 후보도 같이 — [H]).
async function reloadStoreDb() {
    const ok = await loadStoreDbData();
    if (ok) drawStoreDb();
}
