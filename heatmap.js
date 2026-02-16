/**
 * Heatmap Visualization: Genre × Year Density Matrix
 * Shows distribution of 82K+ Steam games across genres and years (2005-2025)
 *
 * Design choices:
 * - Sqrt color scale (perceptually fairer than log for moderate ranges)
 * - Sqrt-proportional row heights (large genres get more space without crushing small ones)
 * - Warm dark brown for near-zero cells (1-3 games) for visual differentiation
 */
(function() {
    'use strict';

    const canvas = document.getElementById('canvas-heatmap');
    const ctx = canvas.getContext('2d');

    // State
    let active = false;
    let transform = d3.zoomIdentity;
    let matrixData = null;
    let hoveredCell = null;
    let renderScheduled = false;

    // Constants
    const YEARS = [];
    for (let y = 2005; y <= 2025; y++) YEARS.push(y);
    const NUM_YEARS = YEARS.length; // 21
    const MARGIN = { top: 40, right: 120, bottom: 60, left: 200 };
    const CELL_GAP = 1;
    const MIN_CELL_SIZE_FOR_TEXT = 40;
    const BG_COLOR = '#0a0a0a';
    const ZERO_COLOR = '#111111';
    const LOW_COLOR = '#2a1a0e'; // Warm dark brown for 1-3 games
    const HIGHLIGHT_COLOR = 'rgba(255, 255, 255, 0.08)';
    const TEXT_COLOR = '#f0f0f0';
    const LABEL_COLOR = '#c0c0c0';

    // Zoom behavior
    let zoom = null;

    /**
     * Build the genre×year density matrix from filtered games
     */
    function computeMatrix() {
        const data = window._steamData;
        if (!data || !data.allGames) return null;

        const cells = new Map();
        const genreTotals = new Map();

        for (let gIdx = 0; gIdx < data.genreNames.length; gIdx++) {
            genreTotals.set(gIdx, 0);
            for (const year of YEARS) {
                const key = `${gIdx}:${year}`;
                cells.set(key, {
                    genre: data.genreNames[gIdx],
                    genreIdx: gIdx,
                    year,
                    count: 0,
                    games: []
                });
            }
        }

        for (const game of data.allGames) {
            if (!data.gamePassesFilter(game)) continue;

            const year = game[1];
            const genreIdxs = game[6];
            if (!genreIdxs || genreIdxs.length === 0) continue;

            for (const gIdx of genreIdxs) {
                const key = `${gIdx}:${year}`;
                const cell = cells.get(key);
                if (cell) {
                    cell.count++;
                    cell.games.push(game);
                    genreTotals.set(gIdx, genreTotals.get(gIdx) + 1);
                }
            }
        }

        // Sort genres by total count (descending)
        const genreOrder = Array.from(genreTotals.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([gIdx]) => gIdx);

        let maxCount = 1;
        for (const cell of cells.values()) {
            if (cell.count > maxCount) maxCount = cell.count;
        }

        return { cells, genreOrder, maxCount, genreTotals };
    }

    /**
     * Sqrt color scale with warm brown for near-zero values
     */
    function getColorScale(maxCount) {
        const sqrtScale = d3.scaleSequentialSqrt(d3.interpolateInferno)
            .domain([1, maxCount]);

        return function(count) {
            if (count <= 0) return ZERO_COLOR;
            if (count <= 3) return LOW_COLOR;
            return sqrtScale(count);
        };
    }

    /**
     * Raw sqrt scale (for legend gradient)
     */
    function getRawScale(maxCount) {
        return d3.scaleSequentialSqrt(d3.interpolateInferno)
            .domain([1, maxCount]);
    }

    /**
     * Calculate layout dimensions with sqrt-proportional row heights
     */
    function getLayout() {
        const width = canvas.width;
        const height = canvas.height;
        const innerWidth = width - MARGIN.left - MARGIN.right;
        const innerHeight = height - MARGIN.top - MARGIN.bottom;
        const cellWidth = innerWidth / NUM_YEARS;
        const genreCount = matrixData.genreOrder.length;

        // Sqrt-proportional row heights
        const sqrtTotals = matrixData.genreOrder.map(gIdx =>
            Math.sqrt(matrixData.genreTotals.get(gIdx) || 1)
        );
        const sqrtSum = sqrtTotals.reduce((a, b) => a + b, 0);

        // Minimum 40% of uniform height so small genres stay readable
        const uniformHeight = innerHeight / genreCount;
        const minRowH = uniformHeight * 0.4;
        const availableForProportion = innerHeight - minRowH * genreCount;

        const rowHeights = [];
        const rowYs = [];
        let y = 0;

        for (let i = 0; i < genreCount; i++) {
            const proportion = sqrtSum > 0 ? sqrtTotals[i] / sqrtSum : 1 / genreCount;
            const h = minRowH + proportion * availableForProportion;
            rowYs.push(y);
            rowHeights.push(h);
            y += h;
        }

        return { width, height, innerWidth, innerHeight, cellWidth, rowYs, rowHeights };
    }

    /**
     * Transform screen coordinates to data cell
     */
    function screenToData(x, y) {
        const layout = getLayout();
        const dataX = (x - MARGIN.left - transform.x) / transform.k;
        const dataY = (y - MARGIN.top - transform.y) / transform.k;

        const colIdx = Math.floor(dataX / layout.cellWidth);

        // Linear scan for row with variable heights
        let rowIdx = -1;
        for (let i = 0; i < layout.rowYs.length; i++) {
            if (dataY >= layout.rowYs[i] && dataY < layout.rowYs[i] + layout.rowHeights[i]) {
                rowIdx = i;
                break;
            }
        }

        if (colIdx < 0 || colIdx >= NUM_YEARS || rowIdx < 0) {
            return null;
        }

        const year = YEARS[colIdx];
        const genreIdx = matrixData.genreOrder[rowIdx];
        const key = `${genreIdx}:${year}`;
        const cell = matrixData.cells.get(key);

        return cell ? { cell, rowIdx, colIdx } : null;
    }

    /**
     * Render the heatmap
     */
    function render() {
        if (!active || !matrixData) return;

        const layout = getLayout();
        const colorScale = getColorScale(matrixData.maxCount);

        // Clear canvas
        ctx.fillStyle = BG_COLOR;
        ctx.fillRect(0, 0, layout.width, layout.height);

        ctx.save();
        ctx.translate(MARGIN.left, MARGIN.top);
        ctx.translate(transform.x, transform.y);
        ctx.scale(transform.k, transform.k);

        // Draw cells
        for (let rowIdx = 0; rowIdx < matrixData.genreOrder.length; rowIdx++) {
            const genreIdx = matrixData.genreOrder[rowIdx];
            const y = layout.rowYs[rowIdx];
            const rowH = layout.rowHeights[rowIdx];

            for (let colIdx = 0; colIdx < NUM_YEARS; colIdx++) {
                const year = YEARS[colIdx];
                const x = colIdx * layout.cellWidth;
                const key = `${genreIdx}:${year}`;
                const cell = matrixData.cells.get(key);

                ctx.fillStyle = colorScale(cell.count);
                ctx.fillRect(x + CELL_GAP, y + CELL_GAP, layout.cellWidth - CELL_GAP * 2, rowH - CELL_GAP * 2);

                // Cell count text (only when zoomed enough)
                const cellDisplayWidth = layout.cellWidth * transform.k;
                if (cellDisplayWidth > MIN_CELL_SIZE_FOR_TEXT && cell.count > 0) {
                    ctx.save();
                    ctx.scale(1 / transform.k, 1 / transform.k);
                    ctx.fillStyle = cell.count > matrixData.maxCount / 2 ? '#000' : '#fff';
                    ctx.font = '12px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    const textX = (x + layout.cellWidth / 2) * transform.k;
                    const textY = (y + rowH / 2) * transform.k;
                    ctx.fillText(cell.count.toLocaleString(), textX, textY);
                    ctx.restore();
                }
            }
        }

        ctx.restore();

        // Crosshair highlights for hovered cell
        if (hoveredCell) {
            const { rowIdx, colIdx } = hoveredCell;

            ctx.save();
            ctx.fillStyle = HIGHLIGHT_COLOR;

            // Highlight row
            const rowY = MARGIN.top + layout.rowYs[rowIdx] * transform.k + transform.y;
            const rowHeight = layout.rowHeights[rowIdx] * transform.k;
            ctx.fillRect(MARGIN.left, rowY, layout.innerWidth, rowHeight);

            // Highlight column
            const colX = MARGIN.left + (colIdx * layout.cellWidth) * transform.k + transform.x;
            const colWidth = layout.cellWidth * transform.k;
            ctx.fillRect(colX, MARGIN.top, colWidth, layout.innerHeight);

            ctx.restore();
        }

        drawAxes(layout);

        renderScheduled = false;
    }

    /**
     * Draw axes, labels, and legend
     */
    function drawAxes(layout) {
        const data = window._steamData;
        const rawScale = getRawScale(matrixData.maxCount);

        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);

        // X axis labels (years)
        ctx.fillStyle = LABEL_COLOR;
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        const cellWidthPx = layout.cellWidth * transform.k;
        const yearSkip = cellWidthPx < 28 ? 5 : cellWidthPx < 40 ? 2 : 1;
        for (let i = 0; i < NUM_YEARS; i++) {
            if (yearSkip > 1 && YEARS[i] % yearSkip !== 0) continue;
            const x = MARGIN.left + (i + 0.5) * cellWidthPx + transform.x;
            const y = MARGIN.top + layout.innerHeight + 10;
            if (x >= MARGIN.left && x <= MARGIN.left + layout.innerWidth) {
                ctx.fillText(YEARS[i], x, y);
            }
        }

        // Column totals
        ctx.font = '11px sans-serif';
        ctx.fillStyle = '#888';
        for (let i = 0; i < NUM_YEARS; i++) {
            if (yearSkip > 1 && YEARS[i] % yearSkip !== 0) continue;
            const year = YEARS[i];
            let total = 0;
            for (const genreIdx of matrixData.genreOrder) {
                const key = `${genreIdx}:${year}`;
                total += matrixData.cells.get(key).count;
            }
            const x = MARGIN.left + (i + 0.5) * cellWidthPx + transform.x;
            const y = MARGIN.top + layout.innerHeight + 30;
            if (x >= MARGIN.left && x <= MARGIN.left + layout.innerWidth && total > 0) {
                ctx.fillText(total.toLocaleString(), x, y);
            }
        }

        // Y axis labels (genres)
        ctx.fillStyle = LABEL_COLOR;
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';

        for (let i = 0; i < matrixData.genreOrder.length; i++) {
            const genreIdx = matrixData.genreOrder[i];
            const y = MARGIN.top + (layout.rowYs[i] + layout.rowHeights[i] / 2) * transform.k + transform.y;
            if (y >= MARGIN.top && y <= MARGIN.top + layout.innerHeight) {
                const genreName = data.genreNames[genreIdx];
                ctx.fillText(genreName, MARGIN.left - 10, y);
            }
        }

        // Row totals
        ctx.font = '11px sans-serif';
        ctx.fillStyle = '#888';
        ctx.textAlign = 'left';
        for (let i = 0; i < matrixData.genreOrder.length; i++) {
            const genreIdx = matrixData.genreOrder[i];
            const total = matrixData.genreTotals.get(genreIdx);
            const y = MARGIN.top + (layout.rowYs[i] + layout.rowHeights[i] / 2) * transform.k + transform.y;
            if (y >= MARGIN.top && y <= MARGIN.top + layout.innerHeight) {
                ctx.fillText(total.toLocaleString(), MARGIN.left + layout.innerWidth + 10, y);
            }
        }

        // Title
        ctx.fillStyle = TEXT_COLOR;
        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('Genre × Year Density Matrix', MARGIN.left, 10);

        drawColorLegend(layout, rawScale);

        ctx.restore();
    }

    /**
     * Draw color scale legend
     */
    function drawColorLegend(layout, rawScale) {
        const legendWidth = 200;
        const legendHeight = 15;
        const legendX = layout.width - MARGIN.right + 20;
        const legendY = MARGIN.top;

        // Gradient bar using sqrt interpolation
        const gradient = ctx.createLinearGradient(legendX, 0, legendX + legendWidth, 0);
        const steps = 20;
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            // Sqrt scale: value = 1 + t^2 * (max - 1)
            const value = 1 + t * t * (matrixData.maxCount - 1);
            gradient.addColorStop(t, rawScale(Math.max(1, value)));
        }

        ctx.fillStyle = gradient;
        ctx.fillRect(legendX, legendY, legendWidth, legendHeight);

        // Low-count swatch
        ctx.fillStyle = LOW_COLOR;
        ctx.fillRect(legendX - 18, legendY, 14, legendHeight);
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(legendX - 18, legendY, 14, legendHeight);

        // Border
        ctx.strokeStyle = LABEL_COLOR;
        ctx.lineWidth = 1;
        ctx.strokeRect(legendX, legendY, legendWidth, legendHeight);

        // Labels
        ctx.fillStyle = LABEL_COLOR;
        ctx.font = '11px sans-serif';
        ctx.textBaseline = 'top';

        ctx.textAlign = 'right';
        ctx.fillText('1-3', legendX - 4, legendY + legendHeight + 5);

        ctx.textAlign = 'left';
        ctx.fillText('4', legendX, legendY + legendHeight + 5);

        ctx.textAlign = 'right';
        ctx.fillText(matrixData.maxCount.toLocaleString(), legendX + legendWidth, legendY + legendHeight + 5);

        ctx.textAlign = 'center';
        ctx.fillText('Games per cell', legendX + legendWidth / 2, legendY - 18);
    }

    /**
     * Show tooltip for hovered cell
     */
    function showTooltip(cell, x, y) {
        const data = window._steamData;
        let tooltip = document.getElementById('heatmap-tooltip');

        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.id = 'heatmap-tooltip';
            tooltip.style.cssText = `
                position: fixed;
                background: rgba(0, 0, 0, 0.95);
                border: 1px solid #444;
                border-radius: 4px;
                padding: 10px;
                color: #fff;
                font-size: 13px;
                pointer-events: none;
                z-index: 10000;
                max-width: 300px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            `;
            document.body.appendChild(tooltip);
        }

        const topGames = cell.games
            .sort((a, b) => b[3] - a[3])
            .slice(0, 3);

        let html = `
            <div style="font-weight: bold; margin-bottom: 6px; color: #ffa500;">
                ${cell.genre} &middot; ${cell.year}
            </div>
            <div style="margin-bottom: 8px;">
                <span style="color: #aaa;">Games:</span> ${cell.count.toLocaleString()}
            </div>
        `;

        if (topGames.length > 0) {
            html += `<div style="border-top: 1px solid #333; padding-top: 6px; margin-top: 6px;">`;
            html += `<div style="color: #888; font-size: 11px; margin-bottom: 4px;">Top games:</div>`;
            for (const game of topGames) {
                const name = game[0];
                const reviews = game[3].toLocaleString();
                html += `<div style="margin: 2px 0; font-size: 12px;">&middot; ${name} <span style="color: #666;">(${reviews})</span></div>`;
            }
            html += `</div>`;
        }

        tooltip.innerHTML = html;
        tooltip.style.display = 'block';

        const rect = canvas.getBoundingClientRect();
        let tooltipX = rect.left + x + 15;
        let tooltipY = rect.top + y + 15;

        const tooltipRect = tooltip.getBoundingClientRect();
        if (tooltipX + tooltipRect.width > window.innerWidth) {
            tooltipX = rect.left + x - tooltipRect.width - 15;
        }
        if (tooltipY + tooltipRect.height > window.innerHeight) {
            tooltipY = rect.top + y - tooltipRect.height - 15;
        }

        tooltip.style.left = tooltipX + 'px';
        tooltip.style.top = tooltipY + 'px';
    }

    function hideTooltip() {
        const tooltip = document.getElementById('heatmap-tooltip');
        if (tooltip) {
            tooltip.style.display = 'none';
        }
    }

    function onMouseMove(event) {
        if (!active || !matrixData) return;

        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;

        const result = screenToData(x, y);

        if (result && result.cell.count > 0) {
            hoveredCell = result;
            showTooltip(result.cell, x, y);
            scheduleRender();
        } else {
            if (hoveredCell) {
                hoveredCell = null;
                scheduleRender();
            }
            hideTooltip();
        }
    }

    function onMouseLeave() {
        if (hoveredCell) {
            hoveredCell = null;
            scheduleRender();
        }
        hideTooltip();
    }

    // Touch handling
    let touchClearTimeout = null;

    function onTouchStart(event) {
        if (!active || !matrixData) return;
    }

    function onTouchMove(event) {
        if (!active || !matrixData) return;
        if (event.touches.length > 1) return;

        event.preventDefault();

        const touch = event.touches[0];
        const rect = canvas.getBoundingClientRect();
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;

        const result = screenToData(x, y);

        if (touchClearTimeout) {
            clearTimeout(touchClearTimeout);
            touchClearTimeout = null;
        }

        if (result && result.cell.count > 0) {
            hoveredCell = result;
            showTooltip(result.cell, x, y);
            scheduleRender();
        } else {
            if (hoveredCell) {
                hoveredCell = null;
                scheduleRender();
            }
            hideTooltip();
        }
    }

    function onTouchEnd(event) {
        if (!active) return;

        if (touchClearTimeout) {
            clearTimeout(touchClearTimeout);
        }

        touchClearTimeout = setTimeout(() => {
            if (hoveredCell) {
                hoveredCell = null;
                scheduleRender();
            }
            hideTooltip();
            touchClearTimeout = null;
        }, 300);
    }

    function scheduleRender() {
        if (!renderScheduled) {
            renderScheduled = true;
            requestAnimationFrame(render);
        }
    }

    function onResize() {
        if (!active) return;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = canvas.offsetWidth * dpr;
        canvas.height = canvas.offsetHeight * dpr;
        ctx.scale(dpr, dpr);
        scheduleRender();
    }

    function initZoom() {
        zoom = d3.zoom()
            .scaleExtent([0.5, 8])
            .on('zoom', (event) => {
                transform = event.transform;
                scheduleRender();
            });

        d3.select(canvas).call(zoom);
    }

    // Public API
    window._steamViews = window._steamViews || {};
    window._steamViews.heatmap = {
        _initialized: false,

        init() {
            if (this._initialized) return;

            initZoom();

            canvas.addEventListener('mousemove', onMouseMove);
            canvas.addEventListener('mouseleave', onMouseLeave);

            canvas.addEventListener('touchstart', onTouchStart, { passive: true });
            canvas.addEventListener('touchmove', onTouchMove, { passive: false });
            canvas.addEventListener('touchend', onTouchEnd);
            canvas.addEventListener('touchcancel', onTouchEnd);

            window.addEventListener('resize', onResize);

            this._initialized = true;
        },

        activate() {
            active = true;
            onResize();
            matrixData = computeMatrix();
            scheduleRender();
        },

        deactivate() {
            active = false;
            hideTooltip();
            hoveredCell = null;
        },

        onFilterChange() {
            if (!active) return;
            matrixData = computeMatrix();
            scheduleRender();
        },

        selectGame(game) {
            if (!active || !matrixData || !game) return;

            const year = game[1];
            const genreIdxs = game[6];
            if (!genreIdxs || genreIdxs.length === 0) return;

            const genreIdx = genreIdxs[0];
            const rowIdx = matrixData.genreOrder.indexOf(genreIdx);
            const colIdx = YEARS.indexOf(year);

            if (rowIdx >= 0 && colIdx >= 0) {
                const key = `${genreIdx}:${year}`;
                const cell = matrixData.cells.get(key);

                if (cell) {
                    hoveredCell = { cell, rowIdx, colIdx };

                    const layout = getLayout();
                    const cellX = colIdx * layout.cellWidth;
                    const cellY = layout.rowYs[rowIdx];
                    const cellH = layout.rowHeights[rowIdx];
                    const scale = 3;

                    const translateX = (layout.innerWidth / 2 - cellX * scale - layout.cellWidth * scale / 2);
                    const translateY = (layout.innerHeight / 2 - cellY * scale - cellH * scale / 2);

                    d3.select(canvas)
                        .transition()
                        .duration(750)
                        .call(zoom.transform, d3.zoomIdentity.translate(translateX, translateY).scale(scale));
                }
            }
        }
    };
})();
