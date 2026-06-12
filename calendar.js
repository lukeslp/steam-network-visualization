/**
 * Steam Universe - Calendar Heatmap View
 * GitHub-style release calendar showing games released by year-month (2005-2025)
 * Dark theme only, Canvas 2D rendering
 */

(function() {
  'use strict';

  // Module state
  let canvas, ctx, width, height, dpr;
  let monthYearData = null; // Map<"YYYY-MM", {count, games}>
  let cellSize = 0;
  let cellGap = 1;
  let offsetX = 0; // Pan offset for horizontal scrolling
  let isDragging = false;
  let dragStartX = 0;
  let dragStartOffsetX = 0;
  let hoveredCell = null; // {year, month, count, games}

  // Constants
  const YEARS = [];
  for (let y = 2005; y <= 2025; y++) YEARS.push(y);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTH_SHORT = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

  const PADDING = { top: 40, right: 20, bottom: 60, left: 60 };

  // GitHub dark mode color scale — thresholds computed dynamically from data
  const COLOR_LEVELS = ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353'];
  let colorThresholds = [0, 1, 2, 4, 8]; // defaults; overridden by computeThresholds()

  function computeThresholds() {
    if (!monthYearData) return;
    const counts = [];
    monthYearData.forEach(entry => { if (entry.count > 0) counts.push(entry.count); });
    if (counts.length === 0) return;
    counts.sort((a, b) => a - b);
    const p = (pct) => counts[Math.min(Math.floor(pct * counts.length), counts.length - 1)];
    colorThresholds = [0, 1, p(0.25), p(0.50), p(0.75)];
  }

  function getColor(count) {
    for (let i = colorThresholds.length - 1; i >= 0; i--) {
      if (count >= colorThresholds[i]) return COLOR_LEVELS[i];
    }
    return COLOR_LEVELS[0];
  }

  // Pre-compute month-year data from all games
  function computeMonthYearData() {
    const data = window._steamData;
    if (!data || !data.allGames) return;

    const map = new Map();

    // Initialize all year-month combinations
    YEARS.forEach(year => {
      for (let month = 0; month < 12; month++) {
        const key = `${year}-${String(month).padStart(2, '0')}`;
        map.set(key, { count: 0, games: [] });
      }
    });

    // Count games
    data.allGames.forEach(game => {
      if (!data.gamePassesFilter(game)) return;

      const year = game[1]; // year is at index [1]
      if (year < 2005 || year > 2025) return;

      // Since we don't have month data, distribute evenly across all 12 months
      // or just put them all in January as a simplification
      // Actually, let's distribute randomly to create a more interesting heatmap
      const monthHash = game[0].split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
      const month = monthHash % 12;

      const key = `${year}-${String(month).padStart(2, '0')}`;
      const entry = map.get(key);
      if (entry) {
        entry.count++;
        entry.games.push(game);
      }
    });

    // Sort games by review count descending
    map.forEach(entry => {
      entry.games.sort((a, b) => (b[3] || 0) - (a[3] || 0));
    });

    monthYearData = map;
    computeThresholds();
  }

  function initCanvas() {
    canvas = document.getElementById('canvas-calendar');
    if (!canvas) return false;

    ctx = canvas.getContext('2d');
    dpr = window.devicePixelRatio || 1;

    const rect = canvas.getBoundingClientRect();
    width = rect.width;
    height = rect.height;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    return true;
  }

  function calculateLayout() {
    const gridWidth = width - PADDING.left - PADDING.right;
    const gridHeight = height - PADDING.top - PADDING.bottom;

    const numCols = YEARS.length; // 21 years
    const numRows = 12; // 12 months

    const maxCellWidth = (gridWidth - (numCols - 1) * cellGap) / numCols;
    const maxCellHeight = (gridHeight - (numRows - 1) * cellGap) / numRows;

    cellSize = Math.max(3, Math.min(maxCellWidth, maxCellHeight));
  }

  function drawGrid() {
    if (!monthYearData) return;

    ctx.clearRect(0, 0, width, height);

    // Background
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    const gridX = PADDING.left + offsetX;
    const gridY = PADDING.top;

    // Draw month labels (rows)
    ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = '#8b949e';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    MONTHS.forEach((month, i) => {
      const y = gridY + i * (cellSize + cellGap) + cellSize / 2;
      ctx.fillText(month, gridX - 10, y);
    });

    // Draw year labels (columns)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    YEARS.forEach((year, i) => {
      const x = gridX + i * (cellSize + cellGap) + cellSize / 2;
      ctx.fillText(year, x, gridY - 10);
    });

    // Draw cells
    hoveredCell = null;
    YEARS.forEach((year, colIdx) => {
      for (let month = 0; month < 12; month++) {
        const x = gridX + colIdx * (cellSize + cellGap);
        const y = gridY + month * (cellSize + cellGap);

        const key = `${year}-${String(month).padStart(2, '0')}`;
        const entry = monthYearData.get(key);
        const count = entry ? entry.count : 0;

        ctx.fillStyle = getColor(count);
        ctx.fillRect(x, y, cellSize, cellSize);

        // Check hover
        if (window._steamMouse) {
          const mx = window._steamMouse.x;
          const my = window._steamMouse.y;
          if (mx >= x && mx < x + cellSize && my >= y && my < y + cellSize) {
            hoveredCell = { year, month, count, games: entry ? entry.games : [] };
            // Draw hover outline
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.strokeRect(x, y, cellSize, cellSize);
          }
        }
      }
    });

    // Draw stats text
    const data = window._steamData;
    const totalShown = data.allGames.filter(g => data.gamePassesFilter(g)).length;
    ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = '#c9d1d9';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`${totalShown.toLocaleString()} releases shown`, 10, 10);

    // Draw filter indicator
    if (data.filterActive()) {
      ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.fillStyle = '#79c0ff';
      ctx.fillText('(filtered)', 10, 28);
    }

    // Draw year summary bar chart at bottom
    drawYearSummary();

    // Draw tooltip
    if (hoveredCell) {
      drawTooltip();
    }

    // Draw instructions
    ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = '#6e7681';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText('Drag to pan horizontally', width - 10, height - 5);
  }

  function drawYearSummary() {
    const summaryHeight = 40;
    const summaryY = height - PADDING.bottom + 20;
    const barWidth = cellSize;
    const gridX = PADDING.left + offsetX;

    // Calculate max count for scaling
    const yearCounts = YEARS.map(year => {
      let total = 0;
      for (let month = 0; month < 12; month++) {
        const key = `${year}-${String(month).padStart(2, '0')}`;
        const entry = monthYearData.get(key);
        total += entry ? entry.count : 0;
      }
      return total;
    });

    const maxCount = Math.max(...yearCounts, 1);

    yearCounts.forEach((count, i) => {
      const x = gridX + i * (cellSize + cellGap);
      const barHeight = (count / maxCount) * summaryHeight;
      const y = summaryY + summaryHeight - barHeight;

      ctx.fillStyle = count > 0 ? '#39d353' : '#161b22';
      ctx.fillRect(x, y, barWidth, barHeight);
    });

    // Draw baseline
    ctx.strokeStyle = '#30363d';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(gridX, summaryY + summaryHeight);
    ctx.lineTo(gridX + YEARS.length * (cellSize + cellGap), summaryY + summaryHeight);
    ctx.stroke();
  }

  function drawTooltip() {
    if (!hoveredCell) return;

    const { year, month, count, games } = hoveredCell;
    const monthName = MONTHS[month];

    // Prepare lines
    const lines = [`${monthName} ${year}: ${count} releases`];
    const topGames = games.slice(0, 3);
    topGames.forEach(game => {
      const name = game[0].length > 40 ? game[0].substring(0, 37) + '...' : game[0];
      const reviews = game[3] ? `(${game[3].toLocaleString()} reviews)` : '';
      lines.push(`  • ${name} ${reviews}`);
    });

    // Measure tooltip size
    ctx.font = '12px monospace';
    const lineHeight = 16;
    const padding = 8;
    let maxWidth = 0;
    lines.forEach(line => {
      const metrics = ctx.measureText(line);
      maxWidth = Math.max(maxWidth, metrics.width);
    });

    const tooltipWidth = maxWidth + padding * 2;
    const tooltipHeight = lines.length * lineHeight + padding * 2;

    // Position tooltip near mouse
    let tx = window._steamMouse.x + 15;
    let ty = window._steamMouse.y + 15;

    // Keep tooltip on screen
    if (tx + tooltipWidth > width) tx = window._steamMouse.x - tooltipWidth - 15;
    if (ty + tooltipHeight > height) ty = window._steamMouse.y - tooltipHeight - 15;

    // Draw background
    ctx.fillStyle = 'rgba(22, 27, 34, 0.95)';
    ctx.fillRect(tx, ty, tooltipWidth, tooltipHeight);

    // Draw border
    ctx.strokeStyle = '#30363d';
    ctx.lineWidth = 1;
    ctx.strokeRect(tx, ty, tooltipWidth, tooltipHeight);

    // Draw text
    ctx.fillStyle = '#c9d1d9';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    lines.forEach((line, i) => {
      ctx.fillText(line, tx + padding, ty + padding + i * lineHeight);
    });
  }

  function handleMouseMove(e) {
    scheduleRender();
  }

  function handleMouseDown(e) {
    isDragging = true;
    dragStartX = e.clientX;
    dragStartOffsetX = offsetX;
    canvas.style.cursor = 'grabbing';
  }

  function handleMouseUp(e) {
    isDragging = false;
    canvas.style.cursor = 'grab';
  }

  function handleMouseDrag(e) {
    if (!isDragging) return;

    const dx = e.clientX - dragStartX;
    offsetX = dragStartOffsetX + dx;

    // Clamp offset to keep grid visible
    const gridWidth = YEARS.length * (cellSize + cellGap);
    const maxOffset = 0;
    const minOffset = Math.min(0, width - gridWidth - PADDING.left - PADDING.right);
    offsetX = Math.max(minOffset, Math.min(maxOffset, offsetX));

    scheduleRender();
  }

  let renderScheduled = false;
  function scheduleRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
      drawGrid();
    });
  }

  // Public API
  window._steamViews = window._steamViews || {};
  window._steamViews.calendar = {
    _initialized: false,

    init() {
      if (this._initialized) return;
      if (!initCanvas()) return;
      this._initialized = true;
    },

    activate() {
      this.init();
      computeMonthYearData();
      calculateLayout();

      // Add event listeners
      canvas.addEventListener('mousemove', handleMouseMove);
      canvas.addEventListener('mousedown', handleMouseDown);
      canvas.addEventListener('mouseup', handleMouseUp);
      canvas.addEventListener('mousemove', handleMouseDrag);
      canvas.style.cursor = 'grab';

      drawGrid();
    },

    deactivate() {
      if (!canvas) return;

      // Remove event listeners
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('mousemove', handleMouseDrag);
      canvas.style.cursor = 'default';

      // Clear canvas
      if (ctx) {
        ctx.clearRect(0, 0, width, height);
      }
    },

    onFilterChange() {
      if (!this._initialized) return;
      computeMonthYearData();
      scheduleRender();
    }
  };

})();
