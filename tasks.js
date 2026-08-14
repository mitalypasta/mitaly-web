// 업무 (11번 영역, 30_tasks.sql) — app.js 에서 뽑아낸 shell 분리 조각
// (docs/web-split-plan.md). 위반·공지·POS 새로 그리기를 부르고, 그쪽도
// 이쪽 요약을 부릅니다 — 전부 런타임 호출이라 순환 import 로 동작합니다.

import { int } from "./format.js";
import { escape, clip } from "./util.js";
import { $, table } from "./dom.js";
import { db } from "./client.js";
import { refreshViolations } from "./notices.js";
import { refreshAnnouncements } from "./comms.js";
import { refreshPosMenu, refreshPosMenuSummary, refreshPosMenuRequests } from "./pos.js";

// ================================================================ 업무 (11번 영역)
//
// 30_tasks.sql 위의 화면입니다. 매출 축과 그레인이 달라(접수 건 단위) 위쪽
// 기간·매장 필터를 따르지 않습니다 — initVisits·initLifecycle 과 같은 이유로
// load() 묶음에 넣지 않고 한 번만 받은 뒤, 무언가를 바꿨을 때만 다시 받습니다.
//
// [상태를 왜 함수로만 옮기는가]
//   advance_task() 가 유일한 통로입니다(30_tasks 설계 판단 [3]). 화면에서
//   tasks 를 직접 update 하면 이력 없이 상태만 바뀐 행이 생깁니다 — 이 축의
//   존재 이유가 이력이라 그 구멍을 만들지 않습니다.
//
// [승인 강제(D18)를 화면이 흉내내지 않습니다]
//   '완료' 를 눌러 거절당하면 그 사유를 그대로 보여줍니다. 화면이 미리 막으면
//   규칙이 두 군데(SQL·JS)에 생기고, 본사가 task_kinds 를 고쳐도 화면은
//   옛 규칙으로 막습니다. 판정은 한 곳에서만 합니다.

export const TASK_STATUS_LABEL = {
    received: "접수",
    in_progress: "처리 중",
    waiting_approval: "승인 대기",
    escalated: "이관",
    done: "완료",
    rejected: "반려",
};

export const TASK_SOURCE_LABEL = {
    web: "웹", kakao: "카카오", phone: "전화", sms: "문자", auto: "자동",
    kakao_chatbot: "카카오 챗봇",   // 62_kakao_intake 가 만드는 접수
};

let taskKinds = [];        // task_kinds 표. 종류 select 와 승인 필요 여부에 씁니다.
let taskPreauths = [];     // task_preauthorizations 표(철회된 것 포함 — 표에 같이 보입니다).
let taskRows = [];         // 마지막으로 받은 목록. 필터는 이것만 다시 그립니다.
const taskStoresByName = new Map();   // 매장 이름 → id (매장 지정 datalist 의 짝)

// 어느 버튼을 보여줄지. '승인 요청' 은 승인이 필요한 종류에서만 뜻이 있습니다.
function taskActions(status, needsApproval) {
    switch (status) {
        case "received":
            return [["in_progress", "처리 시작"], ["escalated", "이관"], ["rejected", "반려"]];
        case "in_progress":
            return [
                ...(needsApproval ? [["waiting_approval", "승인 요청"]] : []),
                ["done", "완료"], ["escalated", "이관"], ["rejected", "반려"]];
        case "waiting_approval":
            return [["done", "승인·완료"], ["rejected", "반려"]];
        case "escalated":
            return [["in_progress", "처리 시작"], ["done", "완료"], ["rejected", "반려"]];
        default:
            return [];   // done · rejected 는 끝난 업무입니다
    }
}

function taskNeedsApproval(kind) {
    return !!taskKinds.find((k) => k.kind === kind)?.needs_approval;
}

// 이 업무에 댈 수 있는 살아 있는 고지. 종류를 콕 집은 고지를 먼저 봅니다
// (종류 무관 고지보다 좁아서 근거로 더 정확합니다).
function applicablePreauth(kind) {
    const alive = taskPreauths.filter((p) => !p.revoked_at);
    return alive.find((p) => p.kind === kind) || alive.find((p) => !p.kind) || null;
}

export async function initTasks() {
    const { data: kinds } = await db.from("task_kinds").select("kind,name,needs_approval,enabled");
    taskKinds = (kinds || []).filter((k) => k.enabled !== false);
    for (const k of taskKinds) {
        const opt = document.createElement("option");
        opt.value = k.kind;
        opt.textContent = k.needs_approval ? `${k.name} (승인 필요)` : k.name;
        $("tk-kind").append(opt);

        const paOpt = document.createElement("option");
        paOpt.value = k.kind;
        paOpt.textContent = k.name;
        $("pa-kind").append(paOpt);
    }

    const { data: stores } = await db.from("stores").select("id,name").order("name");
    for (const s of stores || []) {
        const opt = document.createElement("option");
        opt.value = s.id;
        opt.textContent = s.name;
        $("tk-store").append(opt);

        const filterOpt = document.createElement("option");
        filterOpt.value = s.name;      // api_tasks 의 p_store 는 매장 이름입니다
        filterOpt.textContent = s.name;
        $("tk-filter-store").append(filterOpt);

        // 매장 지정 패널의 검색 입력 (datalist — 치는 대로 좁혀집니다)
        taskStoresByName.set(s.name, s.id);
        const dlOpt = document.createElement("option");
        dlOpt.value = s.name;
        $("task-store-options").append(dlOpt);
    }

    $("tk-submit").addEventListener("click", submitTask);
    $("pa-submit").addEventListener("click", submitPreauth);
    $("task-store-save").addEventListener("click", saveTaskStore);
    $("task-store-input").addEventListener("keydown", (event) => {
        if (event.key === "Enter") saveTaskStore();
    });
    // 상태·매장은 서버에서 걸러야 하고(200건 상한 안쪽으로 좁히려고),
    // '미처리만' 은 이미 받아 둔 것을 다시 그리기만 합니다.
    $("tk-filter-status").addEventListener("change", refreshTaskList);
    $("tk-filter-store").addEventListener("change", refreshTaskList);
    $("tk-filter-overdue").addEventListener("change", drawTaskList);
    initTaskActions();
    initPreauthActions();

    await Promise.all([refreshTasksSummary(), refreshTaskList(), refreshPreauths()]);
}

export async function refreshTasksSummary() {
    const { data, error } = await db.rpc("api_tasks_summary");
    if (error) {
        $("tasks-summary-meta").textContent = "불러오지 못했습니다: " + error.message;
        return;
    }
    const by = data.by_status || {};
    $("tk-overdue").textContent = int(data.overdue);
    $("tk-overdue-sub").textContent = `접수 후 ${int(data.overdue_days)}일이 지나도록 끝나지 않은 건`;
    $("tk-received").textContent = int(by.received);
    $("tk-in-progress").textContent = int(by.in_progress);
    $("tk-waiting").textContent = int(by.waiting_approval);
    $("tk-escalated").textContent = int(by.escalated);
    $("tasks-summary-meta").textContent =
        `미처리 기준 ${int(data.overdue_days)}일 — 본사가 정합니다`;

    // 홈 '오늘 할 일' 타일. 같은 숫자를 두 번 묻지 않으려고 여기서 같이 채웁니다.
    const homeTasks = $("home-tasks");
    if (homeTasks) {
        homeTasks.textContent = int(data.overdue);
        $("home-tasks-sub").textContent =
            `접수 후 ${int(data.overdue_days)}일이 지난 건 (전체 기간)`;
    }
}

export async function refreshTaskList() {
    const status = $("tk-filter-status").value;
    const store = $("tk-filter-store").value;
    const { data, error } = await db.rpc("api_tasks", {
        // 'open'(진행 중)은 한 상태가 아니라 묶음이라 서버에 넘기지 않고
        // 아래에서 걸러냅니다. api_tasks 는 상태 하나만 받습니다.
        p_status: status && status !== "open" ? status : null,
        p_store: store || null,
        p_limit: 200,
    });
    if (error) {
        taskRows = [];
        $("t-tasks").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + '</p>';
        return;
    }
    taskRows = Array.isArray(data) ? data : [];
    drawTaskList();
}

function drawTaskList() {
    const openOnly = $("tk-filter-status").value === "open";
    const overdueOnly = $("tk-filter-overdue").checked;
    const rows = taskRows.filter((t) =>
        (!openOnly || !["done", "rejected"].includes(t.status)) &&
        (!overdueOnly || t.overdue));

    $("task-list-summary").textContent = `${int(rows.length)}건`;
    $("tk-shown").textContent = rows.length === taskRows.length
        ? "" : `전체 ${int(taskRows.length)}건 중 ${int(rows.length)}건`;

    if (!rows.length) {
        $("t-tasks").innerHTML =
            '<p class="hint">해당하는 업무가 없습니다. 위 폼에서 접수하면 여기 나타납니다.</p>';
        return;
    }

    table($("t-tasks"),
        ["상태", "종류", "제목", "매장", "담당자", "접수", "경과", "처리"],
        rows.map((t) => [
            taskStatusTag(t.status),
            escape(t.kind_name || t.kind),
            escape(t.title) + (t.body ? `<div class="meta">${escape(clip(t.body, 60))}</div>` : ""),
            escape(t.store_name || "—"),
            escape(t.assigned_to || "—"),
            `${escape(String(t.created_at).slice(0, 10))}`
                + `<div class="meta">${escape(TASK_SOURCE_LABEL[t.source] || t.source)}</div>`,
            t.overdue
                ? `<span class="tag warn">미처리 ${int(t.age_days)}일</span>`
                : `${int(t.age_days)}일`,
            taskActionButtons(t),
        ]),
        { html: true });
}

export function taskStatusTag(status) {
    const label = escape(TASK_STATUS_LABEL[status] || status);
    if (status === "done") return `<span class="tag up">${label}</span>`;
    if (status === "waiting_approval" || status === "escalated") {
        return `<span class="tag h-warn">${label}</span>`;
    }
    return `<span class="tag">${label}</span>`;
}

function taskActionButtons(t) {
    const needsApproval = taskNeedsApproval(t.kind);
    const buttons = taskActions(t.status, needsApproval).map(([to, label]) =>
        `<button class="ghost" data-act="task-advance" data-task-id="${t.task_id}"`
        + ` data-to="${to}">${escape(label)}</button>`);

    // D35 — 승인이 필요한 건을 살아 있는 고지로 바로 완료. 승인 대기 상태는
    // 이미 '승인·완료' 가 있으므로 그때는 붙이지 않습니다.
    if (needsApproval && !["done", "rejected", "waiting_approval"].includes(t.status)) {
        const preauth = applicablePreauth(t.kind);
        if (preauth) {
            buttons.push(
                `<button class="ghost" data-act="task-advance" data-task-id="${t.task_id}"`
                + ` data-to="done" data-preauth-id="${preauth.id}">고지로 완료</button>`);
        }
    }

    // 카카오 접수 건은 매장을 여기서 답니다 (68 — 지정하면 매핑이 학습돼
    // 같은 사용자의 다음 접수부터 자동으로 붙습니다).
    if (t.source === "kakao_chatbot") {
        buttons.push(`<button class="ghost" data-act="task-store" data-task-id="${t.task_id}"`
            + ` data-task-title="${escape(t.title)}">${t.store_name ? "매장 변경" : "매장 지정"}</button>`);
    }

    buttons.push(`<button class="ghost" data-act="task-events" data-task-id="${t.task_id}"`
        + ` data-task-title="${escape(t.title)}">이력</button>`);
    return buttons.join(" ");
}

// 목록은 매번 새로 그려지므로 컨테이너에 한 번만 위임합니다
// (initViolationResolve·initDrafts 와 같은 패턴).
function initTaskActions() {
    $("t-tasks").addEventListener("click", async (event) => {
        const historyButton = event.target.closest("button[data-act='task-events']");
        if (historyButton) {
            await showTaskEvents(Number(historyButton.dataset.taskId),
                historyButton.dataset.taskTitle);
            return;
        }

        const storeButton = event.target.closest("button[data-act='task-store']");
        if (storeButton) {
            openTaskStorePanel(Number(storeButton.dataset.taskId),
                storeButton.dataset.taskTitle);
            return;
        }

        const button = event.target.closest("button[data-act='task-advance']");
        if (!button) return;

        const taskId = Number(button.dataset.taskId);
        const to = button.dataset.to;
        const preauthId = button.dataset.preauthId ? Number(button.dataset.preauthId) : null;
        // 전이 뒤 어느 화면을 같이 갱신할지 판단하려고 종류를 기억해 둡니다.
        const moved = taskRows.find((t) => t.task_id === taskId);

        // 이관·반려는 사유가 곧 다음 사람이 읽을 내용이라 받아 둡니다.
        let note = null;
        if (to === "escalated") {
            note = window.prompt("누구에게 왜 넘기는지 적어 주세요. 이력에 남습니다.", "");
            if (note === null) return;
        } else if (to === "rejected") {
            note = window.prompt("반려 사유를 적어 주세요. 이력에 남습니다.", "");
            if (note === null) return;
        }

        if (preauthId) {
            const preauth = taskPreauths.find((p) => p.id === preauthId);
            const ok = window.confirm(
                `사전 고지 「${preauth?.scope || preauthId}」를 근거로 완료 처리합니다.`);
            if (!ok) return;
        }

        const label = button.textContent;
        button.disabled = true;
        button.textContent = "처리 중…";

        const { data, error } = await db.rpc("advance_task", {
            p_task_id: taskId,
            p_to_status: to,
            p_note: note && note.trim() ? note.trim() : null,
            p_preauth_id: preauthId,
        });

        if (error || (data && data.ok === false)) {
            // 승인 강제(D18)에 걸린 경우도 여기로 옵니다 — 함수가 준 사유를
            // 그대로 보여줍니다. 무엇을 해야 하는지가 사유 안에 있습니다.
            window.alert(error ? error.message : (data.reason || "옮기지 못했습니다"));
            button.disabled = false;
            button.textContent = label;
            return;
        }

        await Promise.all([refreshTasksSummary(), refreshTaskList()]);
        // 발송 승인 건은 위반·공문 화면의 배지가 이 업무의 상태를 비추므로
        // 같이 새로 그립니다 — 영역 전환은 다시 조회하지 않아(위 showArea
        // 원칙) 여기서 안 하면 옛 배지가 남습니다.
        if (moved?.kind === "notice_send") await refreshViolations();
        // POS 메뉴 화면도 이 업무의 상태를 비춥니다. 승인하면 실행 칸이
        // '실행 대기' 로 바뀌어야 하는데, 여기서 안 그리면 옛 상태가 남습니다.
        if (moved?.kind === "pos_soldout" || moved?.kind === "pos_menu_change") {
            await Promise.all([refreshPosMenu(), refreshPosMenuRequests(),
                               refreshPosMenuSummary()]);
        }
        // 공지 목록도 승인 상태를 비춥니다 (12번, 같은 원칙).
        if (moved?.kind === "announcement_send") await refreshAnnouncements();
        if (!$("task-events-panel").hidden
            && Number($("task-events-panel").dataset.taskId) === taskId) {
            await showTaskEvents(taskId, $("task-events-panel").dataset.taskTitle);
        }
    });
}

export async function showTaskEvents(taskId, title) {
    const panel = $("task-events-panel");
    panel.hidden = false;
    panel.dataset.taskId = String(taskId);
    panel.dataset.taskTitle = title || "";
    $("task-events-title").textContent = `이력 — ${title || `#${taskId}`}`;

    const { data, error } = await db.rpc("api_task_events", { p_task_id: taskId });
    if (error) {
        $("t-task-events").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + '</p>';
        return;
    }
    const list = Array.isArray(data) ? data : [];
    if (!list.length) {
        $("t-task-events").innerHTML =
            '<p class="hint">접수 이후 아직 상태가 바뀌지 않았습니다.</p>';
        return;
    }

    table($("t-task-events"),
        ["시각", "전이", "승인 근거", "메모"],
        list.map((e) => [
            String(e.created_at).slice(0, 16).replace("T", " "),
            `${TASK_STATUS_LABEL[e.from] || e.from} → ${TASK_STATUS_LABEL[e.to] || e.to}`,
            e.approval_kind === "preauthorized"
                ? `사전 고지: ${e.preauth_scope || `#${e.preauth_id}`}`
                : (e.approval_kind === "manual" ? "승인 대기를 거침" : "—"),
            e.note || "—",
        ]));
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ---- 카카오 접수 건의 매장 지정 (68_kakao_store_map) ----------------------
//
// 카카오는 봇 사용자 키만 주고 매장을 안 알려줍니다. 점주에게 묻는 방식
// (카카오 쪽 플로우)은 운영 결정 대기라, 지금은 여기서 한 번 지정하면
// 서버가 키↔매장 매핑을 학습해 다음 접수부터 자동으로 붙입니다.
// 어느 건에 무엇을 하는지는 전부 서버(assign_kakao_store)가 판정합니다 —
// 소급 범위 규칙(개별 수정을 덮지 않음)을 화면이 흉내내지 않습니다.

function openTaskStorePanel(taskId, title) {
    const panel = $("task-store-panel");
    panel.hidden = false;
    panel.dataset.taskId = String(taskId);
    $("task-store-title").textContent = `매장 지정 — ${title || `#${taskId}`}`;
    const current = taskRows.find((t) => t.task_id === taskId);
    $("task-store-input").value = current?.store_name || "";
    const notice = $("task-store-notice");
    notice.className = "notice";
    notice.textContent = "";
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    $("task-store-input").focus();
}

async function saveTaskStore() {
    const panel = $("task-store-panel");
    const taskId = Number(panel.dataset.taskId);
    const name = $("task-store-input").value.trim();
    const notice = $("task-store-notice");
    const storeId = taskStoresByName.get(name);

    if (!storeId) {
        notice.className = "notice error";
        notice.textContent = name
            ? `「${name}」 매장을 찾지 못했습니다 — 목록에 있는 이름 그대로 고르세요.`
            : "매장 이름을 입력하세요.";
        return;
    }

    const button = $("task-store-save");
    button.disabled = true;
    notice.className = "notice";
    notice.textContent = "지정하는 중…";

    const { data, error } = await db.rpc("assign_kakao_store",
        { p_task_id: taskId, p_store_id: storeId });

    button.disabled = false;
    if (error || (data && data.ok === false)) {
        notice.className = "notice error";
        notice.textContent = error ? error.message : (data.reason || "지정하지 못했습니다");
        return;
    }

    notice.className = "notice";
    notice.textContent = `${data.store_name}으로 지정했습니다.`
        + (data.retro_updated
            ? ` 같은 사용자의 과거 접수 ${int(data.retro_updated)}건도 함께 갱신했습니다.`
            : "")
        + (data.mapping === "none"
            ? " (봇 사용자 키가 없는 건이라 이 건에만 적용됩니다)"
            : "");
    await refreshTaskList();
}

async function submitTask() {
    const notice = $("tk-notice");
    const button = $("tk-submit");
    const title = $("tk-title").value.trim();

    if (!title) {
        notice.className = "notice error";
        notice.textContent = "제목은 필수입니다.";
        return;
    }

    button.disabled = true;
    notice.className = "notice";
    notice.textContent = "접수하는 중…";

    const { data: { session } } = await db.auth.getSession();
    const storeId = $("tk-store").value;
    const { error } = await db.from("tasks").insert({
        kind: $("tk-kind").value,
        title,
        body: $("tk-body").value.trim() || null,
        store_id: storeId ? Number(storeId) : null,
        source: $("tk-source").value,
        assigned_to: $("tk-assigned").value.trim() || null,
        created_by: session?.user?.id,
    });

    button.disabled = false;
    if (error) {
        notice.className = "notice error";
        notice.textContent = "접수하지 못했습니다: " + error.message;
        return;
    }

    notice.className = "notice";
    notice.textContent = "접수했습니다.";
    $("tk-title").value = "";
    $("tk-body").value = "";
    await Promise.all([refreshTasksSummary(), refreshTaskList()]);
}

// 고지는 건수가 적어(담당자가 직접 남기는 문장) jsonb 조회 함수를 따로 두지
// 않고 표를 그대로 읽습니다. RLS 는 읽기 허용, 철회는 함수로만입니다.
async function refreshPreauths() {
    const { data, error } = await db.from("task_preauthorizations")
        .select("id,kind,scope,note,created_at,revoked_at").order("id").limit(50);
    if (error) {
        $("t-preauths").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + '</p>';
        return;
    }
    taskPreauths = (Array.isArray(data) ? data : [])
        .slice().sort((a, b) => b.id - a.id);

    const alive = taskPreauths.filter((p) => !p.revoked_at).length;
    $("preauth-summary").textContent = `사용 중 ${int(alive)}건 · 전체 ${int(taskPreauths.length)}건`;

    if (!taskPreauths.length) {
        $("t-preauths").innerHTML =
            '<p class="hint">등록된 고지가 없습니다. 지금은 승인이 필요한 업무가 모두 승인 대기를 거칩니다.</p>';
        return;
    }

    const kindName = (kind) =>
        kind ? (taskKinds.find((k) => k.kind === kind)?.name || kind) : "종류 무관";

    table($("t-preauths"),
        ["범위", "적용 종류", "고지 원문", "등록", "상태"],
        taskPreauths.map((p) => [
            escape(p.scope),
            escape(kindName(p.kind)),
            escape(p.note || "—"),
            escape(String(p.created_at).slice(0, 10)),
            p.revoked_at
                ? `<span class="tag">철회됨 ${escape(String(p.revoked_at).slice(0, 10))}</span>`
                : '<span class="tag up">사용 중</span> '
                  + `<button class="ghost" data-act="revoke-preauth" data-preauth-id="${p.id}">철회</button>`,
        ]),
        { html: true });
}

function initPreauthActions() {
    $("t-preauths").addEventListener("click", async (event) => {
        const button = event.target.closest("button[data-act='revoke-preauth']");
        if (!button) return;

        const preauthId = Number(button.dataset.preauthId);
        const ok = window.confirm(
            "이 고지를 철회하면 해당 업무는 다시 승인 대기를 거칩니다. 철회할까요?");
        if (!ok) return;

        button.disabled = true;
        button.textContent = "처리 중…";

        const { data, error } = await db.rpc("revoke_task_preauthorization",
            { p_preauth_id: preauthId });
        if (error || (data && data.ok === false)) {
            window.alert(error ? error.message : (data.reason || "철회하지 못했습니다"));
            button.disabled = false;
            button.textContent = "철회";
            return;
        }

        // 철회하면 '고지로 완료' 버튼이 사라져야 하므로 목록도 다시 그립니다.
        await refreshPreauths();
        drawTaskList();
    });
}

async function submitPreauth() {
    const notice = $("pa-notice");
    const button = $("pa-submit");
    const scope = $("pa-scope").value.trim();

    if (!scope) {
        notice.className = "notice error";
        notice.textContent = "승인 범위는 필수입니다 — 무엇이 승인됐는지 한 줄로 적어 주세요.";
        return;
    }

    button.disabled = true;
    notice.className = "notice";
    notice.textContent = "등록하는 중…";

    const { data: { session } } = await db.auth.getSession();
    const { error } = await db.from("task_preauthorizations").insert({
        kind: $("pa-kind").value || null,
        scope,
        note: $("pa-note").value.trim() || null,
        created_by: session?.user?.id,
    });

    button.disabled = false;
    if (error) {
        notice.className = "notice error";
        notice.textContent = "등록하지 못했습니다: " + error.message;
        return;
    }

    notice.className = "notice";
    notice.textContent = "등록했습니다.";
    $("pa-scope").value = "";
    $("pa-note").value = "";
    await refreshPreauths();
    drawTaskList();
}
