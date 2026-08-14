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

const HEAT_STEPS_LIGHT = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95"];
const HEAT_STEPS_DARK = ["#184f95", "#256abf", "#2a78d6", "#3987e5", "#6da7ec", "#9ec5f4"];

function heatColor(value, max) {
    if (!value || !max) return null;
    const dark = getComputedStyle(document.documentElement)
        .getPropertyValue("--surface-1").trim() === "#1a1a19";
    const steps = dark ? HEAT_STEPS_DARK : HEAT_STEPS_LIGHT;
    const index = Math.min(steps.length - 1,
        Math.floor((value / max) * steps.length));
    return steps[index];
}

// 칸 안 글씨는 배경 밝기에 따라 흰색/검정을 고릅니다. 대비를 항상 확보하려고요.
function inkOn(hex) {
    if (!hex) return "var(--text-muted)";
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return lum > 0.55 ? "#0b0b0b" : "#ffffff";
}

export function renderHeat(container, { rows, cols, get, label, rowLabel = (r) => r }) {
    const max = Math.max(1, ...rows.flatMap((r) => cols.map((cx) => get(r, cx) || 0)));
    const head = cols.map((cx) => `<th>${escape(cx)}</th>`).join("");
    const body = rows.map((r) => {
        const cells = cols.map((cx) => {
            const v = get(r, cx) || 0;
            const bg = heatColor(v, max);
            return `<td class="cell${v ? "" : " empty"}"` +
                (bg ? ` style="background:${bg};color:${inkOn(bg)}"` : "") +
                ` title="${escape(rowLabel(r))} · ${escape(cx)} · ${label(v)}">` +
                `${v ? label(v) : "—"}</td>`;
        }).join("");
        return `<tr><th>${escape(rowLabel(r))}</th>${cells}</tr>`;
    }).join("");

    container.innerHTML =
        `<div class="heat"><table><thead><tr><th></th>${head}</tr></thead>` +
        `<tbody>${body}</tbody></table></div>`;
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
