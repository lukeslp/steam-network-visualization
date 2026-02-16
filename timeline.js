/**
 * timeline.js
 * Timeline: genre share evolution over time (2005-2025)
 * Full-width horizontal scroll, major game launch markers, era annotations
 * Pre-2014 years condensed, 2014+ at full width
 *
 * Registers as window._steamViews.timeline
 */
(function() {
    'use strict';

    const canvas = document.getElementById('canvas-timeline');
    const ctx = canvas.getContext('2d');

    let active = false;
    let width = 0;
    let height = 0;
    let dpr = 1;

    // Data
    let yearData = [];
    let top15Genres = [];
    let stackedData = [];
    let genreColorMap = {};

    // Scales
    let xScale = null;
    let yScale = d3.scaleLinear();

    // Scroll / zoom state — horizontal only
    let scrollX = 0;
    let contentWidth = 0;
    const YEAR_WIDTH_FULL = 250;      // Pixels per year for 2014-2025
    const YEAR_WIDTH_CONDENSED = 60;  // Pixels per year for 2005-2013
    const CONDENSE_BREAK = 2014;      // Year where condensed switches to full
    const PAD_LEFT = 60;
    const PAD_RIGHT = 40;
    const PAD_TOP = 120;  // Increased to clear sidebar controls panel
    const PAD_BOTTOM = 50;

    // Hover
    let hoveredGenre = null;
    let tooltipData = null;
    let frameRequested = false;

    // Drag / momentum scroll
    let isDragging = false;
    let dragStartX = 0;
    let dragStartScrollX = 0;
    let velocity = 0;
    let lastDragX = 0;
    let lastDragTime = 0;
    let momentumFrame = null;

    // ── Major game launch markers (~60 milestones) ──
    const LANDMARKS = [
        // 2005 — Steam's early days
        { year: 2005.9, label: 'Civilization IV', color: '#FFA726' },

        // 2006
        { year: 2006.2, label: 'Oblivion', color: '#66BB6A' },
        { year: 2006.8, label: 'Medieval II: Total War', color: '#AB47BC' },

        // 2007 — The Orange Box era
        { year: 2007.1, label: 'S.T.A.L.K.E.R.', color: '#8D6E63' },
        { year: 2007.6, label: 'BioShock', color: '#42A5F5' },
        { year: 2007.8, label: 'TF2 / Portal / Half-Life 2: Ep 2', color: '#FF7043' },

        // 2008
        { year: 2008.1, label: 'Braid', color: '#FFD54F' },
        { year: 2008.7, label: 'Fallout 3', color: '#66BB6A' },
        { year: 2008.9, label: 'Left 4 Dead', color: '#EF5350' },

        // 2009
        { year: 2009.1, label: 'Torchlight', color: '#FFA726' },
        { year: 2009.9, label: 'Left 4 Dead 2', color: '#EF5350' },

        // 2010
        { year: 2010.1, label: 'Mass Effect 2', color: '#E57373' },
        { year: 2010.5, label: 'Amnesia: The Dark Descent', color: '#78909C' },
        { year: 2010.7, label: 'Civilization V', color: '#FFA726' },
        { year: 2010.9, label: 'Super Meat Boy', color: '#EF5350' },

        // 2011 — The Golden Age begins
        { year: 2011.0, label: 'Portal 2', color: '#42A5F5' },
        { year: 2011.3, label: 'Terraria', color: '#66BB6A' },
        { year: 2011.5, label: 'Bastion', color: '#FFB74D' },
        { year: 2011.9, label: 'Skyrim', color: '#66BB6A' },

        // 2012
        { year: 2012.1, label: 'Dark Souls (PC)', color: '#78909C' },
        { year: 2012.5, label: 'CS:GO', color: '#FFA726' },
        { year: 2012.7, label: 'FTL', color: '#4FC3F7' },
        { year: 2012.8, label: 'XCOM: Enemy Unknown', color: '#66BB6A' },

        // 2013 — Peak classic era
        { year: 2013.1, label: 'Dota 2', color: '#AB47BC' },
        { year: 2013.3, label: 'BioShock Infinite', color: '#42A5F5' },
        { year: 2013.4, label: "Don't Starve", color: '#8D6E63' },
        { year: 2013.6, label: 'Papers, Please', color: '#78909C' },
        { year: 2013.7, label: 'GTA V', color: '#66C0F4' },
        { year: 2013.9, label: 'The Stanley Parable', color: '#FFD54F' },

        // 2014 — Indie golden age
        { year: 2014.1, label: 'Shovel Knight', color: '#42A5F5' },
        { year: 2014.5, label: 'Divinity: Original Sin', color: '#FFA726' },
        { year: 2014.7, label: 'Transistor', color: '#E57373' },

        // 2015 — Blockbuster diversity
        { year: 2015.1, label: 'Cities: Skylines', color: '#4DB6AC' },
        { year: 2015.4, label: 'The Witcher 3', color: '#4DB6AC' },
        { year: 2015.5, label: 'Rocket League', color: '#42A5F5' },
        { year: 2015.7, label: 'Metal Gear Solid V', color: '#78909C' },
        { year: 2015.8, label: 'Undertale', color: '#FFD54F' },
        { year: 2015.9, label: 'Fallout 4', color: '#66BB6A' },

        // 2016 — Genre-bending year
        { year: 2016.1, label: 'Stardew Valley', color: '#66BB6A' },
        { year: 2016.3, label: 'Dark Souls III', color: '#78909C' },
        { year: 2016.4, label: 'DOOM (2016)', color: '#EF5350' },
        { year: 2016.7, label: "No Man's Sky", color: '#4FC3F7' },

        // 2017 — Battle Royale revolution
        { year: 2017.2, label: 'PUBG', color: '#FFD54F' },
        { year: 2017.1, label: 'Hollow Knight', color: '#78909C' },
        { year: 2017.7, label: 'Divinity: Original Sin 2', color: '#FFA726' },
        { year: 2017.8, label: 'Nier: Automata', color: '#BA68C8' },
        { year: 2017.9, label: 'Cuphead', color: '#FF8A65' },

        // 2018
        { year: 2018.0, label: 'Monster Hunter: World', color: '#4FC3F7' },
        { year: 2018.1, label: 'Subnautica', color: '#26C6DA' },
        { year: 2018.4, label: 'Celeste', color: '#E57373' },
        { year: 2018.6, label: 'Dead Cells', color: '#AB47BC' },

        // 2019
        { year: 2019.1, label: 'Sekiro', color: '#81C784' },
        { year: 2019.4, label: 'Outer Wilds', color: '#FFB74D' },
        { year: 2019.8, label: 'Disco Elysium', color: '#BA68C8' },

        // 2020 — Pandemic boom
        { year: 2020.0, label: 'Half-Life: Alyx', color: '#FFA726' },
        { year: 2020.2, label: 'Doom Eternal', color: '#E57373' },
        { year: 2020.6, label: 'Fall Guys', color: '#FFD54F' },
        { year: 2020.8, label: 'Among Us (peak)', color: '#BA68C8' },
        { year: 2020.9, label: 'Hades', color: '#FF7043' },
        { year: 2020.95, label: 'Cyberpunk 2077', color: '#26C6DA' },

        // 2021
        { year: 2021.1, label: 'Valheim', color: '#4DB6AC' },
        { year: 2021.5, label: 'It Takes Two', color: '#FF8A65' },
        { year: 2021.8, label: 'Inscryption', color: '#78909C' },

        // 2022
        { year: 2022.1, label: 'Elden Ring', color: '#FFB74D' },
        { year: 2022.5, label: 'Vampire Survivors', color: '#EF5350' },
        { year: 2022.7, label: 'Stray', color: '#FFA726' },

        // 2023
        { year: 2023.1, label: 'Hogwarts Legacy', color: '#AB47BC' },
        { year: 2023.5, label: "Baldur's Gate 3", color: '#7E57C2' },
        { year: 2023.8, label: 'Lethal Company', color: '#78909C' },
        { year: 2023.9, label: 'Lies of P', color: '#8D6E63' },

        // 2024
        { year: 2024.0, label: 'Palworld', color: '#26C6DA' },
        { year: 2024.1, label: 'Helldivers 2', color: '#FFD54F' },
        { year: 2024.3, label: 'Balatro', color: '#EF5350' },
        { year: 2024.5, label: 'Animal Well', color: '#66BB6A' },
    ];

    // Genre palette (golden angle hues on dark bg)
    function genreColor(i) {
        const hue = (i * 137.508) % 360;
        return `hsl(${hue}, 75%, 55%)`;
    }

    // ── Piecewise x-scale: condensed pre-2014, full post-2014 ──
    function buildXScale() {
        const condensedWidth = (CONDENSE_BREAK - 2005) * YEAR_WIDTH_CONDENSED;
        const fullWidth = (2025 - CONDENSE_BREAK) * YEAR_WIDTH_FULL;
        contentWidth = PAD_LEFT + condensedWidth + fullWidth + PAD_RIGHT;

        // Piecewise linear: [2005, 2014] → condensed, [2014, 2025] → full
        xScale = d3.scaleLinear()
            .domain([2005, CONDENSE_BREAK, 2025])
            .range([
                PAD_LEFT,
                PAD_LEFT + condensedWidth,
                PAD_LEFT + condensedWidth + fullWidth
            ]);
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

        buildXScale();
    }

    function aggregateData() {
        const data = window._steamData;
        if (!data || !data.allGames) return;

        const genreCounts = {};
        data.allGames.forEach(game => {
            (game[6] || []).forEach(idx => {
                const name = data.genreNames[idx];
                if (name) genreCounts[name] = (genreCounts[name] || 0) + 1;
            });
        });

        top15Genres = Object.entries(genreCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 15)
            .map(e => e[0]);

        genreColorMap = {};
        top15Genres.forEach((g, i) => { genreColorMap[g] = genreColor(i); });

        yearData = [];
        for (let year = 2005; year <= 2025; year++) {
            const entry = { year, genres: {} };
            top15Genres.forEach(g => { entry.genres[g] = 0; });
            data.allGames.forEach(game => {
                if (game[1] !== year) return;
                (game[6] || []).forEach(idx => {
                    const name = data.genreNames[idx];
                    if (top15Genres.includes(name)) entry.genres[name]++;
                });
            });
            yearData.push(entry);
        }
    }

    function computeStackedLayout() {
        if (yearData.length === 0 || top15Genres.length === 0) return;

        const stackData = yearData.map(d => {
            const obj = { year: d.year };
            top15Genres.forEach(g => { obj[g] = d.genres[g] || 0; });
            return obj;
        });

        stackedData = d3.stack()
            .keys(top15Genres)
            .order(d3.stackOrderInsideOut)
            .offset(d3.stackOffsetWiggle)(stackData);

        const yExtent = [
            d3.min(stackedData, layer => d3.min(layer, d => d[0])),
            d3.max(stackedData, layer => d3.max(layer, d => d[1]))
        ];

        const chartH = height - PAD_TOP - PAD_BOTTOM;
        yScale = d3.scaleLinear().domain(yExtent).range([PAD_TOP + chartH, PAD_TOP]);
    }

    function scheduleRender() {
        if (!active || frameRequested) return;
        frameRequested = true;
        requestAnimationFrame(() => { frameRequested = false; render(); });
    }

    // Clamp scroll position
    function clampScroll() {
        const maxScroll = 0;
        const minScroll = Math.min(0, width - contentWidth);
        scrollX = Math.max(minScroll, Math.min(maxScroll, scrollX));
    }

    function toViewX(dataX) { return xScale(dataX) + scrollX; }

    // ── Render ──
    function render() {
        if (!active) return;

        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, width, height);

        if (stackedData.length === 0) {
            ctx.fillStyle = '#666';
            ctx.font = '16px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('No data available', width / 2, height / 2);
            return;
        }

        // Draw landmark lines (behind stream layers)
        drawLandmarks();

        // Condensed-zone indicator
        drawCondensedZone();

        // Draw stream layers
        for (const layer of stackedData) {
            drawLayer(layer, layer.key);
        }

        // Draw year axis
        drawXAxis();

        // Draw landmark labels (on top)
        drawLandmarkLabels();

        // Draw floating legend (top-left overlay)
        drawLegend();

        // Tooltip
        if (tooltipData) {
            drawTooltip(tooltipData.x, tooltipData.y, tooltipData.genre, tooltipData.year, tooltipData.count, tooltipData.total);
        }

        // Scroll indicator
        drawScrollIndicator();
    }

    function drawCondensedZone() {
        const x1 = toViewX(2005);
        const x2 = toViewX(CONDENSE_BREAK);
        if (x2 < 0 || x1 > width) return;

        // Subtle indicator that this zone is condensed
        ctx.fillStyle = 'rgba(255, 255, 255, 0.015)';
        ctx.fillRect(Math.max(0, x1), PAD_TOP, Math.min(width, x2) - Math.max(0, x1), height - PAD_TOP - PAD_BOTTOM);
    }

    function drawLayer(layer, genreName) {
        if (layer.length === 0) return;

        const area = d3.area()
            .x(d => toViewX(d.data.year))
            .y0(d => yScale(d[0]))
            .y1(d => yScale(d[1]))
            .curve(d3.curveBasis)
            .context(ctx);

        ctx.beginPath();
        area(layer);

        const alpha = hoveredGenre && hoveredGenre !== genreName ? 0.2 : 0.88;
        const color = genreColorMap[genreName];
        ctx.fillStyle = color.replace('55%)', `55%, ${alpha})`);
        ctx.fill();

        if (hoveredGenre === genreName) {
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }
    }

    function drawXAxis() {
        const axisY = height - PAD_BOTTOM;

        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, axisY);
        ctx.lineTo(width, axisY);
        ctx.stroke();

        ctx.fillStyle = '#888';
        ctx.font = '12px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        for (let year = 2005; year <= 2025; year++) {
            const x = toViewX(year);
            if (x < -20 || x > width + 20) continue;

            // Tick
            ctx.strokeStyle = '#333';
            ctx.beginPath();
            ctx.moveTo(x, axisY);
            ctx.lineTo(x, axisY + 6);
            ctx.stroke();

            // Label — bolder for post-condensed years
            ctx.fillStyle = year >= CONDENSE_BREAK ? '#aaa' : '#666';
            ctx.font = year >= CONDENSE_BREAK ? '12px -apple-system, sans-serif' : '10px -apple-system, sans-serif';
            ctx.fillText(year.toString(), x, axisY + 10);
        }

        // Condensed zone label
        const condensedMidX = toViewX((2005 + CONDENSE_BREAK) / 2);
        if (condensedMidX > -50 && condensedMidX < width + 50) {
            ctx.fillStyle = '#555';
            ctx.font = 'italic 9px -apple-system, sans-serif';
            ctx.fillText('← condensed →', condensedMidX, axisY + 26);
        }
    }

    function drawLandmarks() {
        const axisY = height - PAD_BOTTOM;

        for (const lm of LANDMARKS) {
            const x = toViewX(lm.year);
            if (x < -20 || x > width + 20) continue;

            ctx.strokeStyle = lm.color || '#555';
            ctx.globalAlpha = 0.15;
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(x, PAD_TOP);
            ctx.lineTo(x, axisY);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.globalAlpha = 1;
        }
    }

    function drawLandmarkLabels() {
        const axisY = height - PAD_BOTTOM;

        ctx.textBaseline = 'bottom';

        for (let i = 0; i < LANDMARKS.length; i++) {
            const lm = LANDMARKS[i];
            const x = toViewX(lm.year);
            if (x < -60 || x > width + 60) continue;

            // Stagger labels above the chart to avoid overlap
            const stagger = (i % 4) * 12;
            const labelY = PAD_TOP - 6 - stagger;

            ctx.fillStyle = lm.color || '#888';
            ctx.textAlign = 'center';
            ctx.globalAlpha = 0.8;

            // Shorter labels in condensed zone
            const label = lm.year < CONDENSE_BREAK ? truncateLabel(lm.label, 18) : lm.label;
            ctx.font = lm.year < CONDENSE_BREAK ? '7px -apple-system, sans-serif' : '9px -apple-system, sans-serif';
            ctx.fillText(label, x, labelY);
            ctx.globalAlpha = 1;

            // Small dot at top of chart
            ctx.beginPath();
            ctx.arc(x, PAD_TOP - 2, 2.5, 0, Math.PI * 2);
            ctx.fillStyle = lm.color || '#888';
            ctx.fill();
        }
    }

    function truncateLabel(text, maxLen) {
        return text.length > maxLen ? text.slice(0, maxLen - 1) + '…' : text;
    }

    function drawLegend() {
        // Floating legend in top-left corner
        const lx = 16;
        let ly = PAD_TOP + 10;
        const itemH = 18;
        const boxW = 130;
        const boxH = top15Genres.length * itemH + 16;

        // Background
        ctx.fillStyle = 'rgba(10, 10, 10, 0.85)';
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(lx, ly, boxW, boxH, 6);
        ctx.fill();
        ctx.stroke();

        ly += 8;
        ctx.font = '10px -apple-system, sans-serif';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';

        for (let i = 0; i < top15Genres.length; i++) {
            const genre = top15Genres[i];
            const y = ly + i * itemH + itemH / 2;
            const isHovered = hoveredGenre === genre;
            const isDimmed = hoveredGenre && !isHovered;

            ctx.fillStyle = genreColorMap[genre].replace('55%)', `55%, ${isDimmed ? 0.3 : 1})`);
            ctx.fillRect(lx + 8, y - 5, 10, 10);

            ctx.fillStyle = isDimmed ? '#555' : (isHovered ? '#fff' : '#bbb');
            ctx.fillText(genre, lx + 24, y);
        }
    }

    function drawScrollIndicator() {
        if (contentWidth <= width) return;

        const barW = 120;
        const barH = 3;
        const barX = (width - barW) / 2;
        const barY = height - 12;
        const progress = -scrollX / (contentWidth - width);
        const thumbW = Math.max(20, barW * (width / contentWidth));

        ctx.fillStyle = '#222';
        ctx.fillRect(barX, barY, barW, barH);

        ctx.fillStyle = '#555';
        ctx.fillRect(barX + progress * (barW - thumbW), barY, thumbW, barH);
    }

    function drawTooltip(x, y, genre, year, count, total) {
        const lines = [genre, `Year: ${year}`, `Games: ${count.toLocaleString()}`, `Share: ${((count / total) * 100).toFixed(1)}%`];
        ctx.font = '12px -apple-system, sans-serif';
        const maxW = Math.max(...lines.map(l => ctx.measureText(l).width));
        const pad = 8;
        const lh = 16;
        const bw = maxW + pad * 2;
        const bh = lines.length * lh + pad * 2;

        let tx = x + 15;
        let ty = y - bh - 10;
        if (tx + bw > width - 10) tx = x - bw - 15;
        if (ty < 10) ty = y + 15;

        ctx.fillStyle = 'rgba(15, 15, 15, 0.95)';
        ctx.strokeStyle = '#444';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(tx, ty, bw, bh, 5);
        ctx.fill();
        ctx.stroke();

        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        lines.forEach((line, i) => {
            ctx.fillStyle = i === 0 ? (genreColorMap[genre] || '#fff') : '#ccc';
            ctx.font = i === 0 ? 'bold 12px -apple-system, sans-serif' : '12px -apple-system, sans-serif';
            ctx.fillText(line, tx + pad, ty + pad + i * lh);
        });
    }

    // ── Hover detection ──
    function findHoveredGenre(mx, my) {
        if (stackedData.length === 0 || yearData.length === 0) return null;

        const dataX = xScale.invert(mx - scrollX);
        const yearIdx = Math.round(dataX - 2005);
        if (yearIdx < 0 || yearIdx >= yearData.length) return null;

        const nearestYear = yearData[yearIdx].year;
        const yValue = yScale.invert(my);

        for (let i = stackedData.length - 1; i >= 0; i--) {
            const layer = stackedData[i];
            const point = layer[yearIdx];
            if (!point) continue;
            if (yValue >= point[0] && yValue <= point[1]) {
                const genreName = layer.key;
                const count = point.data[genreName];
                const total = top15Genres.reduce((sum, g) => sum + (point.data[g] || 0), 0);
                return { genre: genreName, year: nearestYear, count, total, x: mx, y: my };
            }
        }
        return null;
    }

    // ── Interaction handlers ──
    function onMouseDown(e) {
        isDragging = true;
        dragStartX = e.clientX;
        dragStartScrollX = scrollX;
        lastDragX = e.clientX;
        lastDragTime = Date.now();
        velocity = 0;
        if (momentumFrame) { cancelAnimationFrame(momentumFrame); momentumFrame = null; }
        canvas.style.cursor = 'grabbing';
    }

    function onMouseMove(e) {
        if (isDragging) {
            const dx = e.clientX - dragStartX;
            scrollX = dragStartScrollX + dx;
            clampScroll();

            const now = Date.now();
            const dt = now - lastDragTime;
            if (dt > 0) velocity = (e.clientX - lastDragX) / dt;
            lastDragX = e.clientX;
            lastDragTime = now;

            scheduleRender();
            return;
        }

        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const prev = hoveredGenre;
        const hover = findHoveredGenre(mx, my);

        if (hover) {
            hoveredGenre = hover.genre;
            tooltipData = hover;
            canvas.style.cursor = 'pointer';
        } else {
            hoveredGenre = null;
            tooltipData = null;
            canvas.style.cursor = 'grab';
        }

        if (prev !== hoveredGenre) scheduleRender();
    }

    function onMouseUp() {
        if (!isDragging) return;
        isDragging = false;
        canvas.style.cursor = 'grab';

        // Momentum scroll
        if (Math.abs(velocity) > 0.1) {
            function momentumStep() {
                velocity *= 0.95;
                if (Math.abs(velocity) < 0.05) { velocity = 0; return; }
                scrollX += velocity * 16;
                clampScroll();
                scheduleRender();
                momentumFrame = requestAnimationFrame(momentumStep);
            }
            momentumFrame = requestAnimationFrame(momentumStep);
        }
    }

    function onMouseLeave() {
        if (isDragging) onMouseUp();
        if (hoveredGenre || tooltipData) {
            hoveredGenre = null;
            tooltipData = null;
            scheduleRender();
        }
    }

    function onWheel(e) {
        e.preventDefault();
        scrollX -= e.deltaX || e.deltaY;
        clampScroll();
        velocity = 0;
        scheduleRender();
    }

    // Touch handlers
    let touchStartX = 0;
    let touchStartScrollX = 0;

    function onTouchStart(e) {
        if (e.touches.length !== 1) return;
        isDragging = true;
        touchStartX = e.touches[0].clientX;
        touchStartScrollX = scrollX;
        lastDragX = touchStartX;
        lastDragTime = Date.now();
        velocity = 0;
        if (momentumFrame) { cancelAnimationFrame(momentumFrame); momentumFrame = null; }
    }

    function onTouchMove(e) {
        if (!isDragging || e.touches.length !== 1) return;
        e.preventDefault();
        const tx = e.touches[0].clientX;
        scrollX = touchStartScrollX + (tx - touchStartX);
        clampScroll();

        const now = Date.now();
        const dt = now - lastDragTime;
        if (dt > 0) velocity = (tx - lastDragX) / dt;
        lastDragX = tx;
        lastDragTime = now;

        scheduleRender();
    }

    function onTouchEnd() {
        isDragging = false;
        if (Math.abs(velocity) > 0.1) {
            function momentumStep() {
                velocity *= 0.95;
                if (Math.abs(velocity) < 0.05) { velocity = 0; return; }
                scrollX += velocity * 16;
                clampScroll();
                scheduleRender();
                momentumFrame = requestAnimationFrame(momentumStep);
            }
            momentumFrame = requestAnimationFrame(momentumStep);
        }
    }

    function onResize() {
        if (!active) return;
        resize();
        computeStackedLayout();
        scheduleRender();
    }

    // ── Public API ──
    window._steamViews = window._steamViews || {};
    window._steamViews.timeline = {
        _initialized: false,

        init() {
            if (this._initialized) return;
            this._initialized = true;

            canvas.addEventListener('mousedown', onMouseDown);
            canvas.addEventListener('mousemove', onMouseMove);
            canvas.addEventListener('mouseup', onMouseUp);
            canvas.addEventListener('mouseleave', onMouseLeave);
            canvas.addEventListener('wheel', onWheel, { passive: false });

            canvas.addEventListener('touchstart', onTouchStart, { passive: true });
            canvas.addEventListener('touchmove', onTouchMove, { passive: false });
            canvas.addEventListener('touchend', onTouchEnd);
            canvas.addEventListener('touchcancel', onTouchEnd);

            window.addEventListener('resize', onResize);
        },

        activate() {
            active = true;
            resize();
            aggregateData();
            computeStackedLayout();
            // Start scrolled to show ~2014 area (where detail begins)
            const targetX = -(xScale(CONDENSE_BREAK) - width * 0.15);
            scrollX = targetX;
            clampScroll();
            canvas.style.cursor = 'grab';
            scheduleRender();
        },

        deactivate() {
            active = false;
            hoveredGenre = null;
            tooltipData = null;
        },

        onFilterChange() {
            if (!active) return;
            aggregateData();
            computeStackedLayout();
            scheduleRender();
        },

        selectGame(game) {
            if (!active || !game) return;
            const genreIdxs = game[6] || [];
            if (genreIdxs.length === 0) return;
            const data = window._steamData;
            const firstGenre = data.genreNames[genreIdxs[0]];
            if (top15Genres.includes(firstGenre)) {
                hoveredGenre = firstGenre;
                // Scroll to the game's year
                const year = game[1];
                const targetX = -(xScale(year) - width / 2);
                scrollX = targetX;
                clampScroll();
                scheduleRender();
            }
        }
    };

})();
