/**
 * Radial Dendrogram — Full Taxonomy View for Steam Universe
 * Shows ALL games: Root → Genres → Tags → Games
 * Each game appears once under its primary genre + primary tag.
 * Uses LOD rendering and SCREEN-CONSTANT sizes (nodes/labels don't shrink with zoom).
 */
(function() {
  'use strict';

  let active = false;
  let canvas, ctx;
  let dpr = window.devicePixelRatio || 1;
  let width = 0, height = 0;

  let hierarchy = null;
  let rootNode = null;
  let allNodes = [];
  let gameNodes = [];
  let tagNodes = [];
  let genreNodes = [];

  let transform = d3.zoomIdentity;
  let zoomBehavior = null;
  let hoveredNode = null;
  let tooltip = null;
  let renderRAF = null;

  // Valve-themed palette — high intensity, primary, white prominent
  const GENRE_COLORS = [
    '#FFFFFF', // 0  Indie — pure white, biggest genre, maximum contrast
    '#FF0000', // 1  Action — pure red
    '#FF8800', // 2  Casual — vivid orange
    '#00AAFF', // 3  Adventure — electric blue
    '#00DD00', // 4  Simulation — vivid green
    '#0055FF', // 5  Strategy — royal blue
    '#BB00FF', // 6  RPG — electric purple
    '#FFFFFF', // 7  Early Access — white (Valve clean)
    '#CCFF00', // 8  Free To Play — neon chartreuse
    '#FF6600', // 9  Sports — hot orange
    '#FF0066', // 10 Racing — hot magenta
    '#00DDFF', // 11 Massively Multiplayer — electric cyan
    '#AABBCC', // 12 Utilities — bright steel
    '#FFCC00', // 13 Design & Illustration — vivid gold
    '#DD0000', // 14 Violent — intense red
    '#00FFAA', // 15 Animation & Modeling — neon mint
    '#0088FF', // 16 Education — bright blue
    '#FF2222', // 17 Video Production — bright red
    '#AA0000', // 18 Gore — deep crimson
    '#00FF44', // 19 Game Development — neon green
    '#CC44FF', // 20 Audio Production — vivid violet
    '#22BBFF', // 21 Software Training — sky blue
    '#FFEE00', // 22 Photo Editing — vivid yellow
    '#FF44AA', // 23 Nudity — hot pink
    '#00FFCC', // 24 Web Publishing — neon aqua
    '#FF0055', // 25 Sexual Content — vivid rose
    '#BBCCDD', // 26 Accounting — bright gray
    '#EE5500', // 27 Movie — bright burnt orange
    '#99AABB', // 28 Documentary — steel blue
    '#CC55FF', // 29 Episodic — vivid purple
    '#44CCFF', // 30 Short — bright sky
    '#44FFCC', // 31 Tutorial — bright aqua
    '#DDEEFF', // 32 360 Video — bright white-blue
  ];

  function init() {
    canvas = document.getElementById('canvas-tree');
    if (!canvas) return;
    ctx = canvas.getContext('2d');

    tooltip = document.createElement('div');
    tooltip.className = 'viz-tooltip';
    tooltip.style.cssText = `
      position: fixed; pointer-events: none;
      background: rgba(10,10,10,0.95); border: 1px solid #444;
      border-radius: 6px; padding: 8px 12px;
      font-size: 13px; line-height: 1.5; color: #ddd;
      display: none; z-index: 10000; max-width: 320px;
    `;
    document.body.appendChild(tooltip);

    zoomBehavior = d3.zoom()
      .scaleExtent([0.001, 200])
      .filter((event) => !event.ctrlKey && !event.button)
      .on('zoom', (event) => {
        transform = event.transform;
        scheduleRender();
      });

    d3.select(canvas)
      .call(zoomBehavior)
      .on('dblclick.zoom', null);

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('click', handleClick);
    canvas.addEventListener('mouseleave', handleMouseLeave);

    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        handleMouseMove({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY });
      }
    }, { passive: true });
    canvas.addEventListener('touchend', (e) => {
      if (hoveredNode) {
        handleClick({ clientX: e.changedTouches[0].clientX, clientY: e.changedTouches[0].clientY });
      }
    });
  }

  function scheduleRender() {
    if (renderRAF) return;
    renderRAF = requestAnimationFrame(() => { renderRAF = null; render(); });
  }

  function activate() {
    active = true;
    resize();
    buildHierarchy();
    // Start fully expanded — show the entire tree including outermost game ring
    fitToView(false, 'all');
    render();
  }

  function fitToView(animate, level) {
    if (!rootNode) return;
    const fitLevel = level || 'all';

    let maxR = 0;
    for (const { node, x, y } of allNodes) {
      if (fitLevel === 'genre' && node.depth > 1) continue;
      if (fitLevel === 'tag' && node.depth > 2) continue;
      // 'all' — no filtering, consider every node
      const r = Math.sqrt(x * x + y * y);
      if (r > maxR) maxR = r;
    }

    const padding = 120;
    const fitScale = Math.min(width, height) / (2 * maxR + padding);
    const newTransform = d3.zoomIdentity
      .translate(width / 2, height / 2)
      .scale(fitScale);

    if (animate) {
      d3.select(canvas).transition().duration(750)
        .call(zoomBehavior.transform, newTransform);
    } else {
      d3.select(canvas).call(zoomBehavior.transform, newTransform);
    }
  }

  function deactivate() {
    active = false;
    tooltip.style.display = 'none';
    hoveredNode = null;
  }

  function onFilterChange() {
    if (!active) return;
    buildHierarchy();
    render();
  }

  function buildHierarchy() {
    const data = window._steamData;
    if (!data || !data.allGames) return;
    tagColorCache.clear();

    const games = data.allGames.filter(g => data.gamePassesFilter(g));
    const genreMap = new Map();

    for (const game of games) {
      const genreIdxs = game[6] || [];
      const tagIdxs = game[7] || [];
      const primaryGenre = genreIdxs[0];
      const primaryTag = tagIdxs[0];

      if (primaryGenre === undefined) continue;
      const genreName = data.genreNames[primaryGenre];
      if (!genreName) continue;

      if (!genreMap.has(primaryGenre)) {
        genreMap.set(primaryGenre, { name: genreName, tagMap: new Map(), untagged: [] });
      }
      const gd = genreMap.get(primaryGenre);

      if (primaryTag !== undefined && data.tagNames[primaryTag]) {
        if (!gd.tagMap.has(primaryTag)) gd.tagMap.set(primaryTag, []);
        gd.tagMap.get(primaryTag).push(game);
      } else {
        gd.untagged.push(game);
      }
    }

    const genreEntries = Array.from(genreMap.entries())
      .map(([gIdx, gd]) => {
        const totalGames = Array.from(gd.tagMap.values()).reduce((s, arr) => s + arr.length, 0) + gd.untagged.length;
        return { gIdx, name: gd.name, tagMap: gd.tagMap, untagged: gd.untagged, totalGames };
      })
      .sort((a, b) => b.totalGames - a.totalGames);

    const hierarchyData = {
      name: 'Steam',
      children: genreEntries.map(genre => {
        const tagEntries = Array.from(genre.tagMap.entries())
          .map(([tIdx, tagGames]) => ({
            tIdx, name: data.tagNames[tIdx], games: tagGames, count: tagGames.length,
          }))
          .sort((a, b) => b.count - a.count);

        const children = tagEntries.map(tag => ({
          name: tag.name,
          genreIdx: genre.gIdx,
          tagGames: tag.count,
          avgRating: tag.games.reduce((s, g) => s + g[2], 0) / tag.games.length,
          children: tag.games
            .sort((a, b) => b[3] - a[3])
            .map(game => ({
              name: game[0], game, genreIdx: genre.gIdx, reviews: game[3],
            }))
        }));

        if (genre.untagged.length > 0) {
          children.push({
            name: 'Other', genreIdx: genre.gIdx,
            tagGames: genre.untagged.length,
            avgRating: genre.untagged.reduce((s, g) => s + g[2], 0) / genre.untagged.length,
            children: genre.untagged
              .sort((a, b) => b[3] - a[3])
              .map(game => ({
                name: game[0], game, genreIdx: genre.gIdx, reviews: game[3],
              }))
          });
        }

        return { name: genre.name, genreIdx: genre.gIdx, totalGames: genre.totalGames, children };
      })
    };

    hierarchy = d3.hierarchy(hierarchyData);

    const leafCount = hierarchy.leaves().length;
    // Formula: R = minSpacing * leafCount / (2*PI)
    // With 3px minimum spacing between leaf neighbors at outermost ring
    const MIN_LEAF_SPACING = 3;
    const R_GAME  = Math.max(20000, MIN_LEAF_SPACING * leafCount / (2 * Math.PI));
    // Hand-picked depth radii: compact inner rings, spacious outer ring
    const R_GENRE = R_GAME * 0.08;    // genre ring at 8% of game ring
    const R_TAG   = R_GAME * 0.30;    // tag ring at 30% of game ring

    // Depth-to-radius mapping for d3.cluster (linear, then we override)
    const tree = d3.cluster()
      .size([2 * Math.PI, R_GAME])
      .separation((a, b) => {
        if (a.depth === 3 && b.depth === 3) return (a.parent === b.parent ? 1 : 2) / a.depth;
        if (a.depth === 2 && b.depth === 2) return (a.parent === b.parent ? 1 : 2) / a.depth;
        return (a.parent === b.parent ? 1.5 : 3) / a.depth;
      });

    rootNode = tree(hierarchy);

    // Override radii with non-linear depth spacing
    rootNode.descendants().forEach(node => {
      if (node.depth === 0) node.y = 0;
      else if (node.depth === 1) node.y = R_GENRE;
      else if (node.depth === 2) node.y = R_TAG;
      else node.y = R_GAME;  // depth 3 (games)
    });

    allNodes = [];
    gameNodes = [];
    tagNodes = [];
    genreNodes = [];
    rootNode.descendants().forEach(node => {
      const angle = node.x - Math.PI / 2;
      const r = node.y;
      const x = r * Math.cos(angle);
      const y = r * Math.sin(angle);
      const entry = { node, x, y };
      allNodes.push(entry);
      if (node.depth === 3) gameNodes.push(entry);
      else if (node.depth === 2) tagNodes.push(entry);
      else if (node.depth === 1) genreNodes.push(entry);
    });
  }

  // ── Helper: resolve color — genres get GENRE_COLORS, tags get unique hue per subsection ──
  // Golden angle spacing for max perceptual distinction between sibling tags
  const GOLDEN_ANGLE = 137.508;

  // HSL → hex so we can append alpha hex digits for canvas strokeStyle
  function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = n => {
      const k = (n + h / 30) % 12;
      const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return '#' + f(0) + f(8) + f(4);
  }

  // Pre-build tag color cache so we don't recompute every frame
  const tagColorCache = new Map();

  function getNodeColor(node) {
    // Root
    if (node.depth === 0) return '#fff';

    // Genre level — use GENRE_COLORS
    if (node.depth === 1) {
      const gIdx = node.data.genreIdx;
      return gIdx !== undefined ? GENRE_COLORS[gIdx % GENRE_COLORS.length] : '#888';
    }

    // Tag level — unique hue per tag within its genre, as hex
    if (node.depth === 2) {
      if (tagColorCache.has(node)) return tagColorCache.get(node);
      const parent = node.parent;
      if (!parent || !parent.children) return '#888';
      const siblingIdx = parent.children.indexOf(node);
      const hue = (siblingIdx * GOLDEN_ANGLE) % 360;
      const hex = hslToHex(hue, 100, 55);
      tagColorCache.set(node, hex);
      return hex;
    }

    // Game level — inherit tag color
    if (node.depth === 3 && node.parent) {
      return getNodeColor(node.parent);
    }

    return '#888';
  }

  function render() {
    if (!rootNode || !active) return;

    ctx.save();
    ctx.clearRect(0, 0, width, height);

    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.k, transform.k);

    const k = transform.k;
    const invK = 1 / k;

    // Viewport culling in world coords
    const vx0 = -transform.x / k;
    const vy0 = -transform.y / k;
    const vx1 = (width - transform.x) / k;
    const vy1 = (height - transform.y) / k;
    const margin = 300 * invK;

    function inView(x, y) {
      return x >= vx0 - margin && x <= vx1 + margin && y >= vy0 - margin && y <= vy1 + margin;
    }

    // ── All data visible at all zoom levels — no LOD culling ──
    const showTagLinks = true;
    const showGameLinks = true;
    const showTagNodes = true;
    const showGameNodes = true;

    // ══════════ LINKS ══════════
    ctx.lineWidth = 1.2 * invK;

    rootNode.links().forEach(link => {
      const depth = link.target.depth;
      if (depth === 3 && !showGameLinks) return;
      if (depth === 2 && !showTagLinks) return;

      const sa = link.source.x - Math.PI / 2;
      const sr = link.source.y;
      const ta = link.target.x - Math.PI / 2;
      const tr = link.target.y;

      const sx = sr * Math.cos(sa), sy = sr * Math.sin(sa);
      const tx = tr * Math.cos(ta), ty = tr * Math.sin(ta);
      if (!inView(tx, ty) && !inView(sx, sy)) return;

      const color = getNodeColor(link.target);
      const alpha = depth === 3 ? '88' : depth === 2 ? 'BB' : 'FF';
      ctx.strokeStyle = color + alpha;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      const cpA = (sa + ta) / 2;
      const cpR = (sr + tr) / 2;
      ctx.quadraticCurveTo(cpR * Math.cos(cpA), cpR * Math.sin(cpA), tx, ty);
      ctx.stroke();
    });

    // ══════════ NODES (screen-constant sizes) ══════════

    // Genre + Root nodes (always visible)
    for (const { node, x, y } of allNodes) {
      if (node.depth > 1) continue;
      if (!inView(x, y)) continue;

      const screenR = node.depth === 0 ? 10 * invK : 7 * invK;
      const fillColor = node.depth === 0 ? '#fff' : getNodeColor(node);
      const isHovered = hoveredNode === node;

      if (isHovered) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2.5 * invK;
        ctx.beginPath();
        ctx.arc(x, y, screenR + 3 * invK, 0, 2 * Math.PI);
        ctx.stroke();
      }

      ctx.fillStyle = fillColor;
      ctx.beginPath();
      ctx.arc(x, y, screenR, 0, 2 * Math.PI);
      ctx.fill();
    }

    // Tag nodes
    if (showTagNodes) {
      for (const { node, x, y } of tagNodes) {
        if (!inView(x, y)) continue;
        const screenR = 4 * invK;
        const baseColor = getNodeColor(node);
        const isHovered = hoveredNode === node;

        if (isHovered) {
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2 * invK;
          ctx.beginPath();
          ctx.arc(x, y, screenR + 2 * invK, 0, 2 * Math.PI);
          ctx.stroke();
        }

        ctx.fillStyle = baseColor;
        ctx.beginPath();
        ctx.arc(x, y, screenR, 0, 2 * Math.PI);
        ctx.fill();
      }
    }

    // Game nodes
    if (showGameNodes) {
      const gameR = 2 * invK;
      const buckets = new Map();
      for (const { node, x, y } of gameNodes) {
        if (!inView(x, y)) continue;
        const color = getNodeColor(node);
        if (!buckets.has(color)) buckets.set(color, []);
        buckets.get(color).push({ x, y, node });
      }

      buckets.forEach((entries, color) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        for (const { x, y } of entries) {
          ctx.moveTo(x + gameR, y);
          ctx.arc(x, y, gameR, 0, 2 * Math.PI);
        }
        ctx.fill();
      });

      if (hoveredNode && hoveredNode.depth === 3) {
        const entry = gameNodes.find(e => e.node === hoveredNode);
        if (entry) {
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2 * invK;
          ctx.beginPath();
          ctx.arc(entry.x, entry.y, gameR + 3 * invK, 0, 2 * Math.PI);
          ctx.stroke();
        }
      }
    }

    // ══════════ LABELS (screen-constant fonts) ══════════
    for (const { node, x, y } of allNodes) {
      if (!inView(x, y)) continue;

      let showLabel = false;
      if (node.depth === 0) showLabel = true;
      else if (node.depth === 1) showLabel = true;
      else if (node.depth === 2) showLabel = true; // always show tag labels
      else if (node.depth === 3 && k >= 0.02 && node.data.reviews >= 10000) showLabel = true;
      else if (node.depth === 3 && k >= 0.05 && node.data.reviews >= 1000) showLabel = true;
      else if (node.depth === 3 && k >= 0.12) showLabel = true;
      else if (node === hoveredNode) showLabel = true;

      if (!showLabel) continue;

      const angle = node.x - Math.PI / 2;
      ctx.save();
      ctx.translate(x, y);

      let textAngle = angle;
      const flip = angle > Math.PI / 2 || angle < -Math.PI / 2;
      if (flip) textAngle += Math.PI;
      ctx.rotate(textAngle);

      const labelColor = node === hoveredNode ? '#fff' : (node.depth <= 1 ? '#eee' : '#bbb');
      ctx.fillStyle = labelColor;

      // Screen-constant font sizes (divide by k)
      const baseFontSize = node.depth === 0 ? 14 : node.depth === 1 ? 12 : node.depth === 2 ? 10 : 9;
      const fontSize = baseFontSize * invK;
      const bold = node.depth <= 1 ? 'bold ' : '';
      ctx.font = bold + fontSize + 'px -apple-system, sans-serif';
      ctx.textAlign = flip ? 'right' : 'left';
      ctx.textBaseline = 'middle';

      const nodeR = node.depth === 0 ? 10 : node.depth === 1 ? 7 : node.depth === 2 ? 4 : 2;
      const offset = flip ? -(nodeR + 5) * invK : (nodeR + 5) * invK;

      let label = node.data.name;
      if (node.depth === 1) label += ` (${node.data.totalGames.toLocaleString()})`;
      else if (node.depth === 2) label += ` (${node.data.tagGames})`;
      if (label.length > 35) label = label.substring(0, 33) + '...';

      ctx.fillText(label, offset, 0);
      ctx.restore();
    }

    ctx.restore();
    drawStats();
  }

  function drawStats() {
    if (!hierarchy) return;

    const totalGames = hierarchy.leaves().length;
    const genreCount = hierarchy.children ? hierarchy.children.length : 0;
    const tagCount = hierarchy.children ? hierarchy.children.reduce((s, g) => s + (g.children ? g.children.length : 0), 0) : 0;

    ctx.save();
    ctx.fillStyle = 'rgba(10, 10, 10, 0.85)';
    ctx.fillRect(10, 10, 340, 50);
    ctx.fillStyle = '#ddd';
    ctx.font = '13px -apple-system, sans-serif';
    ctx.fillText(`${genreCount} genres \u2192 ${tagCount} tags \u2192 ${totalGames.toLocaleString()} games`, 20, 30);
    ctx.fillStyle = '#888';
    ctx.font = '11px -apple-system, sans-serif';
    ctx.fillText('Zoom to explore. Click a genre to focus.', 20, 48);
    ctx.restore();
  }

  function handleMouseMove(e) {
    if (!active || !rootNode) return;

    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left - transform.x) / transform.k;
    const my = (e.clientY - rect.top - transform.y) / transform.k;

    const k = transform.k;
    const invK = 1 / k;
    let closest = null;
    let minDist = Infinity;

    // All nodes are always interactive — search everything
    const searchList = allNodes;

    for (const { node, x, y } of searchList) {
      const dx = mx - x;
      const dy = my - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Hit radius in world coords (screen-constant)
      const hitR = (node.depth <= 1 ? 12 : node.depth === 2 ? 8 : 5) * invK;

      if (dist < hitR && dist < minDist) {
        minDist = dist;
        closest = node;
      }
    }

    if (closest !== hoveredNode) {
      hoveredNode = closest;
      scheduleRender();
    }

    if (hoveredNode) {
      tooltip.innerHTML = getTooltipContent(hoveredNode);
      tooltip.style.display = 'block';
      tooltip.style.left = (e.clientX + 15) + 'px';
      tooltip.style.top = (e.clientY + 15) + 'px';
    } else {
      tooltip.style.display = 'none';
    }
  }

  function getTooltipContent(node) {
    const data = window._steamData;

    if (node.depth === 0) {
      return `<strong>Steam Universe</strong><br>${hierarchy.leaves().length.toLocaleString()} games`;
    } else if (node.depth === 1) {
      return `<strong>${node.data.name}</strong> (Genre)<br>
        ${node.data.totalGames.toLocaleString()} games<br>
        ${node.children ? node.children.length : 0} tags`;
    } else if (node.depth === 2) {
      const avg = node.data.avgRating ? node.data.avgRating.toFixed(1) : '?';
      return `<strong>${node.data.name}</strong> (Tag)<br>
        ${node.data.tagGames.toLocaleString()} games<br>
        Avg rating: ${avg}%`;
    } else {
      const game = node.data.game;
      if (!game) return node.data.name;
      const [name, year, ratio, reviews, price, ratingIdx] = game;
      const rating = data.ratingNames[ratingIdx] || 'Unknown';
      return `<strong>${name}</strong><br>
        Developer: ${game[8] || 'Unknown'}<br>
        Year: ${year} &middot; ${rating}<br>
        ${ratio.toFixed(1)}% positive &middot; ${reviews.toLocaleString()} reviews<br>
        ${price > 0 ? '$' + price.toFixed(2) : 'Free'}`;
    }
  }

  function handleClick(e) {
    if (!hoveredNode) {
      fitToView(true, 'all');
      return;
    }

    if (hoveredNode.depth <= 2) {
      const angle = hoveredNode.x - Math.PI / 2;
      const r = hoveredNode.y;
      const x = r * Math.cos(angle);
      const y = r * Math.sin(angle);

      // Zoom to show this node's subtree
      let targetK;
      if (hoveredNode.depth === 0) {
        fitToView(true, 'all');
        return;
      } else if (hoveredNode.depth === 1) {
        targetK = 0.15;
      } else {
        targetK = 0.5;
      }

      const tx = width / 2 - x * targetK;
      const ty = height / 2 - y * targetK;

      d3.select(canvas).transition().duration(750)
        .call(zoomBehavior.transform, d3.zoomIdentity.translate(tx, ty).scale(targetK));
    }
  }

  function handleMouseLeave() {
    if (hoveredNode) {
      hoveredNode = null;
      tooltip.style.display = 'none';
      scheduleRender();
    }
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (active) { buildHierarchy(); render(); }
  }

  window._steamViews = window._steamViews || {};
  window._steamViews.tree = {
    _initialized: false,
    init,
    activate,
    deactivate,
    onFilterChange,

    // Search: zoom to a game node
    selectGame(game) {
      if (!rootNode || !gameNodes.length) return false;

      const title = game[0].toLowerCase();
      let target = null;
      for (const entry of gameNodes) {
        if (entry.node.data.game === game) { target = entry; break; }
      }
      if (!target) {
        for (const entry of gameNodes) {
          if (entry.node.data.name.toLowerCase() === title) { target = entry; break; }
        }
      }
      if (!target) return false;

      // Zoom to center on this game node
      const targetK = 0.5;
      const tx = width / 2 - target.x * targetK;
      const ty = height / 2 - target.y * targetK;

      d3.select(canvas).transition().duration(500)
        .call(zoomBehavior.transform, d3.zoomIdentity.translate(tx, ty).scale(targetK));

      hoveredNode = target.node;
      scheduleRender();
      return true;
    }
  };

  window.addEventListener('resize', () => { if (active) resize(); });
})();
