/**
 * Developer/Publisher Treemap View for Steam Universe
 * Shows the Steam ecosystem as nested rectangles grouped by genre and developer
 */
(function() {
  'use strict';

  // Module state
  let active = false;
  let canvas, ctx;
  let dpr = window.devicePixelRatio || 1;
  let width = 0, height = 0;

  // Data structures
  let hierarchy = null;
  let rootNode = null;
  let treemapLayout = null;
  let zoomedGenre = null; // null | { genreIdx, genreName, developers }
  let sizeMode = 'reviews'; // 'reviews' | 'games' | 'revenue'

  // Publisher/developer brand colors — recognizable Steam ecosystem colors
  const PUBLISHER_COLORS = new Map([
    ['Valve', '#1b2838'],           // Steam dark blue
    ['Electronic Arts', '#e03a27'], // EA red
    ['Ubisoft', '#0070ff'],         // Ubisoft blue
    ['SEGA', '#1752a3'],            // SEGA blue
    ['Capcom', '#003d7c'],          // Capcom navy
    ['Square Enix', '#d4001a'],     // Square Enix red
    ['Bandai Namco', '#ff6600'],    // Bandai orange
    ['Bethesda', '#84171a'],        // Bethesda dark red
    ['2K', '#ff2a2a'],              // 2K red
    ['Devolver Digital', '#e6194b'],// Devolver pink-red
    ['Team17', '#ffc300'],          // Team17 yellow
    ['Paradox Interactive', '#004a8f'], // Paradox blue
    ['Deep Silver', '#0084c7'],     // Deep Silver blue
    ['Konami', '#cc0000'],          // Konami red
    ['THQ Nordic', '#8b4513'],      // THQ brown
    ['Activision', '#22aa22'],      // Activision green
    ['505 Games', '#ff8c00'],       // 505 orange
    ['Frontier Developments', '#00b4d8'], // Frontier cyan
    ['Klei Entertainment', '#ff6b35'],    // Klei orange
    ['Coffee Stain', '#6b4226'],    // Coffee brown
    ['Annapurna Interactive', '#e6b800'], // Annapurna gold
    ['Focus Entertainment', '#5e3a87'],   // Focus purple
    ['Raw Fury', '#ff0054'],        // Raw Fury red
    ['tinyBuild', '#00ff41'],       // tinyBuild green
    ['Chucklefish', '#4fc3f7'],     // Chucklefish light blue
  ]);

  // Interaction state
  let hoveredDev = null;
  let tooltip = null;

  /**
   * One-time initialization
   */
  function init() {
    canvas = document.getElementById('canvas-treemap');
    if (!canvas) {
      console.error('Canvas element canvas-treemap not found');
      return;
    }
    ctx = canvas.getContext('2d');

    // Create tooltip
    tooltip = document.createElement('div');
    tooltip.className = 'viz-tooltip';
    tooltip.style.cssText = `
      position: fixed;
      pointer-events: none;
      background: rgba(10, 10, 10, 0.95);
      border: 1px solid #444;
      border-radius: 6px;
      padding: 8px 12px;
      font-size: 13px;
      line-height: 1.5;
      color: #ddd;
      display: none;
      z-index: 10000;
      max-width: 300px;
    `;
    document.body.appendChild(tooltip);

    // Event listeners
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('click', handleClick);
    canvas.addEventListener('mouseleave', handleMouseLeave);

    // Size mode switcher (create if doesn't exist)
    createSizeModeSwitcher();

    // D3 treemap layout
    treemapLayout = d3.treemap()
      .tile(d3.treemapSquarify)
      .padding(2)
      .paddingTop(18)
      .round(true);
  }

  /**
   * Create size mode switcher pills
   */
  function createSizeModeSwitcher() {
    const existingSwitcher = document.getElementById('treemap-size-switcher');
    if (existingSwitcher) return;

    const switcher = document.createElement('div');
    switcher.id = 'treemap-size-switcher';
    switcher.style.cssText = `
      position: fixed;
      top: 80px;
      left: 20px;
      display: none;
      gap: 8px;
      z-index: 100;
    `;

    const modes = [
      { id: 'reviews', label: 'Reviews' },
      { id: 'games', label: 'Games' },
      { id: 'revenue', label: 'Revenue' }
    ];

    modes.forEach(mode => {
      const pill = document.createElement('div');
      pill.className = 'size-mode-pill';
      pill.textContent = mode.label;
      pill.dataset.mode = mode.id;
      pill.style.cssText = `
        display: inline-block;
        padding: 6px 12px;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid #444;
        border-radius: 12px;
        font-size: 12px;
        color: #aaa;
        cursor: pointer;
        transition: all 0.2s;
      `;

      pill.addEventListener('click', () => {
        sizeMode = mode.id;
        updateSizeModeUI();
        if (active) {
          computeHierarchy();
          render();
        }
      });

      switcher.appendChild(pill);
    });

    document.body.appendChild(switcher);
  }

  /**
   * Update size mode pill UI
   */
  function updateSizeModeUI() {
    const pills = document.querySelectorAll('.size-mode-pill');
    pills.forEach(pill => {
      if (pill.dataset.mode === sizeMode) {
        pill.style.background = 'rgba(255, 255, 255, 0.3)';
        pill.style.color = '#fff';
        pill.style.borderColor = '#666';
      } else {
        pill.style.background = 'rgba(255, 255, 255, 0.1)';
        pill.style.color = '#aaa';
        pill.style.borderColor = '#444';
      }
    });
  }

  /**
   * Activate view - resize, compute, render
   */
  function activate() {
    active = true;
    resizeCanvas();
    computeHierarchy();
    render();

    // Show size mode switcher
    const switcher = document.getElementById('treemap-size-switcher');
    if (switcher) {
      switcher.style.display = 'flex';
    }
    updateSizeModeUI();
  }

  /**
   * Deactivate view
   */
  function deactivate() {
    active = false;
    hoveredDev = null;
    tooltip.style.display = 'none';

    // Hide size mode switcher
    const switcher = document.getElementById('treemap-size-switcher');
    if (switcher) {
      switcher.style.display = 'none';
    }
  }

  /**
   * Called when filters change
   */
  function onFilterChange() {
    if (!active) return;
    computeHierarchy();
    render();
  }

  /**
   * Resize canvas to match display size
   */
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    width = rect.width;
    height = rect.height;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
  }

  /**
   * Compute hierarchy from games data
   */
  function computeHierarchy() {
    const data = window._steamData;
    if (!data || !data.allGames) return;

    // Filter games
    const filteredGames = data.allGames.filter(g => data.gamePassesFilter(g));

    // Group by developer
    const devMap = new Map();
    filteredGames.forEach(game => {
      const dev = game[8] || 'Unknown';
      if (!devMap.has(dev)) {
        devMap.set(dev, {
          name: dev,
          games: [],
          totalReviews: 0,
          totalRevenue: 0,
          genreCounts: new Map(),
          avgRating: 0
        });
      }
      const devData = devMap.get(dev);
      devData.games.push(game);
      devData.totalReviews += game[3] || 0;
      devData.totalRevenue += (game[4] || 0) * (game[3] || 0);

      // Track genres for mode calculation
      const genreIdxs = game[6] || [];
      genreIdxs.forEach(gIdx => {
        devData.genreCounts.set(gIdx, (devData.genreCounts.get(gIdx) || 0) + 1);
      });
    });

    // Compute average ratings and mode genre
    devMap.forEach(devData => {
      const ratingsSum = devData.games.reduce((sum, g) => sum + (g[2] || 0), 0);
      devData.avgRating = devData.games.length > 0 ? ratingsSum / devData.games.length : 0;

      // Find mode genre
      let maxCount = 0;
      let modeGenre = -1;
      devData.genreCounts.forEach((count, genreIdx) => {
        if (count > maxCount) {
          maxCount = count;
          modeGenre = genreIdx;
        }
      });
      devData.genreIdx = modeGenre;
    });

    // Convert to array and sort by total reviews
    let developers = Array.from(devMap.values());
    developers.sort((a, b) => b.totalReviews - a.totalReviews);

    // Take top 200 developers
    developers = developers.slice(0, 200);

    // Group by genre
    const genreGroups = new Map();
    developers.forEach(dev => {
      const genreIdx = dev.genreIdx;
      const genreName = genreIdx >= 0 ? data.genreNames[genreIdx] : 'Unknown';

      if (!genreGroups.has(genreName)) {
        genreGroups.set(genreName, {
          name: genreName,
          genreIdx: genreIdx,
          children: []
        });
      }
      genreGroups.get(genreName).children.push(dev);
    });

    // Build hierarchy
    const hierarchyData = {
      name: 'root',
      children: Array.from(genreGroups.values())
    };

    // Create d3 hierarchy
    rootNode = d3.hierarchy(hierarchyData)
      .sum(d => {
        if (d.games) {
          // Leaf node (developer)
          if (sizeMode === 'reviews') return d.totalReviews;
          if (sizeMode === 'games') return d.games.length;
          if (sizeMode === 'revenue') return d.totalRevenue;
        }
        return 0;
      })
      .sort((a, b) => b.value - a.value);

    // Apply treemap layout
    treemapLayout.size([width, height])(rootNode);
  }

  /**
   * Render the treemap
   */
  function render() {
    if (!rootNode) return;

    // Clear canvas
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, width, height);

    // If zoomed, only show that genre's developers
    const nodesToRender = zoomedGenre
      ? rootNode.children.find(c => c.data.genreIdx === zoomedGenre.genreIdx)?.children || []
      : rootNode.descendants().slice(1); // Skip root

    // Render genre groups (if not zoomed)
    if (!zoomedGenre) {
      rootNode.children.forEach(genreNode => {
        renderGenreGroup(genreNode);
      });
    }

    // Render developers
    const developerNodes = zoomedGenre
      ? nodesToRender
      : rootNode.descendants().filter(d => d.depth === 2);

    developerNodes.forEach(devNode => {
      renderDeveloper(devNode);
    });

    // Render hover highlight
    if (hoveredDev) {
      renderDeveloper(hoveredDev, true);
    }
  }

  /**
   * Get developer brand color (exact or partial match)
   */
  function getDevColor(devName) {
    // Exact match
    if (PUBLISHER_COLORS.has(devName)) return PUBLISHER_COLORS.get(devName);
    // Partial match (e.g., "Valve Corporation" matches "Valve")
    for (const [key, color] of PUBLISHER_COLORS) {
      if (devName.includes(key) || key.includes(devName)) return color;
    }
    // No match found
    return null;
  }

  /**
   * Render a genre group header
   */
  function renderGenreGroup(genreNode) {
    const { x0, y0, x1, y1 } = genreNode;
    const data = window._steamData;

    // Genre border with slight glow
    ctx.strokeStyle = getGenreColor(genreNode.data.genreIdx);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);

    // Genre name in header
    ctx.fillStyle = '#aaa';
    ctx.font = '13px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    const text = genreNode.data.name || 'Unknown';
    const maxWidth = x1 - x0 - 8;
    const truncated = truncateText(text, maxWidth);

    ctx.fillText(truncated, x0 + 4, y0 + 3);
  }

  /**
   * Render a developer rectangle
   */
  function renderDeveloper(devNode, isHovered = false) {
    const { x0, y0, x1, y1 } = devNode;
    const w = x1 - x0;
    const h = y1 - y0;

    if (w < 2 || h < 2) return; // Too small

    const devData = devNode.data;
    const data = window._steamData;

    // Background fill - brand color with genre fallback
    const brandColor = getDevColor(devData.name);
    const genreIdx = devData.genreIdx;
    const genreColor = genreIdx >= 0 && data.genreNames ? getGenreColor(genreIdx) : '#666';
    const baseColor = brandColor || genreColor;

    ctx.fillStyle = isHovered
      ? adjustColorBrightness(baseColor, 1.5)
      : baseColor + 'cc'; // 0.8 alpha
    ctx.fillRect(x0, y0, w, h);

    // Border
    ctx.strokeStyle = isHovered ? '#fff' : '#333';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0, y0, w, h);

    // Developer name (if fits)
    if (w > 40 && h > 20) {
      ctx.fillStyle = '#ddd';
      ctx.font = '11px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const text = devData.name || 'Unknown';
      const maxWidth = w - 8;
      const truncated = truncateText(text, maxWidth);

      ctx.fillText(truncated, x0 + w / 2, y0 + h / 2);
    }
  }

  /**
   * Get genre color (simple hash-based)
   */
  function getGenreColor(genreIdx) {
    const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#95a5a6'];
    return colors[Math.abs(genreIdx) % colors.length] || '#888';
  }

  /**
   * Get rating index from ratio (0-100)
   */
  function getRatingIndex(ratio) {
    if (ratio >= 95) return 0; // Overwhelmingly Positive
    if (ratio >= 85) return 1; // Very Positive
    if (ratio >= 80) return 2; // Positive
    if (ratio >= 70) return 3; // Mostly Positive
    if (ratio >= 40) return 4; // Mixed
    if (ratio >= 20) return 5; // Mostly Negative
    if (ratio >= 10) return 6; // Negative
    if (ratio >= 5) return 7; // Very Negative
    return 8; // Overwhelmingly Negative
  }

  /**
   * Adjust color brightness
   */
  function adjustColorBrightness(hex, factor) {
    const rgb = hexToRgb(hex);
    if (!rgb) return hex;

    const r = Math.min(255, Math.floor(rgb.r * factor));
    const g = Math.min(255, Math.floor(rgb.g * factor));
    const b = Math.min(255, Math.floor(rgb.b * factor));

    return `rgb(${r}, ${g}, ${b})`;
  }

  /**
   * Convert hex to RGB
   */
  function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : null;
  }

  /**
   * Truncate text to fit width
   */
  function truncateText(text, maxWidth) {
    const metrics = ctx.measureText(text);
    if (metrics.width <= maxWidth) return text;

    let truncated = text;
    while (truncated.length > 0) {
      truncated = truncated.slice(0, -1);
      const testMetrics = ctx.measureText(truncated + '…');
      if (testMetrics.width <= maxWidth) {
        return truncated + '…';
      }
    }
    return '';
  }

  /**
   * Handle mouse move
   */
  function handleMouseMove(e) {
    if (!rootNode) return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (width / rect.width);
    const y = (e.clientY - rect.top) * (height / rect.height);

    // Find hovered developer
    const developerNodes = zoomedGenre
      ? rootNode.children.find(c => c.data.genreIdx === zoomedGenre.genreIdx)?.children || []
      : rootNode.descendants().filter(d => d.depth === 2);

    const hovered = developerNodes.find(d => {
      return x >= d.x0 && x <= d.x1 && y >= d.y0 && y <= d.y1;
    });

    if (hovered !== hoveredDev) {
      hoveredDev = hovered;
      render();

      if (hoveredDev) {
        showTooltip(hoveredDev, e.clientX, e.clientY);
      } else {
        tooltip.style.display = 'none';
      }
    } else if (hoveredDev) {
      // Update tooltip position
      tooltip.style.left = (e.clientX + 15) + 'px';
      tooltip.style.top = (e.clientY + 15) + 'px';
    }
  }

  /**
   * Handle click
   */
  function handleClick(e) {
    if (!rootNode) return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (width / rect.width);
    const y = (e.clientY - rect.top) * (height / rect.height);

    // Check if clicking a genre group (if not zoomed)
    if (!zoomedGenre) {
      const genreNode = rootNode.children.find(g => {
        return x >= g.x0 && x <= g.x1 && y >= g.y0 && y <= g.y1;
      });

      if (genreNode) {
        // Zoom into genre
        zoomedGenre = {
          genreIdx: genreNode.data.genreIdx,
          genreName: genreNode.data.name,
          developers: genreNode.children
        };

        // Recompute layout for zoomed view
        const zoomedRoot = d3.hierarchy({
          name: genreNode.data.name,
          children: genreNode.children.map(c => c.data)
        })
          .sum(d => {
            if (d.games) {
              if (sizeMode === 'reviews') return d.totalReviews;
              if (sizeMode === 'games') return d.games.length;
              if (sizeMode === 'revenue') return d.totalRevenue;
            }
            return 0;
          })
          .sort((a, b) => b.value - a.value);

        treemapLayout.size([width, height])(zoomedRoot);

        // Replace children in original node
        genreNode.children = zoomedRoot.children;

        render();
        return;
      }
    } else {
      // Check if clicking outside developers (zoom out)
      const developerNodes = rootNode.children.find(c => c.data.genreIdx === zoomedGenre.genreIdx)?.children || [];
      const clickedDev = developerNodes.find(d => {
        return x >= d.x0 && x <= d.x1 && y >= d.y0 && y <= d.y1;
      });

      if (!clickedDev) {
        // Zoom out
        zoomedGenre = null;
        computeHierarchy(); // Recompute full hierarchy
        render();
      }
    }
  }

  /**
   * Handle mouse leave
   */
  function handleMouseLeave() {
    hoveredDev = null;
    tooltip.style.display = 'none';
    render();
  }

  /**
   * Show tooltip for developer
   */
  function showTooltip(devNode, clientX, clientY) {
    const devData = devNode.data;
    const data = window._steamData;

    // Find top game
    const topGame = devData.games.reduce((max, g) => {
      return (g[3] || 0) > (max[3] || 0) ? g : max;
    }, devData.games[0]);

    const ratingIdx = getRatingIndex(devData.avgRating);
    const ratingName = data.ratingNames[ratingIdx];

    let html = `<strong>${devData.name}</strong><br>`;
    html += `Games: ${devData.games.length}<br>`;
    html += `Total Reviews: ${devData.totalReviews.toLocaleString()}<br>`;
    html += `Avg Rating: ${devData.avgRating.toFixed(1)}% (${ratingName})<br>`;
    html += `Top Game: ${topGame[0]} (${topGame[3].toLocaleString()} reviews)`;

    tooltip.innerHTML = html;
    tooltip.style.display = 'block';
    tooltip.style.left = (clientX + 15) + 'px';
    tooltip.style.top = (clientY + 15) + 'px';
  }

  // Register module
  window._steamViews = window._steamViews || {};
  window._steamViews.treemap = {
    init,
    activate,
    deactivate,
    onFilterChange
  };

})();
