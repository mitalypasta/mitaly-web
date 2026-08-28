// 차트 그리기 — SVG 를 라이브러리 없이 직접 그립니다. app.js 에서 뽑아낸
// 2단계 조각(docs/web-split-plan.md). 히트맵·선그래프·막대그래프와 그에 딸린
// 색·hover 헬퍼가 여기 모입니다.
//
// 의존은 아래로만 흐릅니다: charts → dom(툴팁) → util, charts → format/util.
// area 코드(app.js)는 여기의 palette·renderHeat·drawLine·drawBars 를 부릅니다.

import { won, wonFull } from "./format.js";
import { escape, clip, niceTicks } from "./util.js";
import { showTip, hideTip } from "./dom.js";

// 시리즈 색은 CSS 변수에서 읽습니다. 라이트/다크 전환 시 같이 바뀝니다.
const cssVar = (name) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export const palette = () => ({
    s1: cssVar("--series-1"),
    s2: cssVar("--series-2"),
    grid: cssVar("--gridline"),
    base: cssVar("--baseline"),
    muted: cssVar("--text-muted"),
    secondary: cssVar("--text-secondary"),
    primary: cssVar("--text-primary"),
    surface: cssVar("--surface-1"),
});

// ---- 히트맵 ----------------------------------------------------------
//
// 색·글자색은 styles.css 의 --heat-* 토큰(.heat .h1~.h6)이 정합니다.
// 여기서는 값 → 단계(1~6)만 정합니다. 예전에는 JS 가 hex 를 직접 골랐는데
// ① 다크 판정이 옛 surface 값("#1a1a19")과 비교해 다크에서도 라이트 색이
// 나왔고 ② 테마를 바꿔도 다시 그리기 전까지 낡은 색이 남았습니다.
// 클래스로 붙이면 두 문제가 구조적으로 없습니다.
//
// 단계는 제곱근 눈금입니다. 매출은 상위 몇 메뉴가 최댓값을 끌어올려
// 선형(value/max)으로 나누면 나머지 전부가 1단계에 몰려 색이 일을 안 합니다
// — 제곱근이면 중간 값이 중간 단계로 퍼져 행끼리 비교가 됩니다.
function heatBin(value, max) {
    if (!value || !max) return 0;
    return Math.max(1, Math.min(6, Math.ceil(Math.sqrt(value / max) * 6)));
}

// rows×cols 격자. 옵션:
//   rowTitle — 행 머리글이 잘렸을 때 title 로 보여줄 전체 이름
//   summary  — 오른쪽 끝 요약 열 { label, get, format } (정렬 기준을 보여줍니다)
//   note     — 표 아래 한 줄 각주 (상위 N 제한 등, 아래 전체 표와의 관계)
// 각 행의 최댓값 칸은 .peak 로 표시합니다 — "이 메뉴는 어디서 잘 팔리나"가
// 행 단위 질문이라, 행마다 답 하나를 짚어 줍니다.
export function renderHeat(container, { rows, cols, get, label, rowLabel = (r) => r,
                           rowTitle = null, summary = null, note = "" }) {
    const max = Math.max(1, ...rows.flatMap((r) => cols.map((cx) => get(r, cx) || 0)));
    const head = cols.map((cx) => `<th>${escape(cx)}</th>`).join("") +
        (summary ? `<th class="sum">${escape(summary.label)}</th>` : "");
    const body = rows.map((r) => {
        const values = cols.map((cx) => get(r, cx) || 0);
        // 최댓값이 여럿(동률)이면 표시하지 않습니다 — "어디가 제일인가"의 답이
        // 하나가 아닌데 여러 칸에 테두리를 두르면 소음입니다(커버리지처럼
        // 같은 수가 연달아 나오는 격자에서 실제로 그렇게 됩니다).
        const peak = Math.max(...values);
        const unique = values.filter((v) => v === peak).length === 1;
        const cells = values.map((v, i) => {
            const cls = v
                ? ` h${heatBin(v, max)}${v === peak && unique && cols.length > 1 ? " peak" : ""}`
                : " empty";
            return `<td class="cell${cls}"` +
                ` title="${escape(rowTitle ? rowTitle(r) : rowLabel(r))}` +
                ` · ${escape(cols[i])} · ${label(v)}">` +
                `${v ? label(v) : "—"}</td>`;
        }).join("");
        const sum = summary
            ? `<td class="sum">${escape(summary.format(summary.get(r)))}</td>` : "";
        const th = `<th${rowTitle ? ` title="${escape(rowTitle(r))}"` : ""}>` +
            `${escape(rowLabel(r))}</th>`;
        return `<tr>${th}${cells}${sum}</tr>`;
    }).join("");

    // 각주는 스크롤 상자(.heat) 밖에 둡니다 — 표를 옆으로 밀어도 제자리.
    container.innerHTML =
        `<div class="heat"><table><thead><tr><th></th>${head}</tr></thead>` +
        `<tbody>${body}</tbody></table></div>` +
        (note ? `<div class="heat-note">${escape(note)}</div>` : "");
}

// ---- 선 그래프 --------------------------------------------------------

export function drawLine(svg, { xLabels, series, colors, fmt = won, fmtFull = wonFull }) {
    const width = svg.clientWidth || 720;
    const height = 300;
    const pad = { top: 18, right: 64, bottom: 30, left: 62 };
    const plotW = Math.max(10, width - pad.left - pad.right);
    const plotH = height - pad.top - pad.bottom;

    const max = Math.max(1, ...series.flatMap((s) => s.values));
    const ticks = niceTicks(max, 4);
    const top = ticks[ticks.length - 1];

    const x = (i) => pad.left + (xLabels.length === 1
        ? plotW / 2
        : (plotW * i) / (xLabels.length - 1));
    const y = (v) => pad.top + plotH - (plotH * v) / top;

    const parts = [];

    // 가로 눈금선 — 실선 헤어라인, 표면에서 한 단계만 진하게
    for (const t of ticks) {
        parts.push(
            `<line x1="${pad.left}" y1="${y(t)}" x2="${pad.left + plotW}" y2="${y(t)}"` +
            ` stroke="${colors.grid}" stroke-width="1"/>`,
            `<text x="${pad.left - 8}" y="${y(t) + 4}" text-anchor="end"` +
            ` font-size="11" fill="${colors.muted}"` +
            ` style="font-variant-numeric:tabular-nums">${fmt(t)}</text>`
        );
    }

    // x축 라벨은 겹치지 않을 만큼만
    const step = Math.ceil(xLabels.length / Math.max(2, Math.floor(plotW / 64)));
    xLabels.forEach((label, i) => {
        if (i % step && i !== xLabels.length - 1) return;
        parts.push(
            `<text x="${x(i)}" y="${height - 8}" text-anchor="middle"` +
            ` font-size="11" fill="${colors.muted}">${escape(label)}</text>`
        );
    });

    for (const s of series) {
        const path = s.values.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ");
        parts.push(
            `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="2"` +
            ` stroke-linejoin="round" stroke-linecap="round"/>`
        );

        // 끝점만 표시합니다. 모든 점에 숫자를 붙이면 읽히지 않습니다.
        const last = s.values.length - 1;
        parts.push(
            `<circle cx="${x(last)}" cy="${y(s.values[last])}" r="4.5"` +
            ` fill="${s.color}" stroke="${colors.surface}" stroke-width="2"/>`,
            `<text x="${x(last) + 10}" y="${y(s.values[last]) + 4}"` +
            ` font-size="11" fill="${colors.secondary}"` +
            ` style="font-variant-numeric:tabular-nums">${fmt(s.values[last])}</text>`
        );
    }

    // 기준선
    parts.push(
        `<line x1="${pad.left}" y1="${pad.top + plotH}" x2="${pad.left + plotW}"` +
        ` y2="${pad.top + plotH}" stroke="${colors.base}" stroke-width="1"/>`
    );

    // 마우스를 올린 위치의 세로선 (기본은 숨김)
    parts.push(
        `<line class="crosshair" y1="${pad.top}" y2="${pad.top + plotH}"` +
        ` stroke="${colors.base}" stroke-width="1" opacity="0"/>`
    );
    parts.push(`<rect x="${pad.left}" y="${pad.top}" width="${plotW}" height="${plotH}" fill="transparent"/>`);

    // outerHTML 로 바꾸면 id·class 가 사라집니다. 내용만 갈아끼웁니다.
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("height", String(height));
    svg.innerHTML = parts.join("");
    hookLineHover(svg, { xLabels, series, x, pad, plotW, plotH, fmtFull });
}

function hookLineHover(svg, { xLabels, series, x, pad, plotW, plotH, fmtFull = wonFull }) {
    if (!svg) return;
    const crosshair = svg.querySelector(".crosshair");

    svg.addEventListener("mousemove", (event) => {
        const box = svg.getBoundingClientRect();
        const scale = box.width / (svg.viewBox.baseVal.width || box.width);
        const px = (event.clientX - box.left) / scale;
        if (px < pad.left - 8 || px > pad.left + plotW + 8) return hideTip();

        let best = 0, bestDist = Infinity;
        xLabels.forEach((_, i) => {
            const dist = Math.abs(x(i) - px);
            if (dist < bestDist) { bestDist = dist; best = i; }
        });

        crosshair.setAttribute("x1", x(best));
        crosshair.setAttribute("x2", x(best));
        crosshair.setAttribute("opacity", "1");

        showTip(event, `<strong>${escape(xLabels[best])}</strong>` +
            series.map((s) =>
                `<div class="row"><i style="background:${s.color}"></i>` +
                `${escape(s.name)} ${fmtFull(s.values[best])}</div>`).join(""));
    });

    svg.addEventListener("mouseleave", () => {
        crosshair.setAttribute("opacity", "0");
        hideTip();
    });
}

// ---- 막대 그래프 -------------------------------------------------------

export function drawBars(svg, { rows, color, horizontal, colors, unit = "",
                        unitSuffix = "" }) {
    // unitSuffix 가 있으면 값 표기를 그대로 쓰고(예: 34.0%), 없으면 원화로 줄입니다.
    const fmt = unitSuffix ? (v) => `${v}${unitSuffix}` : won;
    const width = svg.clientWidth || 480;
    const max = Math.max(1, ...rows.map((r) => r.value));

    const parts = [];
    let height;

    if (horizontal) {
        const rowH = 26;                 // 막대 24px + 간격 2px
        const pad = { top: 6, right: 74, bottom: 6, left: 118 };
        height = pad.top + pad.bottom + rows.length * rowH;
        const plotW = Math.max(10, width - pad.left - pad.right);

        rows.forEach((row, i) => {
            const top = pad.top + i * rowH;
            const barW = Math.max(2, (plotW * row.value) / max);
            parts.push(
                // 막대 끝만 둥글게, 기준선 쪽은 각지게
                `<path d="${roundedRight(pad.left, top, barW, 24, 4)}" fill="${color}"` +
                ` data-tip="${escape(row.label)}|${row.value}"` +
                (unitSuffix ? ` data-suffix="${escape(unitSuffix)}"` : "") + "/>",
                `<text x="${pad.left - 8}" y="${top + 16}" text-anchor="end"` +
                ` font-size="12" fill="${colors.secondary}">${escape(clip(row.label, 12))}</text>`,
                `<text x="${pad.left + barW + 8}" y="${top + 16}" font-size="11"` +
                ` fill="${colors.secondary}" style="font-variant-numeric:tabular-nums">` +
                `${fmt(row.value)}</text>`
            );
        });
    } else {
        height = 240;
        const pad = { top: 20, right: 8, bottom: 28, left: 56 };
        const plotH = height - pad.top - pad.bottom;
        const plotW = Math.max(10, width - pad.left - pad.right);
        const slot = plotW / rows.length;
        const barW = Math.min(24, Math.max(3, slot - 2));   // 슬롯을 꽉 채우지 않습니다

        const ticks = niceTicks(max, 4);
        const top = ticks[ticks.length - 1];
        const y = (v) => pad.top + plotH - (plotH * v) / top;

        for (const t of ticks) {
            parts.push(
                `<line x1="${pad.left}" y1="${y(t)}" x2="${pad.left + plotW}" y2="${y(t)}"` +
                ` stroke="${colors.grid}" stroke-width="1"/>`,
                `<text x="${pad.left - 8}" y="${y(t) + 4}" text-anchor="end" font-size="11"` +
                ` fill="${colors.muted}" style="font-variant-numeric:tabular-nums">${won(t)}</text>`
            );
        }

        const peak = rows.reduce((a, b) => (b.value > a.value ? b : a), rows[0] || { value: 0 });

        rows.forEach((row, i) => {
            const cx = pad.left + slot * i + slot / 2;
            const h = Math.max(2, plotH * (row.value / top));
            parts.push(
                `<path d="${roundedTop(cx - barW / 2, y(row.value), barW, h, 4)}" fill="${color}"` +
                ` data-tip="${escape(row.label + unit)}|${row.value}"` +
                (unitSuffix ? ` data-suffix="${escape(unitSuffix)}"` : "") + "/>"
            );
            if (rows.length <= 12 || i % Math.ceil(rows.length / 12) === 0) {
                parts.push(
                    `<text x="${cx}" y="${height - 8}" text-anchor="middle" font-size="11"` +
                    ` fill="${colors.muted}">${escape(row.label)}</text>`
                );
            }
            // 최고치 하나만 직접 표시합니다.
            if (row === peak && row.value > 0) {
                parts.push(
                    `<text x="${cx}" y="${y(row.value) - 7}" text-anchor="middle" font-size="11"` +
                    ` fill="${colors.secondary}" style="font-variant-numeric:tabular-nums">` +
                    `${fmt(row.value)}</text>`
                );
            }
        });

        parts.push(
            `<line x1="${pad.left}" y1="${pad.top + plotH}" x2="${pad.left + plotW}"` +
            ` y2="${pad.top + plotH}" stroke="${colors.base}" stroke-width="1"/>`
        );
    }

    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("height", String(height));
    svg.innerHTML = parts.join("");
    hookBarHover(svg);
}

function hookBarHover(svg) {
    if (!svg) return;
    svg.querySelectorAll("[data-tip]").forEach((mark) => {
        mark.style.cursor = "default";
        mark.addEventListener("mousemove", (event) => {
            const [label, value] = mark.dataset.tip.split("|");
            const shown = mark.dataset.suffix
                ? `${value}${mark.dataset.suffix}` : wonFull(value);
            showTip(event, `<strong>${label}</strong><div>${shown}</div>`);
        });
        mark.addEventListener("mouseleave", hideTip);
    });
}

// 막대의 데이터 쪽 끝만 둥글게. 기준선에 닿는 쪽은 각지게 둡니다.
function roundedRight(x, y, w, h, r) {
    const rr = Math.min(r, w, h / 2);
    return `M${x},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr}` +
           ` V${y + h - rr} Q${x + w},${y + h} ${x + w - rr},${y + h} H${x} Z`;
}

function roundedTop(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h);
    return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y}` +
           ` H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}
