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

import { db } from "./client.js";
import { int } from "./format.js";
import { escape, debounce } from "./util.js";
import { table, $ } from "./dom.js";

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

    for (const id of ["sdb-sv", "sdb-region", "sdb-status"]) {
        $(id).addEventListener("change", drawStoreDb);
    }
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
        db.from("stores").select("id,name").order("name"),
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
    fillDistinct($("sdb-sv"), sdbRows.map((r) => r.sv_name));
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
    const sv = $("sdb-sv").value;
    const region = $("sdb-region").value;
    const status = $("sdb-status").value;
    const search = $("sdb-search").value.trim();
    return sdbRows.filter((r) =>
        (!sv || r.sv_name === sv)
        && (!region || r.region === region)
        && (!status || (status === "closed") === sdbClosed(r))
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
    return `<tr data-id="${r.store_id}" class="sdb-editing">`
        + `<td>${escape(r.store_name)}</td>${inputs}`
        + `<td><button type="button" class="primary" id="sdb-save">저장</button> `
        + `<button type="button" class="linkish" id="sdb-cancel">취소</button></td></tr>`;
}

// 표 한 벌을 그립니다. sdbEditingId 가 가리키는 행만 입력칸으로 바뀝니다.
function sdbRender() {
    const list = sdbFiltered();
    const missing = sdbRows.filter((r) => !r.has_profile).length;
    const closed = sdbRows.filter(sdbClosed).length;
    $("sdb-summary").textContent =
        `${int(list.length)}곳 표시 · 전체 ${int(sdbRows.length)}곳`
        + (closed ? ` · 폐점 ${int(closed)}곳` : "")
        + (missing ? ` · 프로필 없는 매장 ${int(missing)}곳` : "");

    if (!list.length) {
        $("sdb-table").innerHTML = '<p class="hint">조건에 맞는 매장이 없습니다.</p>';
        return;
    }

    const head = ["매장", ...SDB_COLS.map(([, label]) => label), ""]
        .map((h) => `<th>${escape(h)}</th>`).join("");
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
            + (r.has_profile ? "" : ' <span class="tag">프로필 없음</span>')
            + `</td>${cells}`
            + `<td><button type="button" class="linkish sdb-edit" data-id="${r.store_id}">수정</button></td></tr>`;
    }).join("");

    $("sdb-table").innerHTML =
        `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;

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
    for (const input of row.querySelectorAll("input")) {
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

    const local = sdbRows.find((r) => r.store_id === storeId);
    Object.assign(local, values, { has_profile: true });
    sdbEditingId = null;
    sdbNotice(notice, `${data.store_name} 저장했습니다.`);
    refreshOptions();          // 새 SV·지역 값이 필터·후보에 바로 잡히게 ([H])
    sdbRender();
}

// 신규 매장 등록 — 매출 이력 0인 매장을 stores+프로필로 미리 만듭니다(44).
// 영업시작일을 넣으면 서버(register_store, 79)가 오픈 이벤트도 같이 남깁니다.
async function submitNewStore() {
    const notice = $("sdb-n-notice");
    const name = $("sdb-n-name").value.trim();
    if (!name) {
        sdbNotice(notice, "가맹점명은 필수입니다.", true);
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

    sdbNotice(notice, `${data.store_name} 등록했습니다. 매출이 올라오면 이 이름으로 이어집니다.`
        + (startDate ? " 오픈 이력에도 기록했습니다." : ""));
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
