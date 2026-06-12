/**
 * Sankey Flow Diagram for Steam Universe
 * Genre → Rating Tier → Price Bracket flows
 */
(function() {
  'use strict';

  // Module state
  let canvas, ctx;
  let dpr = window.devicePixelRatio || 1;
  let width = 0, height = 0;
  let active = false;

  // Layout constants
  const MARGINS = { top: 60, bottom: 40, left: 40, right: 40 };
  const NODE_WIDTH = 20;
  const NODE_GAP = 4;
  const COL_POSITIONS = [0.34, 0.56, 0.82]; // x positions — left column clears Controls panel

  // Color palettes
  const RATING_COLORS = ['#4ade80', '#facc15', '#f97316', '#ef4444'];
  const RATING_NAMES = ['Great (80-100%)', 'Good (60-79%)', 'Mixed (40-59%)', 'Poor (0-39%)'];
  const PRICE_COLORS = ['#60a5fa', '#22d3ee', '#2dd4bf', '#a78bfa', '#fbbf24'];
  const PRICE_NAMES = ['Free', 'Budget ($0.01-$9.99)', 'Mid ($10-$29.99)', 'Premium ($30-$59.99)', 'AAA ($60+)'];

  // Flow data structures
  let nodes = { genres: [], ratings: [], prices: [] };
  let flows = []; // { from, to, value, path }
  let hoveredNode = null;
  let hoveredFlow = null;

  // Tooltip
  const tip = SteamViz.makeTooltip();

  // Pointer hover unbind handle
  let unbindHover = null;

  /**
   * One-time initialization
   */
  function init() {
    canvas = document.getElementById('canvas-sankey');
    if (!canvas) {
      console.error('Canvas element canvas-sankey not found');
      return;
    }
    ctx = canvas.getContext('2d');

    // Mouse leave still bound here; pointer hover wiring happens in activate()
    canvas.addEventListener('mouseleave', handleMouseLeave);
  }

  /**
   * Activate this view
   */
  function activate() {
    if (!canvas) init();
    active = true;
    if (!unbindHover) {
      unbindHover = SteamViz.bindPointerHover(canvas, (p) => handleHover(p));
    }
    resize();
    buildFlowData();
    render();
  }

  /**
   * Deactivate this view
   */
  function deactivate() {
    active = false;
    if (unbindHover) {
      unbindHover();
      unbindHover = null;
    }
    hideTooltip();
  }

  /**
   * Called when filters change
   */
  function onFilterChange() {
    if (!active) return;
    buildFlowData();
    render();
  }

  /**
   * Resize canvas to current dimensions
   */
  function resize() {
    const c = SteamViz.setupCanvas(canvas);
    ctx = c.ctx;
    width = c.width;
    height = c.height;
    dpr = c.dpr;
  }

  /**
   * Build flow data from games
   */
  function buildFlowData() {
    const data = window._steamData;
    if (!data || !data.allGames) return;

    const { allGames, genreNames, gamePassesFilter } = data;

    // Count flows: genre → rating → price
    const flowMap = new Map();

    // Helper to get rating tier index from ratio
    function getRatingTier(ratio) {
      if (ratio >= 80) return 0; // Great
      if (ratio >= 60) return 1; // Good
      if (ratio >= 40) return 2; // Mixed
      return 3; // Poor
    }

    // Helper to get price bracket index
    function getPriceBracket(price) {
      if (price === 0) return 0; // Free
      if (price < 10) return 1; // Budget
      if (price < 30) return 2; // Mid
      if (price < 60) return 3; // Premium
      return 4; // AAA
    }

    // Get top 12 genres by game count
    const genreCounts = new Map();
    allGames.forEach(game => {
      if (!gamePassesFilter(game)) return;
      const genreIdxs = game[6] || [];
      genreIdxs.forEach(idx => {
        genreCounts.set(idx, (genreCounts.get(idx) || 0) + 1);
      });
    });
    const topGenreIndices = Array.from(genreCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([idx]) => idx);

    // Count flows
    allGames.forEach(game => {
      if (!gamePassesFilter(game)) return;

      const ratio = game[2]; // positive review %
      const price = game[4];
      const genreIdxs = game[6] || [];

      const ratingTier = getRatingTier(ratio);
      const priceBracket = getPriceBracket(price);

      // For each genre this game has
      genreIdxs.forEach(genreIdx => {
        if (!topGenreIndices.includes(genreIdx)) return;

        const key1 = `g${genreIdx}-r${ratingTier}`;
        const key2 = `r${ratingTier}-p${priceBracket}`;

        flowMap.set(key1, (flowMap.get(key1) || 0) + 1);
        flowMap.set(key2, (flowMap.get(key2) || 0) + 1);
      });
    });

    // Build node structures
    nodes.genres = topGenreIndices.map((idx, i) => ({
      id: `g${idx}`,
      label: genreNames[idx] || `Genre ${idx}`,
      color: SteamViz.genreColor(i),
      value: genreCounts.get(idx) || 0,
      column: 0,
    }));

    nodes.ratings = RATING_NAMES.map((name, i) => ({
      id: `r${i}`,
      label: name,
      color: RATING_COLORS[i],
      value: 0, // will be calculated from flows
      column: 1,
    }));

    nodes.prices = PRICE_NAMES.map((name, i) => ({
      id: `p${i}`,
      label: name,
      color: PRICE_COLORS[i],
      value: 0, // will be calculated from flows
      column: 2,
    }));

    // Calculate node values from flows (use only genre→rating flows for ratings,
    // only rating→price flows for prices, to avoid double-counting)
    flowMap.forEach((value, key) => {
      const [fromId, toId] = key.split('-');
      // genre→rating: count toward rating node
      if (fromId.startsWith('g') && toId.startsWith('r')) {
        const rIdx = parseInt(toId.slice(1));
        nodes.ratings[rIdx].value += value;
      }
      // rating→price: count toward price node
      if (fromId.startsWith('r') && toId.startsWith('p')) {
        const pIdx = parseInt(toId.slice(1));
        nodes.prices[pIdx].value += value;
      }
    });

    // Build flows array
    flows = [];
    flowMap.forEach((value, key) => {
      const [fromId, toId] = key.split('-');
      let fromNode, toNode;

      if (fromId.startsWith('g')) {
        fromNode = nodes.genres.find(n => n.id === fromId);
        toNode = nodes.ratings.find(n => n.id === toId);
      } else {
        fromNode = nodes.ratings.find(n => n.id === fromId);
        toNode = nodes.prices.find(n => n.id === toId);
      }

      if (fromNode && toNode) {
        flows.push({ from: fromNode, to: toNode, value });
      }
    });

    // Layout nodes
    layoutNodes();
  }

  /**
   * Calculate node positions
   */
  function layoutNodes() {
    const availableHeight = height - MARGINS.top - MARGINS.bottom;

    [nodes.genres, nodes.ratings, nodes.prices].forEach((nodeList, colIdx) => {
      const totalValue = nodeList.reduce((sum, n) => sum + n.value, 0);
      const totalGaps = (nodeList.length - 1) * NODE_GAP;
      const availableForNodes = availableHeight - totalGaps;
      const valueToHeight = availableForNodes / totalValue;

      let currentY = MARGINS.top;
      nodeList.forEach(node => {
        node.height = Math.max(4, node.value * valueToHeight);
        node.x = COL_POSITIONS[colIdx] * width;
        node.y = currentY;
        currentY += node.height + NODE_GAP;
      });
    });

    // Calculate flow paths
    calculateFlowPaths();
  }

  /**
   * Calculate Bezier paths for all flows
   */
  function calculateFlowPaths() {
    // Sort flows by value for consistent ordering
    flows.sort((a, b) => b.value - a.value);

    // Track y offsets for source and target nodes
    const sourceOffsets = new Map();
    const targetOffsets = new Map();

    flows.forEach(flow => {
      const { from, to, value } = flow;

      // Calculate heights based on node values
      const fromHeight = (value / from.value) * from.height;
      const toHeight = (value / to.value) * to.height;

      const fromOffset = sourceOffsets.get(from.id) || 0;
      const toOffset = targetOffsets.get(to.id) || 0;

      sourceOffsets.set(from.id, fromOffset + fromHeight);
      targetOffsets.set(to.id, toOffset + toHeight);

      // Path points
      const x1 = from.x + NODE_WIDTH;
      const y1 = from.y + fromOffset + fromHeight / 2;
      const x2 = to.x;
      const y2 = to.y + toOffset + toHeight / 2;

      // Control points for Bezier curve
      const cx1 = x1 + (x2 - x1) * 0.5;
      const cx2 = x2 - (x2 - x1) * 0.5;

      flow.path = {
        x1, y1, x2, y2, cx1, cx2,
        height1: fromHeight,
        height2: toHeight,
      };
    });
  }

  /**
   * Render the visualization
   */
  function render() {
    ctx.clearRect(0, 0, width, height);

    // Dark background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, width, height);

    // Draw flows first (behind nodes)
    drawFlows();

    // Draw nodes
    drawNodes();

    // Draw stats
    drawStats();
  }

  /**
   * Draw flow bands
   */
  function drawFlows() {
    flows.forEach(flow => {
      const { from, to, value, path } = flow;
      const { x1, y1, x2, y2, cx1, cx2, height1, height2 } = path;

      const isHovered = flow === hoveredFlow ||
        (hoveredNode && (hoveredNode === from || hoveredNode === to));

      ctx.globalAlpha = isHovered ? 0.6 : 0.3;

      // Create gradient from source to target color
      const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
      gradient.addColorStop(0, from.color);
      gradient.addColorStop(1, to.color);
      ctx.fillStyle = gradient;

      // Draw flow band as a filled path
      ctx.beginPath();

      // Top edge
      ctx.moveTo(x1, y1 - height1 / 2);
      ctx.bezierCurveTo(
        cx1, y1 - height1 / 2,
        cx2, y2 - height2 / 2,
        x2, y2 - height2 / 2
      );

      // Bottom edge (reverse)
      ctx.lineTo(x2, y2 + height2 / 2);
      ctx.bezierCurveTo(
        cx2, y2 + height2 / 2,
        cx1, y1 + height1 / 2,
        x1, y1 + height1 / 2
      );

      ctx.closePath();
      ctx.fill();

      ctx.globalAlpha = 1.0;
    });
  }

  /**
   * Draw nodes
   */
  function drawNodes() {
    [nodes.genres, nodes.ratings, nodes.prices].forEach((nodeList, colIdx) => {
      nodeList.forEach(node => {
        const isHovered = node === hoveredNode;

        // Node rectangle
        ctx.fillStyle = node.color;
        ctx.globalAlpha = isHovered ? 1.0 : 0.85;
        ctx.fillRect(node.x, node.y, NODE_WIDTH, node.height);
        ctx.globalAlpha = 1.0;

        // Node label
        ctx.fillStyle = '#ddd';
        ctx.font = '11px -apple-system, sans-serif';

        let textX, align;
        if (colIdx === 0) {
          textX = node.x + NODE_WIDTH + 6;
          align = 'left';
        } else if (colIdx === 1) {
          textX = node.x + NODE_WIDTH / 2;
          align = 'center';
        } else {
          textX = node.x + NODE_WIDTH + 6;
          align = 'left';
        }

        ctx.textAlign = align;
        ctx.textBaseline = 'middle';
        ctx.fillText(node.label, textX, node.y + node.height / 2);
      });
    });
  }

  /**
   * Draw stats header
   */
  function drawStats() {
    const data = window._steamData;
    if (!data) return;

    const totalGames = flows.reduce((sum, f) => sum + f.value, 0);
    const totalFlows = flows.length;

    ctx.fillStyle = '#888';
    ctx.font = '13px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(
      `${totalGames.toLocaleString()} games flowing through ${totalFlows.toLocaleString()} paths`,
      width / 2,
      20
    );
  }

  /**
   * Pointer hover handler (mouse + touch)
   * @param {{x:number, y:number, clientX:number, clientY:number}} p normalized pointer
   */
  function handleHover(p) {
    const mouseX = p.x;
    const mouseY = p.y;

    // Check node hover
    let foundNode = null;
    [nodes.genres, nodes.ratings, nodes.prices].forEach(nodeList => {
      nodeList.forEach(node => {
        if (
          mouseX >= node.x &&
          mouseX <= node.x + NODE_WIDTH &&
          mouseY >= node.y &&
          mouseY <= node.y + node.height
        ) {
          foundNode = node;
        }
      });
    });

    // Check flow hover (if no node hovered)
    let foundFlow = null;
    if (!foundNode) {
      foundFlow = flows.find(flow => isPointInFlow(mouseX, mouseY, flow));
    }

    if (foundNode !== hoveredNode || foundFlow !== hoveredFlow) {
      hoveredNode = foundNode;
      hoveredFlow = foundFlow;
      render();

      if (foundNode) {
        showNodeTooltip(foundNode, p.clientX, p.clientY);
      } else if (foundFlow) {
        showFlowTooltip(foundFlow, p.clientX, p.clientY);
      } else {
        hideTooltip();
      }
    }
  }

  /**
   * Check if point is inside flow band
   */
  function isPointInFlow(px, py, flow) {
    const { x1, y1, x2, y2, height1, height2 } = flow.path;

    // Simple bounding box check first
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1 + NODE_WIDTH, x2 + NODE_WIDTH);
    const minY = Math.min(y1 - height1 / 2, y2 - height2 / 2) - 10;
    const maxY = Math.max(y1 + height1 / 2, y2 + height2 / 2) + 10;

    if (px < minX || px > maxX || py < minY || py > maxY) {
      return false;
    }

    // More precise check: distance to center curve
    const t = (px - x1) / (x2 - x1);
    if (t < 0 || t > 1) return false;

    // Bezier curve interpolation
    const { cx1, cx2 } = flow.path;
    const mt = 1 - t;
    const cy = mt * mt * mt * y1 +
               3 * mt * mt * t * y1 +
               3 * mt * t * t * y2 +
               t * t * t * y2;

    const approxHeight = height1 + (height2 - height1) * t;
    const dist = Math.abs(py - cy);

    return dist < approxHeight / 2 + 5;
  }

  /**
   * Mouse leave handler
   */
  function handleMouseLeave() {
    hoveredNode = null;
    hoveredFlow = null;
    hideTooltip();
    render();
  }

  /**
   * Show node tooltip
   */
  function showNodeTooltip(node, clientX, clientY) {
    const total = flows.reduce((sum, f) => sum + f.value, 0);
    const pct = ((node.value / total) * 100).toFixed(1);

    const html = `
      <div style="font-weight: 600; margin-bottom: 4px;">${node.label}</div>
      <div>${node.value.toLocaleString()} games (${pct}%)</div>
    `;

    tip.show(html, clientX, clientY);
  }

  /**
   * Show flow tooltip
   */
  function showFlowTooltip(flow, clientX, clientY) {
    const total = flows.reduce((sum, f) => sum + f.value, 0);
    const pct = ((flow.value / total) * 100).toFixed(1);

    const html = `
      <div style="font-weight: 600; margin-bottom: 4px;">
        ${flow.from.label} → ${flow.to.label}
      </div>
      <div>${flow.value.toLocaleString()} games (${pct}%)</div>
    `;

    tip.show(html, clientX, clientY);
  }

  /**
   * Hide tooltip
   */
  function hideTooltip() {
    tip.hide();
  }

  // Expose public API
  window._steamViews = window._steamViews || {};
  window._steamViews.sankey = {
    _initialized: false,
    init() {
      if (this._initialized) return;
      init();
      this._initialized = true;
    },
    activate() {
      this.init();
      activate();
    },
    deactivate,
    onFilterChange,
    resize,
  };

})();
