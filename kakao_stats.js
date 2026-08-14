// 카카오 챗봇 통계 (1번 영역) — api_kakao_skill_stats 위의 화면. app.js 에서
// 뽑은 영역 모듈(docs/web-split-plan.md). db + foundation 만 import.

import { db } from "./client.js";
import { int } from "./format.js";
import { palette, drawLine, drawBars } from "./charts.js";
import { table, $ } from "./dom.js";

export async function initKakaoStats() {
    $("ks-days").addEventListener("change", refreshKakaoStats);
    await refreshKakaoStats();
}

async function refreshKakaoStats() {
    const days = Number($("ks-days").value) || 30;
    const { data, error } = await db.rpc("api_kakao_skill_stats", { p_days: days });
    if (error) {
        $("ks-meta").textContent = "불러오지 못했습니다: " + error.message;
        return;
    }
    drawKakaoStats(data || {});
}

function drawKakaoStats(stats) {
    const calls = Number(stats.calls) || 0;
    const tasks = Number(stats.tasks_created) || 0;
    $("ks-calls").textContent = int(calls);
    $("ks-tasks").textContent = int(tasks);
    $("ks-rate").textContent = calls ? `${Math.round((tasks / calls) * 100)}%` : "—";
    $("ks-meta").textContent = `최근 ${int(stats.days)}일`;

    if (!calls) {
        $("ks-shown").textContent =
            "아직 호출이 없습니다 — 봇테스트나 운영채널 연결 뒤에 채워집니다.";
        $("legend-kakao-daily").innerHTML = "";
        $("c-kakao-daily").innerHTML = "";
        $("c-kakao-daily").removeAttribute("height");
        $("ks-detail").hidden = true;
        return;
    }
    $("ks-shown").textContent = "";
    $("ks-detail").hidden = false;

    const c = palette();

    // 일별 추이. 함수는 호출이 있는 날만 주므로 빈 날을 0 으로 채워 그립니다 —
    // 빈 날이 접히면 추이가 실제보다 촘촘해 보입니다. 날짜 키는 서버가 주는
    // UTC 기준 그대로 씁니다(toISOString 도 UTC — 어긋나지 않습니다).
    const byDate = new Map((stats.daily || []).map((d) => [String(d.date), d]));
    const days = Number(stats.days) || 30;
    const xLabels = [], dailyCalls = [], dailyTasks = [];
    for (let i = days - 1; i >= 0; i--) {
        const key = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
        const row = byDate.get(key);
        xLabels.push(key.slice(5).replace("-", "."));
        dailyCalls.push(row ? Number(row.calls) || 0 : 0);
        dailyTasks.push(row ? Number(row.tasks) || 0 : 0);
    }
    const series = [
        { name: "호출", color: c.s1, values: dailyCalls },
        { name: "접수", color: c.s2, values: dailyTasks },
    ];
    const legend = $("legend-kakao-daily");
    legend.innerHTML = "";
    for (const s of series) {
        const span = document.createElement("span");
        span.innerHTML = `<i style="background:${s.color}"></i>${s.name}`;
        legend.append(span);
    }
    drawLine($("c-kakao-daily"), {
        xLabels, series, colors: c,
        fmt: int, fmtFull: (v) => `${int(v)}건`,
    });

    // 블록별 — 호출만 있고 접수가 없는 갈래가 어디서 끊기는지 보는 표입니다.
    table($("t-kakao-blocks"),
        ["블록", "호출", "접수"],
        (stats.by_block || []).map((b) => [b.block, int(b.calls), int(b.tasks)]));

    // 분류별 접수 (본사 7종)
    const cats = (stats.by_category || [])
        .map((r) => ({ label: r.category, value: Number(r.tasks) || 0 }));
    if (cats.length) {
        drawBars($("c-kakao-category"),
            { rows: cats, color: c.s1, horizontal: true, colors: c, unitSuffix: "건" });
    } else {
        $("c-kakao-category").innerHTML = "";
        $("c-kakao-category").removeAttribute("height");
    }
}
