/**
 * Steam Universe — Chord Diagram (Genres & Tags)
 *
 * Mode 1 (Genres): Co-review connections between game genres
 * Mode 2 (Tags): Co-review connections between game tags
 *
 * Registers as window._steamViews.chord
 */
(function() {
    'use strict';

    const canvas = document.getElementById('canvas-chord');
    const ctx = canvas.getContext('2d');
    let width, height, dpr;
    let chordLayout = null;
    let labels = [];
    let colors = [];
    let matrix = null;
    let totals = [];
    let hoveredArc = null;
    let hoveredChord = null;
    let active = false;
    let maxChordValue = 1; // max ribbon weight for log-scaled alpha
    let chordMode = 'genre'; // 'genre' | 'tags' | 'games'
    let fadeProgress = 1; // 0 to 1 for mode transition animation
    let fadeTimer = null;
    let chordTransform = d3.zoomIdentity; // zoom/pan state
    let chordZoom = null;
    let gamesCount = 50; // Number of games to show in games chord
    const GAMES_PRESETS = [25, 50, 100, 250];

    // Mode pills geometry for hit testing
    let modePills = [];
    let countButtons = []; // preset count pills for games mode

    // Steam-themed genre palette — dark blues, accent cyan, warm highlights
    const GENRE_PALETTE = [
        '#66c0f4', '#4fc3f7', '#1b9aaa', '#00bfa5', '#4db6ac',
        '#ff7043', '#ef5350', '#ab47bc', '#7e57c2', '#5c6bc0',
        '#42a5f5', '#26c6da', '#ffca28', '#ffa726', '#8d6e63',
        '#78909c',
    ];

    // OKLCH-inspired micro-variation: subtle perceptual jitter for visual richness
    function oklchVary(hexColor, index) {
        const c = d3.color(hexColor);
        if (!c) return hexColor;
        const hsl = d3.hsl(c);
        // Seeded pseudo-random from index (Knuth multiplicative hash)
        const s1 = ((index * 2654435761) >>> 0) / 4294967296;
        const s2 = ((index * 1597334677) >>> 0) / 4294967296;
        // Subtle shifts: ±5 deg hue, ±0.03 lightness, ±0.04 saturation
        hsl.h = (hsl.h || 0) + (s1 - 0.5) * 10;
        hsl.l = Math.max(0.25, Math.min(0.8, hsl.l + (s2 - 0.5) * 0.06));
        hsl.s = Math.max(0.3, Math.min(1.0, hsl.s + (s1 > 0.6 ? 0.04 : -0.02)));
        return hsl.formatHex();
    }

    // ── Mode 1: Genre Flow ──
    function computeGenreMatrix() {
        const data = window._steamData;
        if (!data) return;

        const { netData, genreNames } = data;
        const filterActive = data.filterActive();
        const gamePassesFilter = data.gamePassesFilter;

        const maxGenres = Math.min(14, genreNames.length);
        labels = genreNames.slice(0, maxGenres);
        colors = GENRE_PALETTE.slice(0, maxGenres).map((c, i) => oklchVary(c, i));

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

    // ── Mode 2: Tag Co-occurrence ──
    function computeTagsMatrix() {
        const data = window._steamData;
        if (!data) return;

        const { netData, tagNames } = data;
        const filterActive = data.filterActive();
        const gamePassesFilter = data.gamePassesFilter;

        const maxTags = Math.min(16, tagNames.length);
        labels = tagNames.slice(0, maxTags);

        // Steam tag palette — neon accents on dark
        const TAG_PALETTE = [
            '#66c0f4', '#ff7043', '#26c6da', '#ef5350',
            '#42a5f5', '#ffca28', '#ab47bc', '#4db6ac',
            '#7e57c2', '#ffa726', '#1b9aaa', '#8d6e63',
            '#5c6bc0', '#00bfa5', '#78909c', '#4fc3f7',
        ];
        colors = TAG_PALETTE.slice(0, maxTags).map((c, i) => oklchVary(c, i + 50));

        const n = maxTags;
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

            const sTags = sGame[7] || [];
            const tTags = tGame[7] || [];
            const w = Math.log(link.weight + 1);

            for (const st of sTags) {
                if (st >= n) continue;
                for (const tt of tTags) {
                    if (tt >= n) continue;
                    m[st][tt] += w;
                    if (st !== tt) m[tt][st] += w;
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

    // ── Mode 3: Games Co-review Network ──
    function computeGamesMatrix() {
        const data = window._steamData;
        if (!data || !data.netData) return;

        const { netData, genreNames } = data;
        const filterActive = data.filterActive();
        const gamePassesFilter = data.gamePassesFilter;

        // Get top games from network by review count
        const validNodes = netData.nodes
            .filter(n => n._game && (!filterActive || gamePassesFilter(n._game)))
            .sort((a, b) => (b._game[3] || 0) - (a._game[3] || 0));

        const topN = Math.min(gamesCount, validNodes.length);
        const topNodes = validNodes.slice(0, topN);

        // Create node index map for quick lookup
        const nodeIndexMap = new Map();
        topNodes.forEach((node, idx) => {
            nodeIndexMap.set(netData.nodes.indexOf(node), idx);
        });

        // Labels and colors
        labels = topNodes.map(n => {
            const name = n._game[0];
            return name.length > 22 ? name.slice(0, 20) + '\u2026' : name;
        });

        // Steam-tinted hues with OKLCH micro-variation
        const GAME_HUES = [200, 190, 175, 210, 15, 350, 260, 165, 30, 230, 145, 340, 280, 50, 195];
        colors = topNodes.map((n, i) => {
            const hue = GAME_HUES[i % GAME_HUES.length];
            const sat = 0.6 + (i % 3) * 0.1;
            const lum = 0.5 + (i % 4) * 0.04;
            const base = d3.hsl(hue, sat, lum).formatHex();
            return oklchVary(base, i + 100);
        });

        // Build matrix
        const n = topN;
        const m = Array.from({ length: n }, () => new Float64Array(n));

        for (const link of netData.links) {
            const si = nodeIndexMap.get(link.source);
            const ti = nodeIndexMap.get(link.target);
            if (si !== undefined && ti !== undefined) {
                const w = link.weight;
                m[si][ti] += w;
                m[ti][si] += w;
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

    function computeMatrix() {
        if (chordMode === 'genre') {
            computeGenreMatrix();
        } else if (chordMode === 'tags') {
            computeTagsMatrix();
        } else if (chordMode === 'games') {
            computeGamesMatrix();
        }
    }

    function computeChordLayout() {
        if (!matrix) return;

        const chord = d3.chord()
            .padAngle(chordMode === 'games' ? 0.01 : 0.04)
            .sortSubgroups(d3.descending)
            .sortChords(d3.descending);

        chordLayout = chord(matrix);

        // Compute max chord value for log-scaled ribbon alpha
        maxChordValue = 1;
        for (const c of chordLayout) {
            const v = c.source.value;
            if (v > maxChordValue) maxChordValue = v;
        }
    }

    function resize() {
        dpr = window.devicePixelRatio || 1;
        width = window.innerWidth;
        height = window.innerHeight;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function render() {
        if (!active || !chordLayout) return;

        ctx.clearRect(0, 0, width, height);
        ctx.save();

        const { cx, cy, outerR, innerR } = getChordGeometry();
        const labelR = outerR + (chordMode === 'games' ? 8 : 14);

        // ── Draw mode pills at top (not zoomed) ──
        drawModePills();

        // Apply zoom transform then translate to center
        ctx.translate(chordTransform.x, chordTransform.y);
        ctx.scale(chordTransform.k, chordTransform.k);
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

            const gamesMode = chordMode === 'games';
            // Log-scaled weight factor: stronger connections get higher opacity
            const weightT = Math.log(chord.source.value + 1) / Math.log(maxChordValue + 1);
            const weightAlpha = 0.4 + 0.6 * weightT; // range [0.4, 1.0]
            const rawAlpha = isChordHovered ? 0.85 : isHovered ? 0.6 : isDimmed ? 0.02 : (gamesMode ? 0.12 : 0.25);
            const baseAlpha = fadeProgress * rawAlpha * (isDimmed || isChordHovered || isHovered ? 1 : weightAlpha);
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

            // Highlight border — Steam accent blue
            if (isHovered) {
                ctx.strokeStyle = '#66c0f4';
                ctx.lineWidth = 2;
                ctx.stroke();
            }
        }

        ctx.globalAlpha = fadeProgress;

        // ── Labels (zoom-compensated so they stay readable) ──
        const isGames = chordMode === 'games';
        ctx.fillStyle = '#ccc';
        const baseFontSize = isGames ? 8 : 12;
        const fontSize = baseFontSize / chordTransform.k; // compensate for zoom scale
        const labelFont = `${fontSize}px -apple-system, sans-serif`;
        ctx.font = labelFont;
        ctx.textBaseline = 'middle';

        // In games mode, show labels based on zoom level + hover
        const gamesConnected = new Set();
        if (isGames && hoveredArc !== null) {
            gamesConnected.add(hoveredArc);
            for (const chord of chordLayout) {
                if (chord.source.index === hoveredArc) gamesConnected.add(chord.target.index);
                if (chord.target.index === hoveredArc) gamesConnected.add(chord.source.index);
            }
        }

        // Zoom-based label visibility: show top N labels proportional to zoom
        const zk = chordTransform.k;
        const gamesZoomLabels = isGames && hoveredArc === null && zk >= 1.3;
        const gamesMaxLabels = gamesZoomLabels ? Math.min(labels.length, Math.floor(10 + (zk - 1.3) * 30)) : 0;

        for (const group of chordLayout.groups) {
            const i = group.index;

            // In games mode, skip labels unless: hovered/connected, or zoomed in enough
            if (isGames && hoveredArc === null && !gamesZoomLabels) continue;
            if (isGames && hoveredArc === null && gamesZoomLabels && i >= gamesMaxLabels) continue;
            if (isGames && hoveredArc !== null && !gamesConnected.has(i)) continue;

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
            const hoverFontSize = (isGames ? 9 : 13) / chordTransform.k;
            ctx.font = hoveredArc === i
                ? `bold ${hoverFontSize}px -apple-system, sans-serif`
                : labelFont;
            ctx.fillText(labels[i], 0, 0);
            ctx.restore();
        }

        ctx.globalAlpha = fadeProgress;

        // ── Hover tooltip ──
        if (hoveredArc !== null) {
            const pct = ((totals[hoveredArc] / totals.reduce((a, b) => a + b, 0)) * 100).toFixed(1);
            let subtitle;
            if (chordMode === 'genre') subtitle = `${pct}% of cross-genre connections`;
            else if (chordMode === 'tags') subtitle = `${pct}% of cross-tag connections`;
            else subtitle = `${pct}% of game connections`;
            drawTooltip(ctx, 0, outerR + 50, labels[hoveredArc], subtitle);
        }

        if (hoveredChord) {
            const [si, ti] = hoveredChord;
            const val = matrix[si][ti];
            const totalVal = totals.reduce((a, b) => a + b, 0);
            const pct = ((val / totalVal) * 100).toFixed(1);
            const subtitle = chordMode === 'games'
                ? `${Math.round(val)} shared reviewers`
                : `${pct}% of connections`;
            drawTooltip(ctx, 0, -outerR - 40,
                `${labels[si]} \u2194 ${labels[ti]}`,
                subtitle
            );
        }

        ctx.restore();
    }

    function drawModePills() {
        const modes = [
            { id: 'genre', label: 'Genres' },
            { id: 'tags', label: 'Tags' },
            { id: 'games', label: 'Games' },
        ];

        const pillW = 100;
        const pillH = 32;
        const gap = 8;
        const totalW = modes.length * pillW + (modes.length - 1) * gap;
        let x = (width - totalW) / 2;
        const y = height - 60;

        modePills = [];
        countButtons = [];

        ctx.font = '13px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        for (const mode of modes) {
            const isActive = chordMode === mode.id;

            // Background — Steam dark blue tint for active
            ctx.fillStyle = isActive ? 'rgba(27, 40, 56, 0.7)' : 'rgba(30, 30, 30, 0.4)';
            ctx.strokeStyle = isActive ? '#66c0f4' : '#444';
            ctx.lineWidth = 1;
            roundRect(ctx, x, y, pillW, pillH, 6);
            ctx.fill();
            ctx.stroke();

            // Text
            ctx.fillStyle = isActive ? '#66c0f4' : '#999';
            ctx.fillText(mode.label, x + pillW / 2, y + pillH / 2);

            modePills.push({ id: mode.id, x, y, w: pillW, h: pillH });
            x += pillW + gap;
        }

        // ── Game count preset pills (shown only in games mode) ──
        if (chordMode === 'games') {
            const ctrlY = y - 40;
            const presetW = 52;
            const presetH = 26;
            const presetGap = 6;
            const presetTotalW = GAMES_PRESETS.length * presetW + (GAMES_PRESETS.length - 1) * presetGap;
            let px = (width - presetTotalW) / 2;

            ctx.font = '12px -apple-system, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            for (const preset of GAMES_PRESETS) {
                const isActive = gamesCount === preset;
                ctx.fillStyle = isActive ? 'rgba(27, 40, 56, 0.7)' : 'rgba(30, 30, 30, 0.4)';
                ctx.strokeStyle = isActive ? '#66c0f4' : '#444';
                ctx.lineWidth = 1;
                roundRect(ctx, px, ctrlY, presetW, presetH, 4);
                ctx.fill();
                ctx.stroke();

                ctx.fillStyle = isActive ? '#66c0f4' : '#999';
                ctx.fillText(preset.toString(), px + presetW / 2, ctrlY + presetH / 2);

                countButtons.push({ id: preset, x: px, y: ctrlY, w: presetW, h: presetH });
                px += presetW + presetGap;
            }
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
        // Zoom-compensate tooltip so it stays readable at any zoom level
        const s = 1 / chordTransform.k;
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(s, s);

        ctx.font = 'bold 13px -apple-system, sans-serif';
        const tw1 = ctx.measureText(title).width;
        ctx.font = '11px -apple-system, sans-serif';
        const tw2 = ctx.measureText(subtitle).width;
        const tw = Math.max(tw1, tw2);
        const pad = 10;
        const h = 40;

        ctx.fillStyle = 'rgba(21, 32, 43, 0.95)';
        ctx.strokeStyle = '#66c0f4';
        ctx.lineWidth = 1;
        const rx = -tw / 2 - pad;
        const ry = -h / 2;
        roundRect(ctx, rx, ry, tw + pad * 2, h, 6);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 13px -apple-system, sans-serif';
        ctx.fillText(title, 0, -8);
        ctx.font = '11px -apple-system, sans-serif';
        ctx.fillStyle = '#888';
        ctx.fillText(subtitle, 0, 10);

        ctx.restore();
    }

    function roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    function blendColor(c1, c2) {
        const d3c1 = d3.color(c1);
        const d3c2 = d3.color(c2);
        if (!d3c1 || !d3c2) return c1;
        return d3.interpolateRgb(c1, c2)(0.5);
    }

    function getChordGeometry() {
        const cx = width / 2;
        const cy = height / 2 + 20;
        const availH = height - 120;
        const isGames = chordMode === 'games';
        // Games mode: fill ~90% so arcs barely fit in frame
        const outerR = Math.min(width - 20, availH) * (isGames ? 0.48 : 0.42);
        const arcThickness = isGames ? 14 : (chordMode === 'tags' ? 18 : 22);
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

    function hitTestCountBtn(mx, my) {
        for (const btn of countButtons) {
            if (mx >= btn.x && mx <= btn.x + btn.w &&
                my >= btn.y && my <= btn.y + btn.h) {
                return btn.id;
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
        resetZoom();

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

    // Inverse-transform screen coords through zoom to get chord-space coords
    function screenToChord(sx, sy) {
        return [(sx - chordTransform.x) / chordTransform.k, (sy - chordTransform.y) / chordTransform.k];
    }

    function onMouseMove(e) {
        const rect = canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;

        // Check mode pills and count buttons first (in screen space, not zoomed)
        const pill = hitTestPill(sx, sy);
        const countBtn = hitTestCountBtn(sx, sy);
        if (pill || countBtn) {
            canvas.style.cursor = 'pointer';
            return;
        }

        // Transform to chord space for arc/chord hit detection
        const [mx, my] = screenToChord(sx, sy);

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
        const rect = canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;

        // Count preset buttons (screen space)
        const countBtn = hitTestCountBtn(sx, sy);
        if (countBtn !== null) {
            gamesCount = countBtn;
            computeMatrix();
            computeChordLayout();
            hoveredArc = null;
            hoveredChord = null;
            render();
            return;
        }

        // Pills are in screen space
        const pill = hitTestPill(sx, sy);
        if (pill) {
            switchMode(pill);
        }
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

    function initZoom() {
        chordZoom = d3.zoom()
            .scaleExtent([0.5, 6])
            .on('zoom', (event) => {
                chordTransform = event.transform;
                render();
            });
        d3.select(canvas).call(chordZoom)
            .on('dblclick.zoom', null); // Disable double-click zoom
    }

    // Reset zoom on mode switch
    function resetZoom() {
        chordTransform = d3.zoomIdentity;
        if (chordZoom) {
            d3.select(canvas).call(chordZoom.transform, d3.zoomIdentity);
        }
    }

    // ── Public API ──
    window._steamViews = window._steamViews || {};
    window._steamViews.chord = {
        init() {
            resize();
            computeMatrix();
            computeChordLayout();
            initZoom();
            canvas.addEventListener('mousemove', onMouseMove);
            canvas.addEventListener('click', onClick);
            canvas.addEventListener('mouseleave', onMouseLeave);
            window.addEventListener('resize', onResize);

            // Touch: tap for hover/select, pinch-zoom handled by d3.zoom
            canvas.addEventListener('touchstart', (e) => {
                if (e.touches.length !== 1) return;
                const t = e.touches[0];
                const rect = canvas.getBoundingClientRect();
                const sx = t.clientX - rect.left;
                const sy = t.clientY - rect.top;

                // Check count buttons first (screen space)
                const countBtn = hitTestCountBtn(sx, sy);
                if (countBtn !== null) {
                    gamesCount = countBtn;
                    computeMatrix(); computeChordLayout(); hoveredArc = null; hoveredChord = null; render();
                    return;
                }

                // Check pills in screen space
                const pill = hitTestPill(sx, sy);
                if (pill) { switchMode(pill); return; }

                // Check arcs in chord space
                const [mx, my] = screenToChord(sx, sy);
                const arc = hitTestArc(mx, my);
                if (arc !== null) {
                    hoveredArc = hoveredArc === arc ? null : arc;
                    hoveredChord = null;
                    render();
                } else {
                    if (hoveredArc !== null) { hoveredArc = null; hoveredChord = null; render(); }
                }
            }, { passive: true });
        },

        activate() {
            active = true;
            fadeProgress = 1;
            resize();
            computeMatrix();
            computeChordLayout();
            resetZoom();
            render();
        },

        deactivate() {
            active = false;
        },

        onFilterChange() {
            if (!active) return;
            computeMatrix();
            computeChordLayout();
            render();
        },

        exportRender(w, h, mode) {
            const data = window._steamData;
            if (!data || !data.netData) return null;

            // Save current state
            const prevMode = chordMode;
            const prevLabels = labels;
            const prevColors = colors;
            const prevMatrix = matrix;
            const prevTotals = totals;
            const prevLayout = chordLayout;
            const prevMaxChord = maxChordValue;

            // Set export mode
            chordMode = mode || 'genre';
            computeMatrix();
            computeChordLayout();
            if (!chordLayout) {
                // Restore state
                chordMode = prevMode; labels = prevLabels; colors = prevColors;
                matrix = prevMatrix; totals = prevTotals; chordLayout = prevLayout;
                maxChordValue = prevMaxChord;
                return null;
            }

            // Create offscreen canvas
            const c = document.createElement('canvas');
            c.width = w;
            c.height = h;
            const ec = c.getContext('2d');

            // Background
            ec.fillStyle = '#0a0a0a';
            ec.fillRect(0, 0, w, h);

            // Geometry scaled to export canvas
            const fontScale = w / 1920;
            const isGames = chordMode === 'games';
            const cx = w / 2;
            const cy = h / 2;
            const availR = Math.min(w, h) * 0.42;
            const arcThickness = (isGames ? 14 : (chordMode === 'tags' ? 18 : 22)) * fontScale;
            const outerR = availR - (isGames ? 8 : 14) * fontScale; // leave room for labels
            const innerR = outerR - arcThickness;
            const labelR = outerR + (isGames ? 8 : 14) * fontScale;

            ec.save();
            ec.translate(cx, cy);

            // ── Draw ribbons ──
            for (const chord of chordLayout) {
                const si = chord.source.index;
                const ti = chord.target.index;
                const weightT = Math.log(chord.source.value + 1) / Math.log(maxChordValue + 1);
                const weightAlpha = 0.4 + 0.6 * weightT;
                const rawAlpha = isGames ? 0.12 : 0.25;
                ec.globalAlpha = rawAlpha * weightAlpha;
                ec.fillStyle = blendColor(colors[si], colors[ti]);
                ec.beginPath();
                drawRibbon(ec, chord, innerR);
                ec.fill();
            }

            // ── Draw arcs ──
            for (const group of chordLayout.groups) {
                const i = group.index;
                ec.globalAlpha = 1;
                ec.fillStyle = colors[i];
                ec.beginPath();
                ec.arc(0, 0, outerR, group.startAngle - Math.PI / 2, group.endAngle - Math.PI / 2);
                ec.arc(0, 0, innerR, group.endAngle - Math.PI / 2, group.startAngle - Math.PI / 2, true);
                ec.closePath();
                ec.fill();
            }

            // ── Draw labels ──
            ec.globalAlpha = 1;
            const baseFontSize = (isGames ? 8 : 12) * fontScale;
            const labelFont = `${baseFontSize}px -apple-system, sans-serif`;
            ec.font = labelFont;
            ec.textBaseline = 'middle';

            for (const group of chordLayout.groups) {
                const i = group.index;
                const angle = (group.startAngle + group.endAngle) / 2 - Math.PI / 2;
                const x = Math.cos(angle) * labelR;
                const y = Math.sin(angle) * labelR;

                ec.save();
                ec.translate(x, y);

                let textAngle = angle;
                if (textAngle > Math.PI / 2) textAngle -= Math.PI;
                if (textAngle < -Math.PI / 2) textAngle += Math.PI;

                ec.rotate(textAngle);
                ec.textAlign = (angle > -Math.PI / 2 && angle < Math.PI / 2) ? 'left' : 'right';
                ec.fillStyle = '#ccc';
                ec.font = labelFont;
                ec.fillText(labels[i], 0, 0);
                ec.restore();
            }

            ec.restore();

            // Restore original state
            chordMode = prevMode;
            labels = prevLabels;
            colors = prevColors;
            matrix = prevMatrix;
            totals = prevTotals;
            chordLayout = prevLayout;
            maxChordValue = prevMaxChord;

            return c;
        },

        selectGame(game) {
            if (!active) return;
            // Switch to games mode if not already
            if (chordMode !== 'games') {
                switchMode('games');
            }
            // Find the game in the current chord layout labels
            const title = game[0];
            const truncated = title.length > 22 ? title.slice(0, 20) + '\u2026' : title;
            const idx = labels.indexOf(truncated);
            if (idx >= 0) {
                hoveredArc = idx;
                hoveredChord = null;
                render();
            }
        },
    };
})();
