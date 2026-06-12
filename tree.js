/**
 * Radial Dendrogram (Taxonomic Tree) View for Steam Universe
 * Shows hierarchical structure: Root → Genres → Tags → Top Games
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
  let allNodes = []; // For hit detection

  // Zoom/Pan state
  let transform = d3.zoomIdentity;
  let zoomBehavior = null;

  // Interaction state
  let hoveredNode = null;

  // Shared tooltip (viewport-clamped, reusable)
  const tip = SteamViz.makeTooltip();

  // Touch/pointer hover unbind handle (set in activate, cleared in deactivate)
  let unbindPointerHover = null;

  /**
   * One-time initialization
   */
  function init() {
    canvas = document.getElementById('canvas-tree');
    if (!canvas) {
      console.error('Canvas element canvas-tree not found');
      return;
    }
    ctx = canvas.getContext('2d');

    // Set up zoom behavior
    zoomBehavior = d3.zoom()
      .scaleExtent([0.3, 8])
      .on('zoom', (event) => {
        transform = event.transform;
        render();
      });

    d3.select(canvas).call(zoomBehavior);

    // Event listeners
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('click', handleClick);
    canvas.addEventListener('mouseleave', handleMouseLeave);
  }

  /**
   * Called when tab becomes active
   */
  function activate() {
    active = true;
    resize();
    buildHierarchy();
    render();

    // Wire touch (and pointer) hover for node highlight + tooltip.
    // Mouse hover stays on the native mousemove listener in init().
    if (!unbindPointerHover) {
      unbindPointerHover = SteamViz.bindPointerHover(canvas, (p) => handleHover(p));
    }
  }

  /**
   * Called when switching away from this tab
   */
  function deactivate() {
    active = false;
    tip.hide();
    hoveredNode = null;
    if (unbindPointerHover) {
      unbindPointerHover();
      unbindPointerHover = null;
    }
  }

  /**
   * Called when filters change
   */
  function onFilterChange() {
    if (!active) return;
    buildHierarchy();
    render();
  }

  /**
   * Build hierarchical data structure
   */
  function buildHierarchy() {
    const data = window._steamData;
    if (!data || !data.allGames) return;

    // Filter games
    const games = data.allGames.filter(g => data.gamePassesFilter(g));

    // Build genre → tags → games hierarchy
    const genreMap = new Map();

    games.forEach(game => {
      const genreIdxs = game[6] || [];
      const tagIdxs = game[7] || [];

      genreIdxs.forEach(gIdx => {
        const genreName = data.genreNames[gIdx];
        if (!genreName) return;

        if (!genreMap.has(genreName)) {
          genreMap.set(genreName, { tags: new Map(), games: [] });
        }

        const genreData = genreMap.get(genreName);
        genreData.games.push(game);

        // Track tags within this genre
        tagIdxs.forEach(tIdx => {
          const tagName = data.tagNames[tIdx];
          if (!tagName) return;

          if (!genreData.tags.has(tagName)) {
            genreData.tags.set(tagName, []);
          }
          genreData.tags.get(tagName).push(game);
        });
      });
    });

    // Convert to D3 hierarchy format
    // Take top 12 genres by game count
    const genreEntries = Array.from(genreMap.entries())
      .map(([name, data]) => ({
        name,
        games: data.games,
        tags: data.tags,
        count: data.games.length
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);

    const hierarchyData = {
      name: 'Steam',
      children: genreEntries.map((genre, gIdx) => {
        // Top 5 tags for this genre
        const topTags = Array.from(genre.tags.entries())
          .map(([tagName, tagGames]) => ({ tagName, tagGames, count: tagGames.length }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5);

        return {
          name: genre.name,
          genreIdx: gIdx,
          totalGames: genre.count,
          children: topTags.map(tag => {
            // Top 3 games for this tag by review count
            const topGames = tag.tagGames
              .sort((a, b) => b[3] - a[3])
              .slice(0, 3);

            return {
              name: tag.tagName,
              genreIdx: gIdx,
              tagGames: tag.count,
              avgRating: tag.tagGames.reduce((sum, g) => sum + g[2], 0) / tag.tagGames.length,
              children: topGames.map(game => ({
                name: game[0], // title
                game: game,
                genreIdx: gIdx
              }))
            };
          })
        };
      })
    };

    hierarchy = d3.hierarchy(hierarchyData);

    // Create tree layout
    const radius = Math.min(width, height) * 0.45;
    const tree = d3.tree()
      .size([2 * Math.PI, radius])
      .separation((a, b) => (a.parent === b.parent ? 1 : 2) / a.depth);

    rootNode = tree(hierarchy);
  }

  /**
   * Render the visualization
   */
  function render() {
    if (!rootNode) return;

    ctx.save();
    ctx.clearRect(0, 0, width, height);

    // Apply zoom transform
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.k, transform.k);

    // Center point
    const cx = width / 2 / transform.k - transform.x / transform.k;
    const cy = height / 2 / transform.k - transform.y / transform.k;

    ctx.translate(cx, cy);

    allNodes = [];

    // Draw links first
    ctx.lineWidth = 1 / transform.k;
    rootNode.links().forEach(link => {
      const sourceAngle = link.source.x - Math.PI / 2;
      const sourceRadius = link.source.y;
      const targetAngle = link.target.x - Math.PI / 2;
      const targetRadius = link.target.y;

      const sx = sourceRadius * Math.cos(sourceAngle);
      const sy = sourceRadius * Math.sin(sourceAngle);
      const tx = targetRadius * Math.cos(targetAngle);
      const ty = targetRadius * Math.sin(targetAngle);

      // Determine genre color (from parent chain)
      let genreIdx = link.target.data.genreIdx;
      if (genreIdx === undefined && link.target.parent) {
        genreIdx = link.target.parent.data.genreIdx;
      }
      if (genreIdx === undefined && link.target.parent && link.target.parent.parent) {
        genreIdx = link.target.parent.parent.data.genreIdx;
      }

      const color = genreIdx !== undefined ? SteamViz.genreColor(genreIdx) : '#888';

      ctx.strokeStyle = color + '4d'; // 30% opacity
      ctx.beginPath();
      ctx.moveTo(sx, sy);

      // Curved link (quadratic)
      const cpAngle = (sourceAngle + targetAngle) / 2;
      const cpRadius = (sourceRadius + targetRadius) / 2;
      const cpx = cpRadius * Math.cos(cpAngle);
      const cpy = cpRadius * Math.sin(cpAngle);
      ctx.quadraticCurveTo(cpx, cpy, tx, ty);

      ctx.stroke();
    });

    // Draw nodes
    rootNode.descendants().forEach(node => {
      const angle = node.x - Math.PI / 2;
      const radius = node.y;
      const x = radius * Math.cos(angle);
      const y = radius * Math.sin(angle);

      // Node size based on depth
      let r;
      if (node.depth === 0) r = 12; // root
      else if (node.depth === 1) r = 8; // genre
      else if (node.depth === 2) r = 5; // tag
      else r = 3; // game

      // Color based on depth
      let fillColor;
      if (node.depth === 0) {
        fillColor = '#fff';
      } else {
        // Get genre index
        let genreIdx = node.data.genreIdx;
        if (genreIdx === undefined && node.parent) {
          genreIdx = node.parent.data.genreIdx;
        }
        if (genreIdx === undefined && node.parent && node.parent.parent) {
          genreIdx = node.parent.parent.data.genreIdx;
        }

        const baseColor = genreIdx !== undefined ? SteamViz.genreColor(genreIdx) : '#888';

        if (node.depth === 1) fillColor = baseColor; // genre
        else if (node.depth === 2) fillColor = baseColor + '99'; // tag (60% opacity)
        else fillColor = baseColor + '66'; // game (40% opacity)
      }

      // Highlight the hovered node and its lineage (ancestors up to the root
      // and everything beneath it). d3's ancestors() excludes the node itself,
      // so compare against the hovered node directly to ring the whole path.
      const isHovered = hoveredNode === node;
      const inHoverPath = !!hoveredNode && !isHovered &&
        (hoveredNode.ancestors().includes(node) || node.ancestors().includes(hoveredNode));

      if (isHovered || inHoverPath) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2 / transform.k;
        ctx.beginPath();
        ctx.arc(x, y, r + 2, 0, 2 * Math.PI);
        ctx.stroke();
      }

      ctx.fillStyle = fillColor;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fill();

      // Draw labels
      const shouldShowLabel =
        node.depth === 0 || // root always
        node.depth === 1 || // genres always
        (node.depth === 2 && transform.k >= 1) || // tags at default zoom
        (node.depth === 3 && isHovered); // games on hover only

      if (shouldShowLabel) {
        ctx.save();
        ctx.translate(x, y);

        // Rotate for radial alignment
        let textAngle = angle;
        if (angle > Math.PI / 2 || angle < -Math.PI / 2) {
          textAngle += Math.PI;
        }
        ctx.rotate(textAngle);

        ctx.fillStyle = '#ddd';
        ctx.font = node.depth === 1 ? 'bold 12px sans-serif' : '11px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        const label = node.data.name;
        const offset = r + 6;
        ctx.fillText(label, offset, 0);

        ctx.restore();
      }

      // Store for hit detection
      allNodes.push({ node, x, y, r });
    });

    ctx.restore();

    // Draw stats
    drawStats();
  }

  /**
   * Draw statistics overlay
   */
  function drawStats() {
    if (!hierarchy) return;

    const genreCount = hierarchy.children ? hierarchy.children.length : 0;
    const tagCount = hierarchy.children ? hierarchy.children.reduce((sum, g) => sum + (g.children ? g.children.length : 0), 0) : 0;
    const gameCount = hierarchy.children ? hierarchy.children.reduce((sum, g) =>
      sum + (g.children ? g.children.reduce((s2, t) => s2 + (t.children ? t.children.length : 0), 0) : 0), 0) : 0;

    ctx.save();
    ctx.fillStyle = 'rgba(10, 10, 10, 0.8)';
    ctx.fillRect(10, 10, 280, 40);
    ctx.fillStyle = '#ddd';
    ctx.font = '13px sans-serif';
    ctx.fillText(`${genreCount} genres → ${tagCount} tags → ${gameCount} games`, 20, 35);
    ctx.restore();
  }

  /**
   * Handle mouse movement for hover effects
   */
  function handleMouseMove(e) {
    handleHover(SteamViz.pointerPos(canvas, e));
  }

  /**
   * Shared hover handler for mouse and touch.
   * `p` is a pointerPos: { x, y, clientX, clientY }, where x/y are relative to
   * the canvas (equivalent to clientX/Y minus the canvas bounding-rect origin).
   */
  function handleHover(p) {
    if (!active || !rootNode) return;

    // Undo the d3 zoom transform exactly as the original mouse handler did,
    // using canvas-relative coordinates from pointerPos.
    const mx = (p.x - transform.x) / transform.k - width / 2 / transform.k;
    const my = (p.y - transform.y) / transform.k - height / 2 / transform.k;

    // Find closest node within threshold
    let closest = null;
    let minDist = Infinity;

    allNodes.forEach(({ node, x, y, r }) => {
      const dx = mx - x;
      const dy = my - y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < r + 5 && dist < minDist) {
        minDist = dist;
        closest = node;
      }
    });

    if (closest !== hoveredNode) {
      hoveredNode = closest;
      render();
    }

    // Update tooltip
    if (hoveredNode) {
      tip.show(getTooltipContent(hoveredNode), p.clientX, p.clientY);
    } else {
      tip.hide();
    }
  }

  /**
   * Get tooltip content for a node
   */
  function getTooltipContent(node) {
    const data = window._steamData;

    if (node.depth === 0) {
      // Root
      return `<strong>Steam Universe</strong><br>Entire game catalog`;
    } else if (node.depth === 1) {
      // Genre
      const topDev = getTopDeveloper(node);
      return `<strong>${node.data.name}</strong> (Genre)<br>
        ${node.data.totalGames.toLocaleString()} games<br>
        Top dev: ${topDev}`;
    } else if (node.depth === 2) {
      // Tag
      const avgRating = node.data.avgRating.toFixed(1);
      return `<strong>${node.data.name}</strong> (Tag)<br>
        ${node.data.tagGames} games<br>
        Avg rating: ${avgRating}%`;
    } else {
      // Game
      const game = node.data.game;
      const [name, year, ratio, reviews, price, ratingIdx] = game;
      const rating = data.ratingNames[ratingIdx] || 'Unknown';

      return `<strong>${name}</strong><br>
        Developer: ${game[8] || 'Unknown'}<br>
        Year: ${year}<br>
        Rating: ${rating} (${ratio.toFixed(1)}%)<br>
        Reviews: ${reviews.toLocaleString()}<br>
        Price: $${price.toFixed(2)}`;
    }
  }

  /**
   * Get top developer for a genre
   */
  function getTopDeveloper(genreNode) {
    const devCounts = new Map();

    // Traverse all games in this genre subtree
    genreNode.descendants().forEach(node => {
      if (node.data.game) {
        const dev = node.data.game[8] || 'Unknown';
        devCounts.set(dev, (devCounts.get(dev) || 0) + 1);
      }
    });

    const topDev = Array.from(devCounts.entries())
      .sort((a, b) => b[1] - a[1])[0];

    return topDev ? `${topDev[0]} (${topDev[1]})` : 'Unknown';
  }

  /**
   * Handle click - zoom to genre or reset
   */
  function handleClick(e) {
    if (!hoveredNode) {
      // Click on background - reset zoom
      d3.select(canvas)
        .transition()
        .duration(750)
        .call(zoomBehavior.transform, d3.zoomIdentity);
      return;
    }

    // Click on genre - zoom to it
    if (hoveredNode.depth === 1) {
      const angle = hoveredNode.x - Math.PI / 2;
      const radius = hoveredNode.y;
      const x = radius * Math.cos(angle);
      const y = radius * Math.sin(angle);

      const scale = 3;
      const centerX = width / 2;
      const centerY = height / 2;

      const translateX = centerX - x * scale;
      const translateY = centerY - y * scale;

      d3.select(canvas)
        .transition()
        .duration(750)
        .call(zoomBehavior.transform, d3.zoomIdentity.translate(translateX, translateY).scale(scale));
    }
  }

  /**
   * Handle mouse leave
   */
  function handleMouseLeave() {
    if (hoveredNode) {
      hoveredNode = null;
      tip.hide();
      render();
    }
  }

  /**
   * Resize canvas
   */
  function resize() {
    const setup = SteamViz.setupCanvas(canvas);
    ctx = setup.ctx;
    width = setup.width;
    height = setup.height;
    dpr = setup.dpr;

    if (active) {
      buildHierarchy();
      render();
    }
  }

  // Register module
  window._steamViews = window._steamViews || {};
  window._steamViews.tree = {
    _initialized: false,
    init,
    activate,
    deactivate,
    onFilterChange
  };

  // Handle window resize
  window.addEventListener('resize', () => {
    if (active) resize();
  });

})();
