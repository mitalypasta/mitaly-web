// 위반 기록·공문 (7번 영역) — app.js 에서 뽑아낸 shell 분리 조각
// (docs/web-split-plan.md). 업무(tasks)와 서로 부르지만 전부 런타임 호출이라
// ESM 순환 import 로 동작합니다(모듈 최상위에서 서로 안 씀).

import { int } from "./format.js";
import { escape } from "./util.js";
import { $, table } from "./dom.js";
import { db } from "./client.js";
import { showArea } from "./nav.js";
import { TASK_STATUS_LABEL, refreshTasksSummary, refreshTaskList } from "./tasks.js";

// ================================================================ 위반 기록 (7번 영역)
//
// violation_events(23_notice_determination.sql)에 아무도 기록을 넣지 않으면
// api_notice_stage_status() 는 항상 빈 배열입니다 — 이 화면이 그 첫 입력
// 지점입니다. 날짜 필터(기간·매장)와 무관해 load() 묶음에 넣지 않고
// initRequests·initExport처럼 한 번만 받습니다.
//
// ⚠️ 여기서 계산하는 '단계'는 참고용입니다. 실제 내용증명 문서 생성·발송은
//    어디에도 없습니다 — 큐 #8 설계 그대로, 이 화면도 그 선을 넘지 않습니다.

let noticeRules = [];   // api_notice_stage_rules() 결과. 위반유형 select와 힌트 문구에 씁니다.

function ruleHasKind(rule, kind) {
    return !!rule && [rule.stage1, rule.stage2, rule.stage3].some((s) => s && s.kind === kind);
}

// ─── 위반 기록 문서 첨부 (78_notice_files.sql) ────────────────────────
//
// 파일 바이트는 비공개 버킷 notice-files 에, 메타는 notice_attachments 표에
// 둡니다. 허용 형식·크기는 서버(버킷 정책)에서도 막지만 여기서 먼저 걸러
// 잘못된 파일로 왕복하지 않게 합니다. db.storage 가 없는 데모 모드에서는
// 파일 처리를 통째로 건너뜁니다(콘솔 오류 0).
const NOTICE_BUCKET = "notice-files";
const NOTICE_MAX_BYTES = 20 * 1024 * 1024;   // 서버 file_size_limit 과 같은 20MB
const EXT_MIME = {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
};

function fileExt(name) {
    const i = (name || "").lastIndexOf(".");
    return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

// 위반 표가 지금 보여 주는 위반 id 묶음의 첨부만 받아 위반 id → [첨부] 로
// 묶어 돌려줍니다. 데모/미적용 환경(에러)에서는 빈 Map — 화면은 '—' 로 그려집니다.
async function fetchAttachments(ids) {
    if (!db.storage || !ids.length) return new Map();
    const { data, error } = await db.rpc("api_notice_attachments", { p_violation_ids: ids });
    const map = new Map();
    if (error || !Array.isArray(data)) return map;
    for (const a of data) {
        if (!map.has(a.violation_id)) map.set(a.violation_id, []);
        map.get(a.violation_id).push(a);
    }
    return map;
}

function attachmentCell(atts) {
    if (!atts || !atts.length) return "—";
    return atts.map((a) =>
        `<a href="#" data-att-path="${escape(a.object_path)}"`
        + ` data-att-name="${escape(a.file_name)}">${escape(a.file_name)}</a>`
    ).join("<br>");
}

// 첨부 링크 클릭 → 서명 URL 로 새 창에서 열람. word 는 미리보기가 안 되니
// 원본 이름으로 내려받게 하고, pdf·jpg 는 새 창에서 바로 보이게 둡니다.
function initAttachmentOpen() {
    const open = async (event) => {
        const link = event.target.closest("[data-att-path]");
        if (!link || !db.storage) return;
        event.preventDefault();
        const name = link.dataset.attName || "";
        const ext = fileExt(name);
        const opts = (ext === "doc" || ext === "docx") ? { download: name } : {};
        const { data, error } = await db.storage.from(NOTICE_BUCKET)
            .createSignedUrl(link.dataset.attPath, 60, opts);
        if (error || !data) {
            window.alert("첨부를 열지 못했습니다: " + (error ? error.message : ""));
            return;
        }
        window.open(data.signedUrl, "_blank", "noopener");
    };
    $("t-violations").addEventListener("click", open);
    $("t-violations-resolved").addEventListener("click", open);
}

export async function initNotices() {
    const storeSelect = $("v-store");
    const { data: stores, error: storeErr } = await db.from("stores")
        .select("id,name").order("name");
    if (!storeErr) {
        for (const s of stores || []) {
            const opt = document.createElement("option");
            opt.value = s.id;
            opt.textContent = s.name;
            storeSelect.append(opt);
        }
    }

    const { data: rulesData, error: rulesErr } = await db.rpc("api_notice_stage_rules");
    noticeRules = rulesErr ? [] : (((rulesData || [])[0] || {}).rules || []);
    const typeSelect = $("v-type");
    for (const r of noticeRules) {
        const opt = document.createElement("option");
        opt.value = r.violation_type;
        opt.textContent = r.violation_type;
        typeSelect.append(opt);
    }

    $("v-occurred").value = new Date().toISOString().slice(0, 10);

    typeSelect.addEventListener("change", updateViolationFormFields);
    $("v-submit").addEventListener("click", submitViolation);
    initViolationResolve();
    initViolationReopen();
    initAttachmentOpen();

    initBoardArchive();
    await Promise.all([refreshViolations(), refreshResolvedViolations(),
                       refreshBoardArchive()]);
}

// ─── 과거 공문 아카이브 (7번, 60_board_archive.sql) ────────────────────
//
// 이 화면이 있는 이유: 공문 초안을 쓸 때 참고할 과거 공문이 어디에도 없었고,
// 미태리샵 게시판을 사람이 한 장씩 열어 보는 것이 유일한 방법이었습니다.
//
// 본문의 81%가 A4 이미지였고 OCR 로 글자를 뽑았습니다. 그래서 '확인필요'
// 표시가 붙는 건이 있습니다 — 표시를 숨기지 않는 것이 요점입니다. 숨기면
// AI 든 사람이든 OCR 결과를 원문으로 착각합니다.
function initBoardArchive() {
    const run = () => refreshBoardArchive($("ba-q").value.trim());
    $("ba-search").addEventListener("click", run);
    $("ba-q").addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });

    // 목록은 검색할 때마다 새로 그려지므로 클릭은 컨테이너에 한 번만 위임합니다.
    $("t-board-archive").addEventListener("click", async (event) => {
        const link = event.target.closest("[data-ba-open]");
        if (!link) return;
        event.preventDefault();
        await openBoardNotice(Number(link.dataset.baOpen));
    });
}

async function refreshBoardArchive(q) {
    const box = $("t-board-archive");
    const { data, error } = await db.rpc("api_board_notices",
        { p_q: q || null, p_limit: 60 });
    if (error) {
        box.innerHTML = '<p class="hint">불러오지 못했습니다: '
            + escape(error.message) + "</p>";
        return;
    }
    const rows = (data && data.rows) || [];
    const span = (data && data.span) || {};
    $("ba-summary").textContent = data
        ? `${int(data.total)}건 · ${span.from || "—"} ~ ${span.to || "—"}`
          + ` · 문서번호 ${int(data.with_doc_no)}건`
        : "";

    if (!rows.length) {
        box.innerHTML = q
            ? `<p class="hint">'${escape(q)}' 로 찾은 공문이 없습니다.</p>`
            : '<p class="hint">아직 반입된 공문이 없습니다.</p>';
        $("ba-detail").hidden = true;
        return;
    }

    const shown = q ? `${int(data.matched)}건 중 ${rows.length}건` : `최근 ${rows.length}건`;
    box.innerHTML = `<p class="hint">${shown} 보는 중`
        + (data.need_review ? ` · 확인필요 ${int(data.need_review)}건` : "")
        + (data.unlisted ? ` · 게시판 목록에 안 뜨는 글 ${int(data.unlisted)}건` : "")
        + "</p>";
    const view = document.createElement("div");
    box.append(view);

    table(view,
        ["작성일", "문서번호", "제목", "첨부", "표시"],
        rows.map((r) => [
            r.posted_on || "—",
            r.doc_no
                ? escape(r.doc_no) + (r.verified ? "" : ' <span class="flag">날짜 불일치</span>')
                : "—",
            `<a href="#" data-ba-open="${r.article_no}">${escape(r.title)}</a>`
            + `<br><span class="meta">${escape(r.excerpt || "")}</span>`,
            (r.attachments || []).length ? int(r.attachments.length) + "개" : "—",
            [r.need_review ? '<span class="flag">확인필요</span>' : "",
             r.listed ? "" : '<span class="tag h-warn">목록에 안 뜸</span>'].join(" ").trim() || "—",
        ]),
        { html: true });
}

async function openBoardNotice(articleNo) {
    const box = $("ba-detail");
    box.hidden = false;
    box.innerHTML = '<p class="hint">불러오는 중…</p>';
    const { data, error } = await db.rpc("api_board_notice", { p_article_no: articleNo });
    if (error || !data || data.found === false) {
        box.innerHTML = '<p class="hint">본문을 불러오지 못했습니다.</p>';
        return;
    }
    const attach = (data.attachments || []).length
        ? `<p class="meta">첨부 ${data.attachments.length}개: `
          + data.attachments.map(escape).join(" · ") + "</p>"
        : "";
    // OCR 을 거친 본문이면 그렇다고 밝힙니다 — 원문과 다를 수 있다는 것이
    // 이 화면에서 가장 중요한 정보입니다.
    const src = data.source && data.source !== "원본텍스트"
        ? `<p class="hint">이 본문은 공문 이미지를 글자로 옮긴 것입니다`
          + `(${escape(data.source)})`
          + (data.need_review ? " — <b>확인필요로 표시된 건입니다. 원문을 함께 보세요.</b>" : "")
          + "</p>"
        : "";
    box.innerHTML =
        `<header><h2>${escape(data.doc_title || data.title)}</h2>`
        + `<span class="meta">${data.posted_on || "—"}`
        + (data.doc_no ? ` · 문서번호 ${escape(data.doc_no)}` : "")
        + ` · 글번호 ${data.article_no}</span></header>`
        + src + attach
        + `<pre class="ba-body">${escape(data.body || "")}</pre>`;
    box.scrollIntoView({ behavior: "smooth", block: "start" });
}

// 목록은 매번 새로 그려지므로(refreshViolations), 버튼 클릭은 컨테이너에
// 한 번만 위임해 둡니다(초안 승인/반려와 같은 패턴, initDrafts 참고).
function initViolationResolve() {
    $("t-violations").addEventListener("click", async (event) => {
        // 발송 승인 요청 (39_notice_tasks) — 판정 단계는 서버가 다시 세므로
        // 여기서는 위반 번호만 보냅니다.
        const noticeButton = event.target.closest("button[data-act='notice-task']");
        if (noticeButton) {
            noticeButton.disabled = true;
            noticeButton.textContent = "요청 중…";
            const { data, error } = await db.rpc("create_notice_send_task",
                { p_event_id: Number(noticeButton.dataset.eventId) });
            if (error || (data && data.ok === false)) {
                window.alert(error ? error.message : (data.reason || "요청하지 못했습니다"));
                noticeButton.disabled = false;
                noticeButton.textContent = "발송 승인 요청";
                // 이미 흐름에 있다는 거절이면 배지가 그려지도록 다시 받습니다.
                if (!error && data.task_id) await refreshViolations();
                return;
            }
            // 업무 화면 쪽 숫자(승인 대기 타일·목록)도 같이 새로 그립니다.
            await Promise.all([refreshViolations(), refreshTasksSummary(), refreshTaskList()]);
            return;
        }
        const goButton = event.target.closest("button[data-act='notice-task-go']");
        if (goButton) {
            showArea("tasks");
            $("tk-filter-status").value = "waiting_approval";
            $("tk-filter-status").dispatchEvent(new Event("change"));
            return;
        }

        const button = event.target.closest("button[data-act='resolve']");
        if (!button) return;

        const eventId = Number(button.dataset.eventId);
        const today = new Date().toISOString().slice(0, 10);
        const resolvedOn = window.prompt(
            "종료일을 입력하세요 (YYYY-MM-DD). 잘못 눌러도 아래 표에서 다시 열 수 있습니다.", today);
        if (resolvedOn === null) return;   // 취소
        if (!/^\d{4}-\d{2}-\d{2}$/.test(resolvedOn.trim())) {
            window.alert("날짜 형식이 올바르지 않습니다 (예: 2026-07-29).");
            return;
        }

        button.disabled = true;
        button.textContent = "처리 중…";

        const { data, error } = await db.rpc("resolve_violation_event", {
            p_event_id: eventId,
            p_resolved_on: resolvedOn.trim(),
        });

        if (error) {
            window.alert("종료 처리하지 못했습니다: " + error.message);
            button.disabled = false;
            button.textContent = "종료 처리";
            return;
        }
        // 함수는 {ok, reason} 을 돌려줍니다. 실패해도 HTTP 는 200 입니다.
        if (data && data.ok === false) {
            window.alert(data.reason || "종료 처리하지 못했습니다");
            button.disabled = false;
            button.textContent = "종료 처리";
            return;
        }

        await Promise.all([refreshViolations(), refreshResolvedViolations()]);
    });
}

// 26_violation_reopen.sql — resolve_violation_event 와 대칭. 되돌린 건은
// '진행 중인 위반' 표로 다시 옮겨가므로 두 표를 같이 갱신합니다.
function initViolationReopen() {
    $("t-violations-resolved").addEventListener("click", async (event) => {
        const button = event.target.closest("button[data-act='reopen']");
        if (!button) return;

        const eventId = Number(button.dataset.eventId);
        const ok = window.confirm(
            "이 위반을 다시 진행 중 상태로 되돌릴까요? 위 '진행 중인 위반' 표에 다시 나타납니다.");
        if (!ok) return;

        button.disabled = true;
        button.textContent = "처리 중…";

        const { data, error } = await db.rpc("reopen_violation_event", { p_event_id: eventId });

        if (error) {
            window.alert("다시 열지 못했습니다: " + error.message);
            button.disabled = false;
            button.textContent = "다시 열기";
            return;
        }
        if (data && data.ok === false) {
            window.alert(data.reason || "다시 열지 못했습니다");
            button.disabled = false;
            button.textContent = "다시 열기";
            return;
        }

        await Promise.all([refreshViolations(), refreshResolvedViolations()]);
    });
}

// api_violation_events_resolved 도 api_notice_stage_status 와 같은 반환
// 형태입니다(returns jsonb 스칼라, 배열을 그대로 돌려줌, D10).
async function refreshResolvedViolations() {
    const { data, error } = await db.rpc("api_violation_events_resolved", { p_store: null, p_limit: 20 });
    if (error) {
        $("t-violations-resolved").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + '</p>';
        return;
    }
    const list = Array.isArray(data) ? data : [];

    if (!list.length) {
        $("t-violations-resolved").innerHTML =
            '<p class="hint">종료 처리된 위반 기록이 없습니다.</p>';
        return;
    }

    const atts = await fetchAttachments(list.map((v) => v.event_id));

    table($("t-violations-resolved"),
        ["매장", "위반유형", "발생일", "종료일", "메모", "첨부", "처리"],
        list.map((v) => [
            v.store_name,
            v.violation_type,
            v.occurred_on,
            v.resolved_on,
            v.note ? escape(v.note) : "—",
            attachmentCell(atts.get(v.event_id)),
            `<button type="button" class="ghost" data-act="reopen" data-event-id="${v.event_id}">다시 열기</button>`,
        ]),
        { html: true });
}

// 위반유형에 따라 '몇 차 지적'(sequential)·'로고 품목 여부'(자점매입 전용)
// 입력칸을 보이거나 숨깁니다. hq-standards.md 예외 3(자점매입)은 여기서
// 화면으로, 예외 1(무단 휴업 특약)은 rule.note 힌트로만 보여줍니다 — 실제
// 판정은 서버(api_notice_stage_status)가 합니다.
function updateViolationFormFields() {
    const type = $("v-type").value;
    const rule = noticeRules.find((r) => r.violation_type === type);

    $("v-seq-field").hidden = !ruleHasKind(rule, "sequential");
    $("v-logo-field").hidden = type !== "자점매입";

    const note = $("v-type-note");
    if (rule && rule.note) {
        note.textContent = rule.note;
        note.hidden = false;
    } else {
        note.hidden = true;
    }
}

async function submitViolation() {
    const notice = $("v-notice");
    const button = $("v-submit");
    const storeId = $("v-store").value;
    const violationType = $("v-type").value;
    const occurred = $("v-occurred").value;
    const resolved = $("v-resolved").value || null;
    const seqField = $("v-seq");
    const logoField = $("v-logo");

    if (!storeId || !violationType || !occurred) {
        notice.className = "notice error";
        notice.textContent = "매장·위반유형·발생일은 필수입니다.";
        return;
    }
    if (resolved && resolved < occurred) {
        notice.className = "notice error";
        notice.textContent = "종료일이 발생일보다 앞설 수 없습니다.";
        return;
    }

    const rule = noticeRules.find((r) => r.violation_type === violationType);
    const isSequential = ruleHasKind(rule, "sequential");

    // 파일은 db.storage 가 있을 때만 다룹니다(데모 모드는 건너뜀). 올리기 전에
    // 확장자·크기를 먼저 걸러 잘못된 파일로 위반 저장까지 갔다가 되돌리지
    // 않게 합니다. 서버(버킷 정책)가 같은 기준으로 한 번 더 막습니다.
    const files = db.storage ? Array.from($("v-files").files || []) : [];
    for (const f of files) {
        const ext = fileExt(f.name);
        if (!EXT_MIME[ext]) {
            notice.className = "notice error";
            notice.textContent = `'${f.name}' 는 올릴 수 없는 형식입니다. `
                + "pdf · word(doc/docx) · jpg 만 됩니다.";
            return;
        }
        if (f.size > NOTICE_MAX_BYTES) {
            notice.className = "notice error";
            notice.textContent = `'${f.name}' 가 20MB 를 넘습니다.`;
            return;
        }
    }

    button.disabled = true;
    notice.className = "notice";
    notice.textContent = "저장하는 중…";

    const { data: { session } } = await db.auth.getSession();
    const row = {
        store_id: Number(storeId),
        violation_type: violationType,
        occurred_on: occurred,
        resolved_on: resolved,
        sequence_no: (isSequential && seqField.value) ? Number(seqField.value) : null,
        applies_logo_required_item: (violationType === "자점매입" && logoField.value)
            ? logoField.value === "true" : null,
        note: $("v-note").value.trim() || null,
        created_by: session?.user?.id,
    };

    // 첨부가 있으면 위반 id 가 필요하므로 넣고 그 id 를 돌려받습니다. 없으면
    // 종전대로 넣기만 합니다(데모 builder 는 select 체이닝을 안 받으므로 이
    // 갈래가 데모에서도 안전합니다 — files 는 데모에서 항상 비어 있습니다).
    let eventId = null;
    if (files.length) {
        const { data, error } = await db.from("violation_events")
            .insert(row).select("id").single();
        if (error) {
            button.disabled = false;
            notice.className = "notice error";
            notice.textContent = "저장하지 못했습니다: " + error.message;
            return;
        }
        eventId = data.id;
    } else {
        const { error } = await db.from("violation_events").insert(row);
        if (error) {
            button.disabled = false;
            notice.className = "notice error";
            notice.textContent = "저장하지 못했습니다: " + error.message;
            return;
        }
    }

    // 파일 올리기 — 버킷 키는 무작위 UUID(원본 이름은 표에만). 실패한 파일은
    // 모아 두었다가 안내하되, 위반 기록 자체는 이미 저장됐습니다.
    const failed = [];
    for (const f of files) {
        const ext = fileExt(f.name);
        const objectPath = `${eventId}/${crypto.randomUUID()}.${ext}`;
        const up = await db.storage.from(NOTICE_BUCKET)
            .upload(objectPath, f, { contentType: EXT_MIME[ext], upsert: false });
        if (up.error) { failed.push(f.name); continue; }
        const meta = await db.from("notice_attachments").insert({
            violation_id: eventId,
            object_path: objectPath,
            file_name: f.name,
            mime_type: EXT_MIME[ext],
            byte_size: f.size,
            uploaded_by: session?.user?.id,
        });
        if (meta.error) failed.push(f.name);
    }

    button.disabled = false;
    notice.className = failed.length ? "notice error" : "notice";
    notice.textContent = failed.length
        ? `저장했습니다. 다만 첨부 ${failed.length}개는 올리지 못했습니다: ${failed.join(", ")}`
        : (files.length ? `저장했습니다. 첨부 ${files.length}개 올림.` : "저장했습니다.");
    $("v-note").value = "";
    $("v-resolved").value = "";
    seqField.value = "";
    logoField.value = "";
    $("v-files").value = "";
    await Promise.all([refreshViolations(), refreshResolvedViolations()]);
}

// api_notice_stage_status 는 `returns jsonb`(스칼라)라 다른 조회 함수들과
// 달리 [{alerts:[...]}] 로 한 번 더 감싸지 않습니다 — data 자체가 배열입니다
// (14_reply_drafts.sql 의 approve_reply_draft 등과 같은 모양, D10 조회 규칙은
// 그대로 지키되 반환 형태만 다름).
export async function refreshViolations() {
    // 승인 흐름 배지(39_notice_tasks)를 같이 받습니다 — 이미 요청된 건에
    // 또 요청 버튼을 보여주면 중복 요청을 함수가 거절하는 것으로 끝나지만,
    // 애초에 버튼이 안 보이는 편이 낫습니다.
    const [{ data, error }, { data: sendTasks }] = await Promise.all([
        db.rpc("api_notice_stage_status", { p_store: null }),
        db.rpc("api_notice_send_tasks"),
    ]);
    if (error) {
        $("t-violations").innerHTML =
            '<p class="hint">불러오지 못했습니다: ' + escape(error.message) + '</p>';
        return;
    }
    const list = Array.isArray(data) ? data : [];
    // 위반+단계 → 살아 있는 승인 업무. 반려된 것은 다시 요청할 수 있어야
    // 하므로 배지로 치지 않습니다(39 설계 판단 [3]과 같은 규칙).
    const liveTask = new Map();
    for (const t of (Array.isArray(sendTasks) ? sendTasks : [])) {
        if (t.task_status === "rejected") continue;
        liveTask.set(`${t.violation_id}|${t.stage}`, t);
    }
    $("violation-summary").textContent = list.length ? `${int(list.length)}건 진행 중` : "";

    if (!list.length) {
        $("t-violations").innerHTML =
            '<p class="hint">진행 중인 위반 기록이 없습니다. 위 폼에서 추가하면 여기 나타납니다.</p>';
        return;
    }

    const atts = await fetchAttachments(list.map((v) => v.event_id));

    table($("t-violations"),
        ["매장", "위반유형", "발생일", "경과일", "단계", "확인 필요", "메모", "첨부", "처리"],
        list.map((v) => [
            v.store_name,
            v.violation_type,
            v.occurred_on,
            int(v.days_elapsed),
            stageTag(v.stage, v.stage_label, v.requires_legal_review),
            v.needs_manual_review
                ? `<span class="flag" title="${escape(v.manual_review_reason || "")}">담당자 확인</span>`
                : "—",
            v.note ? escape(v.note) : "—",
            attachmentCell(atts.get(v.event_id)),
            noticeActions(v, liveTask.get(`${v.event_id}|${v.stage}`)),
        ]),
        { html: true });
}

// 처리 칸: 종료 처리 + (단계 도달 시) 발송 승인 요청 또는 진행 중 배지.
function noticeActions(v, live) {
    const resolve = `<button type="button" class="ghost" data-act="resolve"`
        + ` data-event-id="${v.event_id}">종료 처리</button>`;
    if (!v.stage) return resolve;

    if (live) {
        const label = live.task_status === "done"
            ? "발송 승인됨" : TASK_STATUS_LABEL[live.task_status] || live.task_status;
        return `<span class="tag${live.task_status === "done" ? " up" : " h-warn"}">`
            + `${escape(label)}</span> `
            + `<button type="button" class="ghost" data-act="notice-task-go">업무 보기</button> `
            + resolve;
    }
    return `<button type="button" data-act="notice-task"`
        + ` data-event-id="${v.event_id}">발송 승인 요청</button> ` + resolve;
}

function stageTag(stage, label, requiresLegal) {
    if (!stage) return '<span class="tag">해당 없음(제재 대상 아님)</span>';
    const tag = `<span class="tag${stage >= 3 ? " down" : ""}">` +
        `${escape(String(stage))}단계 · ${escape(label || "")}</span>`;
    return tag + (requiresLegal ? ' <span class="flag">법무 검토</span>' : "");
}
