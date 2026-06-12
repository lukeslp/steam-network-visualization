/**
 * Steam Universe — Multi-Mode Chord Diagram
 *
 * Mode 1 (Genres): Co-review connections between game genres
 * Mode 2 (Top Games): Network edges between the 50 most-reviewed games
 * Mode 3 (Eras): Cross-era connections between time periods
 *
 * Registers as window._steamViews.chord
 */
(function() {
    'use strict';

    const canvas = document.getElementById('canvas-chord');
    let ctx = canvas.getContext('2d');
    let width, height, dpr;
    let unbindHover = null;
    let chordLayout = null;
    let labels = [];
    let colors = [];
    let matrix = null;
    let totals = [];
    let hoveredArc = null;
    let hoveredChord = null;
    let active = false;
    let chordMode = 'genre'; // 'genre' | 'games' | 'eras'
    let fadeProgress = 1; // 0 to 1 for mode transition animation
    let fadeTimer = null;

    // Mode pills geometry for hit testing
    let modePills = [];

    // Era definitions
    const ERAS = [
        { name: 'Early', range: [2005, 2010], color: '#60a5fa' },
        { name: 'Growth', range: [2011, 2015], color: '#4ade80' },
        { name: 'Boom', range: [2016, 2020], color: '#fbbf24' },
        { name: 'Modern', range: [2021, 2025], color: '#f472b6' },
    ];

    // ── Mode 1: Genre Flow ──
    function computeGenreMatrix() {
        const data = window._steamData;
        if (!data) return;

        const { netData, genreNames } = data;
        const filterActive = data.filterActive();
        const gamePassesFilter = data.gamePassesFilter;

        const maxGenres = Math.min(14, genreNames.length);
        labels = genreNames.slice(0, maxGenres);
        colors = SteamViz.GENRE_PALETTE.slice(0, maxGenres);

        const n = maxGenres;
        const m = Array.from({ length: n }, () => new Float64Array(n));

        const nodes = netData.nodes;
        for (const link of netData.links) {
            const sNode = nodes[link.source];
            const tNode = nodes[link.target];
            if (!sNode || !tNode) continue;

            const sGame = sNode._game;
            const tGame = tNode._game;
            if (!sGame || !tGame) continue;
            if (filterActive && (!gamePassesFilter(sGame) || !gamePassesFilter(tGame))) continue;

            const sGenres = sGame[6] || [];
            const tGenres = tGame[6] || [];
            const w = Math.log(link.weight + 1);

            for (const sg of sGenres) {
                if (sg >= n) continue;
                for (const tg of tGenres) {
                    if (tg >= n) continue;
                    m[sg][tg] += w;
                    if (sg !== tg) m[tg][sg] += w;
                }
            }
        }

        matrix = m;
        totals = new Array(n).fill(0);
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                totals[i] += m[i][j];
            }
        }
    }

    // ── Mode 2: Top 1000 Games (clustered by genre) ──
    function computeGamesMatrix() {
        const data = window._steamData;
        if (!data) return;

        const { netData, allGames, genreNames } = data;
        const filterActive = data.filterActive();
        const gamePassesFilter = data.gamePassesFilter;

        // Get top 1000 games by review count
        let filtered = allGames.filter(g => !filterActive || gamePassesFilter(g));
        filtered.sort((a, b) => (b[3] || 0) - (a[3] || 0));
        const top1000 = filtered.slice(0, 1000);

        // Build a Set of top game names for fast lookup
        const topGameNames = new Set(top1000.map(g => g[0]));

        // Cluster by primary genre (first genre index)
        const maxGenres = Math.min(14, genreNames.length);
        labels = genreNames.slice(0, maxGenres).map((name, i) => {
            const count = top1000.filter(g => (g[6] || [])[0] === i).length;
            return `${name} (${count})`;
        });

        // Use genre palette colors
        colors = SteamViz.GENRE_PALETTE.slice(0, maxGenres);

        const n = maxGenres;
        const m = Array.from({ length: n }, () => new Float64Array(n));

        // Map top-1000 game titles to their primary genre index
        const titleToGenre = new Map();
        for (const g of top1000) {
            const genres = g[6] || [];
            const primary = genres[0];
            if (primary !== undefined && primary < n) {
                titleToGenre.set(g[0], primary);
            }
        }

        // Map network node names to genre indices
        const nodeToGenre = new Map();
        for (const node of netData.nodes) {
            if (!node._game) continue;
            const gi = titleToGenre.get(node._game[0]);
            if (gi !== undefined) nodeToGenre.set(node.name, gi);
        }

        // Accumulate edge weights between genre clusters (only for top-1000 games)
        for (const link of netData.links) {
            const sNode = netData.nodes[link.source];
            const tNode = netData.nodes[link.target];
            if (!sNode || !tNode) continue;

            const si = nodeToGenre.get(sNode.name);
            const ti = nodeToGenre.get(tNode.name);
            if (si === undefined || ti === undefined) continue;

            const w = Math.log(link.weight + 1);
            m[si][ti] += w;
            if (si !== ti) m[ti][si] += w;
        }

        matrix = m;
        totals = new Array(n).fill(0);
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                totals[i] += m[i][j];
            }
        }
    }

    // ── Mode 3: Era Connections ──
    function computeEraMatrix() {
        const data = window._steamData;
        if (!data) return;

        const { netData } = data;
        const filterActive = data.filterActive();
        const gamePassesFilter = data.gamePassesFilter;

        labels = ERAS.map(e => e.name);
        colors = ERAS.map(e => e.color);

        const n = ERAS.length;
        const m = Array.from({ length: n }, () => new Float64Array(n));

        function getEraIdx(year) {
            for (let i = 0; i < ERAS.length; i++) {
                if (year >= ERAS[i].range[0] && year <= ERAS[i].range[1]) {
                    return i;
                }
            }
            return -1;
        }

        const nodes = netData.nodes;
        for (const link of netData.links) {
            const sNode = nodes[link.source];
            const tNode = nodes[link.target];
            if (!sNode || !tNode) continue;

            const sGame = sNode._game;
            const tGame = tNode._game;
            if (!sGame || !tGame) continue;
            if (filterActive && (!gamePassesFilter(sGame) || !gamePassesFilter(tGame))) continue;

            const sYear = sGame[1];
            const tYear = tGame[1];
            const si = getEraIdx(sYear);
            const ti = getEraIdx(tYear);
            if (si === -1 || ti === -1) continue;

            const w = Math.log(link.weight + 1);
            m[si][ti] += w;
            if (si !== ti) m[ti][si] += w;
        }

        matrix = m;
        totals = new Array(n).fill(0);
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                totals[i] += m[i][j];
            }
        }
    }

    function computeMatrix() {
        if (chordMode === 'genre') {
            computeGenreMatrix();
        } else if (chordMode === 'games') {
            computeGamesMatrix();
        } else if (chordMode === 'eras') {
            computeEraMatrix();
        }
    }

    function computeChordLayout() {
        if (!matrix) return;

        const chord = d3.chord()
            .padAngle(0.04)
            .sortSubgroups(d3.descending)
            .sortChords(d3.descending);

        chordLayout = chord(matrix);
    }

    function resize() {
        const s = SteamViz.setupCanvas(canvas);
        ctx = s.ctx;
        width = s.width;
        height = s.height;
        dpr = s.dpr;
    }

    function render() {
        if (!active || !chordLayout) return;

        ctx.clearRect(0, 0, width, height);
        ctx.save();

        const { cx, cy, outerR, innerR } = getChordGeometry();
        const labelR = outerR + 14;

        // ── Draw mode pills at top ──
        drawModePills();

        ctx.translate(cx, cy);

        // Apply fade for mode transitions
        ctx.globalAlpha = fadeProgress;

        // ── Draw chords (ribbons) ──
        for (const chord of chordLayout) {
            const si = chord.source.index;
            const ti = chord.target.index;
            const isHovered = hoveredArc !== null && (hoveredArc === si || hoveredArc === ti);
            const isDimmed = hoveredArc !== null && !isHovered;
            const isChordHovered = hoveredChord &&
                ((hoveredChord[0] === si && hoveredChord[1] === ti) ||
                 (hoveredChord[0] === ti && hoveredChord[1] === si));

            const baseAlpha = fadeProgress * (isChordHovered ? 0.85 : isHovered ? 0.6 : isDimmed ? 0.04 : 0.25);
            ctx.globalAlpha = baseAlpha;

            const color = isChordHovered || isHovered
                ? colors[si === hoveredArc ? si : ti]
                : blendColor(colors[si], colors[ti]);

            ctx.fillStyle = color;
            ctx.beginPath();
            drawRibbon(ctx, chord, innerR);
            ctx.fill();
        }

        // ── Draw arcs ──
        for (const group of chordLayout.groups) {
            const i = group.index;
            const isHovered = hoveredArc === i;
            const isDimmed = hoveredArc !== null && !isHovered;

            ctx.globalAlpha = fadeProgress * (isDimmed ? 0.3 : 1);
            ctx.fillStyle = colors[i];
            ctx.beginPath();
            ctx.arc(0, 0, outerR, group.startAngle - Math.PI / 2, group.endAngle - Math.PI / 2);
            ctx.arc(0, 0, innerR, group.endAngle - Math.PI / 2, group.startAngle - Math.PI / 2, true);
            ctx.closePath();
            ctx.fill();

            // Highlight border
            if (isHovered) {
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 2;
                ctx.stroke();
            }
        }

        ctx.globalAlpha = fadeProgress;

        // ── Labels ──
        ctx.fillStyle = '#ccc';
        const labelFont = chordMode === 'games' ? '10px -apple-system, sans-serif' : '12px -apple-system, sans-serif';
        ctx.font = labelFont;
        ctx.textBaseline = 'middle';

        for (const group of chordLayout.groups) {
            const i = group.index;
            const angle = (group.startAngle + group.endAngle) / 2 - Math.PI / 2;
            const x = Math.cos(angle) * labelR;
            const y = Math.sin(angle) * labelR;

            ctx.save();
            ctx.translate(x, y);

            let textAngle = angle;
            if (textAngle > Math.PI / 2) textAngle -= Math.PI;
            if (textAngle < -Math.PI / 2) textAngle += Math.PI;

            ctx.rotate(textAngle);
            ctx.textAlign = (angle > -Math.PI / 2 && angle < Math.PI / 2) ? 'left' : 'right';

            const isDimmed = hoveredArc !== null && hoveredArc !== i;
            ctx.globalAlpha = fadeProgress * (isDimmed ? 0.3 : 1);
            ctx.fillStyle = hoveredArc === i ? '#fff' : '#aaa';
            ctx.font = hoveredArc === i ? `bold ${chordMode === 'games' ? '11px' : '13px'} -apple-system, sans-serif` : labelFont;
            ctx.fillText(labels[i], 0, 0);
            ctx.restore();
        }

        ctx.globalAlpha = fadeProgress;

        // ── Hover tooltip ──
        if (hoveredArc !== null) {
            const pct = ((totals[hoveredArc] / totals.reduce((a, b) => a + b, 0)) * 100).toFixed(1);
            const subtitle = chordMode === 'genre'
                ? `${pct}% of cross-genre connections`
                : chordMode === 'games'
                ? `${pct}% of top 1000 game connections`
                : `${pct}% of cross-era connections`;
            drawTooltip(ctx, 0, outerR + 50, labels[hoveredArc], subtitle);
        }

        if (hoveredChord) {
            const [si, ti] = hoveredChord;
            const val = matrix[si][ti];
            const totalVal = totals.reduce((a, b) => a + b, 0);
            const pct = ((val / totalVal) * 100).toFixed(1);
            drawTooltip(ctx, 0, -outerR - 40,
                `${labels[si]} ↔ ${labels[ti]}`,
                `${pct}% of connections`
            );
        }

        ctx.restore();
    }

    function drawModePills() {
        const modes = [
            { id: 'genre', label: 'Genres' },
            { id: 'games', label: 'Top 1000' },
            { id: 'eras', label: 'Eras' },
        ];

        const pillW = 100;
        const pillH = 32;
        const gap = 8;
        const totalW = modes.length * pillW + (modes.length - 1) * gap;
        let x = (width - totalW) / 2;
        const y = 60;

        modePills = [];

        ctx.font = '13px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        for (const mode of modes) {
            const isActive = chordMode === mode.id;

            // Background
            ctx.fillStyle = isActive ? 'rgba(100, 100, 100, 0.4)' : 'rgba(50, 50, 50, 0.3)';
            ctx.strokeStyle = isActive ? '#777' : '#444';
            ctx.lineWidth = 1;
            SteamViz.roundRect(ctx, x, y, pillW, pillH, 6);
            ctx.fill();
            ctx.stroke();

            // Text
            ctx.fillStyle = isActive ? '#fff' : '#999';
            ctx.fillText(mode.label, x + pillW / 2, y + pillH / 2);

            modePills.push({ id: mode.id, x, y, w: pillW, h: pillH });
            x += pillW + gap;
        }
    }

    function drawRibbon(ctx, chord, radius) {
        const s = chord.source;
        const t = chord.target;
        const halfPi = Math.PI / 2;

        const sa0 = s.startAngle - halfPi;
        const sa1 = s.endAngle - halfPi;
        const ta0 = t.startAngle - halfPi;
        const ta1 = t.endAngle - halfPi;

        ctx.moveTo(Math.cos(sa0) * radius, Math.sin(sa0) * radius);
        ctx.arc(0, 0, radius, sa0, sa1);
        ctx.quadraticCurveTo(0, 0, Math.cos(ta0) * radius, Math.sin(ta0) * radius);
        ctx.arc(0, 0, radius, ta0, ta1);
        ctx.quadraticCurveTo(0, 0, Math.cos(sa0) * radius, Math.sin(sa0) * radius);
        ctx.closePath();
    }

    function drawTooltip(ctx, x, y, title, subtitle) {
        ctx.font = 'bold 13px -apple-system, sans-serif';
        const tw1 = ctx.measureText(title).width;
        ctx.font = '11px -apple-system, sans-serif';
        const tw2 = ctx.measureText(subtitle).width;
        const tw = Math.max(tw1, tw2);
        const pad = 10;
        const h = 40;

        ctx.fillStyle = 'rgba(10, 10, 10, 0.9)';
        ctx.strokeStyle = '#444';
        ctx.lineWidth = 1;
        const rx = x - tw / 2 - pad;
        const ry = y - h / 2;
        SteamViz.roundRect(ctx, rx, ry, tw + pad * 2, h, 6);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 13px -apple-system, sans-serif';
        ctx.fillText(title, x, y - 8);
        ctx.font = '11px -apple-system, sans-serif';
        ctx.fillStyle = '#888';
        ctx.fillText(subtitle, x, y + 10);
    }

    function blendColor(c1, c2) {
        const d3c1 = d3.color(c1);
        const d3c2 = d3.color(c2);
        if (!d3c1 || !d3c2) return c1;
        return d3.interpolateRgb(c1, c2)(0.5);
    }

    function getChordGeometry() {
        const cx = width / 2;
        const cy = height / 2 + 30;
        const availH = height - 160;
        const outerR = Math.min(width - 80, availH) * 0.42;
        const arcThickness = chordMode === 'eras' ? 30 : chordMode === 'games' ? 12 : 22;
        const innerR = outerR - arcThickness;
        return { cx, cy, outerR, innerR };
    }

    // ── Hit detection ──
    function hitTestPill(mx, my) {
        for (const pill of modePills) {
            if (mx >= pill.x && mx <= pill.x + pill.w &&
                my >= pill.y && my <= pill.y + pill.h) {
                return pill.id;
            }
        }
        return null;
    }

    function hitTestArc(mx, my) {
        if (!chordLayout) return null;
        const { cx, cy, outerR, innerR } = getChordGeometry();
        const dx = mx - cx;
        const dy = my - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < innerR || dist > outerR + 20) return null;

        let angle = Math.atan2(dy, dx) + Math.PI / 2;
        if (angle < 0) angle += Math.PI * 2;

        for (const group of chordLayout.groups) {
            if (angle >= group.startAngle && angle <= group.endAngle) {
                return group.index;
            }
        }
        return null;
    }

    function hitTestChord(mx, my) {
        if (!chordLayout) return null;
        const { cx, cy, innerR } = getChordGeometry();
        const dx = mx - cx;
        const dy = my - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist >= innerR) return null;

        let angle = Math.atan2(dy, dx) + Math.PI / 2;
        if (angle < 0) angle += Math.PI * 2;

        for (const chord of chordLayout) {
            const s = chord.source;
            const t = chord.target;
            if ((angle >= s.startAngle && angle <= s.endAngle) ||
                (angle >= t.startAngle && angle <= t.endAngle)) {
                return [s.index, t.index];
            }
        }
        return null;
    }

    function switchMode(newMode) {
        if (newMode === chordMode) return;

        chordMode = newMode;

        // Fade out → recompute → fade in
        fadeProgress = 0;
        if (fadeTimer) clearInterval(fadeTimer);

        // Immediate recompute with invisible state
        computeMatrix();
        computeChordLayout();

        // Fade in over 300ms
        const fadeSteps = 15;
        let step = 0;
        fadeTimer = setInterval(() => {
            step++;
            fadeProgress = step / fadeSteps;
            render();
            if (step >= fadeSteps) {
                clearInterval(fadeTimer);
                fadeTimer = null;
            }
        }, 20);
    }

    // Receives a normalized pointer { x, y } in canvas-relative CSS px
    // (from SteamViz.pointerPos via bindPointerHover) for mouse or touch.
    function onPointerHover(p) {
        const mx = p.x;
        const my = p.y;

        // Check mode pills first
        const pill = hitTestPill(mx, my);
        if (pill) {
            canvas.style.cursor = 'pointer';
            return;
        }

        const arc = hitTestArc(mx, my);
        if (arc !== hoveredArc) {
            hoveredArc = arc;
            hoveredChord = null;
            canvas.style.cursor = arc !== null ? 'pointer' : 'default';
            render();
            return;
        }

        if (arc === null) {
            const chord = hitTestChord(mx, my);
            const changed = !hoveredChord || !chord ||
                hoveredChord[0] !== chord[0] || hoveredChord[1] !== chord[1];
            if (changed) {
                hoveredChord = chord;
                canvas.style.cursor = chord ? 'pointer' : 'default';
                render();
            }
        }
    }

    function onClick(e) {
        const p = SteamViz.pointerPos(canvas, e);
        const pill = hitTestPill(p.x, p.y);
        if (pill) {
            switchMode(pill);
        }
    }

    // Tap (touch) → switch mode if a pill was tapped
    function onTouchEnd(e) {
        const touch = e.changedTouches && e.changedTouches[0];
        if (!touch) return;
        const p = SteamViz.pointerPos(canvas, e);
        const pill = hitTestPill(p.x, p.y);
        if (pill) switchMode(pill);
    }

    function onMouseLeave() {
        hoveredArc = null;
        hoveredChord = null;
        canvas.style.cursor = 'default';
        render();
    }

    function onResize() {
        if (!active) return;
        resize();
        render();
    }

    // ── Public API ──
    window._steamViews = window._steamViews || {};
    window._steamViews.chord = {
        init() {
            resize();
            computeMatrix();
            computeChordLayout();
            canvas.addEventListener('click', onClick);
            canvas.addEventListener('touchend', onTouchEnd);
            canvas.addEventListener('mouseleave', onMouseLeave);
            window.addEventListener('resize', onResize);
        },

        activate() {
            active = true;
            fadeProgress = 1;
            resize();
            computeMatrix();
            computeChordLayout();
            // Mouse + touch hover (bindPointerHover adds mousemove,
            // touchstart, touchmove; touch is preventDefault'd).
            if (unbindHover) unbindHover();
            unbindHover = SteamViz.bindPointerHover(canvas, onPointerHover);
            render();
        },

        deactivate() {
            active = false;
            if (unbindHover) {
                unbindHover();
                unbindHover = null;
            }
        },

        onFilterChange() {
            if (!active) return;
            computeMatrix();
            computeChordLayout();
            render();
        },
    };
})();
