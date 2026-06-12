(function() {
  'use strict';

  const GENRE_COLORS = [
    '#4ade80', '#60a5fa', '#f97316', '#a78bfa', '#22d3ee', '#facc15',
    '#fb7185', '#34d399', '#c084fc', '#f472b6', '#38bdf8', '#fbbf24'
  ];

  let canvas, ctx, width, height, dpr;
  let drillLevel = 0; // 0: genres, 1: developers, 2: games
  let drillTarget = null; // genre index or developer name
  let drillParent = null; // for level 2, store genre index
  let animationProgress = 1; // 0-1 for transitions
  let isAnimating = false;
  let hoveredItem = null;
  let tooltip = null;

  function init() {
    if (window._steamViews.flower._initialized) return;

    canvas = document.getElementById('canvas-flower');
    if (!canvas) {
      console.error('Canvas element #canvas-flower not found');
      return;
    }

    ctx = canvas.getContext('2d');
    dpr = window.devicePixelRatio || 1;

    // Create tooltip
    tooltip = document.createElement('div');
    tooltip.style.cssText = `
      position: fixed;
      background: rgba(0,0,0,0.9);
      color: white;
      padding: 8px 12px;
      border-radius: 4px;
      font-size: 13px;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.2s;
      z-index: 1000;
      max-width: 300px;
      white-space: pre-line;
    `;
    document.body.appendChild(tooltip);

    // Event listeners
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('mouseleave', () => {
      hoveredItem = null;
      hideTooltip();
      scheduleRender();
    });

    window._steamViews.flower._initialized = true;
  }

  function activate() {
    if (!window._steamViews.flower._initialized) init();
    drillLevel = 0;
    drillTarget = null;
    drillParent = null;
    animationProgress = 1;
    isAnimating = false;
    hoveredItem = null;
    resize();
    scheduleRender();
  }

  function deactivate() {
    hideTooltip();
    hoveredItem = null;
  }

  function onFilterChange() {
    scheduleRender();
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
  }

  let renderScheduled = false;
  function scheduleRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
      render();
    });
  }

  function onMouseMove(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const cx = width / 2;
    const cy = height / 2;
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);

    let newHovered = null;

    if (drillLevel === 0) {
      // Check center
      if (dist < 80) {
        newHovered = { type: 'center' };
      } else {
        // Check genre petals
        const petals = getGenrePetals();
        for (let i = 0; i < petals.length; i++) {
          const p = petals[i];
          if (dist >= p.innerRadius && dist <= p.outerRadius) {
            let a = angle;
            if (a < 0) a += Math.PI * 2;
            let startA = p.startAngle;
            let endA = p.endAngle;
            if (startA < 0) startA += Math.PI * 2;
            if (endA < 0) endA += Math.PI * 2;
            if (endA < startA) endA += Math.PI * 2;
            if (a < startA) a += Math.PI * 2;
            if (a >= startA && a <= endA) {
              newHovered = { type: 'genre', index: i, data: p };
              break;
            }
          }
        }
      }
    } else if (drillLevel === 1) {
      // Check center
      if (dist < 60) {
        newHovered = { type: 'center' };
      } else {
        // Check developer petals
        const petals = getDeveloperPetals();
        for (let i = 0; i < petals.length; i++) {
          const p = petals[i];
          if (dist >= p.innerRadius && dist <= p.outerRadius) {
            let a = angle;
            if (a < 0) a += Math.PI * 2;
            let startA = p.startAngle;
            let endA = p.endAngle;
            if (startA < 0) startA += Math.PI * 2;
            if (endA < 0) endA += Math.PI * 2;
            if (endA < startA) endA += Math.PI * 2;
            if (a < startA) a += Math.PI * 2;
            if (a >= startA && a <= endA) {
              newHovered = { type: 'developer', index: i, data: p };
              break;
            }
          }
        }
      }
    } else if (drillLevel === 2) {
      // Check center
      if (dist < 50) {
        newHovered = { type: 'center' };
      } else {
        // Check game dots
        const dots = getGameDots();
        for (let i = 0; i < dots.length; i++) {
          const d = dots[i];
          const ddx = x - d.x;
          const ddy = y - d.y;
          const ddist = Math.sqrt(ddx * ddx + ddy * ddy);
          if (ddist < d.radius + 2) {
            newHovered = { type: 'game', index: i, data: d };
            break;
          }
        }
      }
    }

    if (JSON.stringify(newHovered) !== JSON.stringify(hoveredItem)) {
      hoveredItem = newHovered;
      scheduleRender();
      if (hoveredItem) {
        showTooltip(e.clientX, e.clientY);
      } else {
        hideTooltip();
      }
    } else if (hoveredItem) {
      // Update tooltip position
      tooltip.style.left = (e.clientX + 15) + 'px';
      tooltip.style.top = (e.clientY + 15) + 'px';
    }
  }

  function onClick() {
    if (!hoveredItem || isAnimating) return;

    if (hoveredItem.type === 'center') {
      // Drill back up
      if (drillLevel > 0) {
        drillUp();
      }
    } else if (hoveredItem.type === 'genre') {
      // Drill into genre
      drillIntoGenre(hoveredItem.index);
    } else if (hoveredItem.type === 'developer') {
      // Drill into developer
      drillIntoDeveloper(hoveredItem.data.name);
    }
  }

  function drillIntoGenre(genreIndex) {
    isAnimating = true;
    animationProgress = 0;
    drillLevel = 1;
    drillTarget = genreIndex;
    animate();
  }

  function drillIntoDeveloper(devName) {
    isAnimating = true;
    animationProgress = 0;
    drillLevel = 2;
    drillParent = drillTarget;
    drillTarget = devName;
    animate();
  }

  function drillUp() {
    isAnimating = true;
    animationProgress = 0;
    if (drillLevel === 2) {
      drillLevel = 1;
      drillTarget = drillParent;
      drillParent = null;
    } else if (drillLevel === 1) {
      drillLevel = 0;
      drillTarget = null;
    }
    animate();
  }

  function animate() {
    const start = performance.now();
    const duration = 400;

    function step(now) {
      const elapsed = now - start;
      animationProgress = Math.min(elapsed / duration, 1);

      // Ease in-out
      const t = animationProgress;
      const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      animationProgress = eased;

      render();

      if (elapsed < duration) {
        requestAnimationFrame(step);
      } else {
        isAnimating = false;
        animationProgress = 1;
        render();
      }
    }

    requestAnimationFrame(step);
  }

  function getGenrePetals() {
    const data = window._steamData;
    if (!data) return [];

    // Count games per genre
    const genreCounts = {};
    const genreRatings = {};
    const genrePrices = {};
    const genreTopGame = {};

    data.allGames.forEach(game => {
      if (!data.gamePassesFilter(game)) return;
      const genreIdxs = game[6] || [];
      const rating = game[2] || 0;
      const price = game[4] || 0;
      const reviews = game[3] || 0;

      genreIdxs.forEach(gIdx => {
        const gName = data.genreNames[gIdx];
        if (!gName) return;
        genreCounts[gName] = (genreCounts[gName] || 0) + 1;
        genreRatings[gName] = (genreRatings[gName] || 0) + rating;
        genrePrices[gName] = (genrePrices[gName] || 0) + price;
        if (!genreTopGame[gName] || reviews > (genreTopGame[gName][3] || 0)) {
          genreTopGame[gName] = game;
        }
      });
    });

    // Top 12 genres by count
    const genres = Object.entries(genreCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12);

    const totalGames = genres.reduce((sum, [_, count]) => sum + count, 0);
    if (totalGames === 0) return [];

    // Build petals
    const petals = [];
    let currentAngle = -Math.PI / 2; // Start at top

    genres.forEach(([name, count], i) => {
      const avgRating = genreRatings[name] / count;
      const avgPrice = genrePrices[name] / count;
      const topGame = genreTopGame[name];

      const angularWidth = (count / totalGames) * Math.PI * 2;
      const startAngle = currentAngle;
      const endAngle = currentAngle + angularWidth;

      // Length based on avg rating (0-100)
      const maxRadius = Math.min(width, height) * 0.35;
      const minRadius = maxRadius * 0.3;
      const outerRadius = minRadius + (avgRating / 100) * (maxRadius - minRadius);

      petals.push({
        name,
        count,
        avgRating,
        avgPrice,
        topGame,
        startAngle,
        endAngle,
        innerRadius: 80,
        outerRadius,
        color: GENRE_COLORS[i % GENRE_COLORS.length]
      });

      currentAngle = endAngle;
    });

    return petals;
  }

  function getDeveloperPetals() {
    const data = window._steamData;
    if (!data || drillTarget === null) return [];

    const genreName = data.genreNames[drillTarget];
    if (!genreName) return [];

    // Count games per developer in this genre
    const devCounts = {};
    const devRatings = {};

    data.allGames.forEach(game => {
      if (!data.gamePassesFilter(game)) return;
      const genreIdxs = game[6] || [];
      if (!genreIdxs.includes(drillTarget)) return;

      const dev = game[8] || 'Unknown';
      devCounts[dev] = (devCounts[dev] || 0) + 1;
      devRatings[dev] = (devRatings[dev] || 0) + (game[2] || 0);
    });

    // Top 10 developers
    const devs = Object.entries(devCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    const totalGames = devs.reduce((sum, [_, count]) => sum + count, 0);
    if (totalGames === 0) return [];

    const petals = [];
    let currentAngle = -Math.PI / 2;

    devs.forEach(([name, count]) => {
      const avgRating = devRatings[name] / count;

      const angularWidth = (count / totalGames) * Math.PI * 2;
      const startAngle = currentAngle;
      const endAngle = currentAngle + angularWidth;

      // Color based on rating: green (100) → yellow (50) → red (0)
      let r, g, b;
      if (avgRating >= 50) {
        const t = (avgRating - 50) / 50;
        r = Math.round(250 * (1 - t) + 74 * t);
        g = Math.round(204 * (1 - t) + 222 * t);
        b = Math.round(21 * (1 - t) + 128 * t);
      } else {
        const t = avgRating / 50;
        r = 249;
        g = Math.round(117 * t + 204 * (1 - t));
        b = Math.round(66 * t + 21 * (1 - t));
      }
      const color = `rgb(${r},${g},${b})`;

      const maxRadius = Math.min(width, height) * 0.35;
      const minRadius = maxRadius * 0.4;
      const outerRadius = minRadius + (count / Math.max(...devs.map(d => d[1]))) * (maxRadius - minRadius);

      petals.push({
        name,
        count,
        avgRating,
        startAngle,
        endAngle,
        innerRadius: 60,
        outerRadius,
        color
      });

      currentAngle = endAngle;
    });

    return petals;
  }

  function getGameDots() {
    const data = window._steamData;
    if (!data || drillTarget === null) return [];

    const genreIdx = drillParent;
    const devName = drillTarget;

    // Filter games
    const games = data.allGames.filter(game => {
      if (!data.gamePassesFilter(game)) return false;
      const genreIdxs = game[6] || [];
      if (!genreIdxs.includes(genreIdx)) return false;
      const dev = game[8] || 'Unknown';
      return dev === devName;
    });

    // Sort by review count
    games.sort((a, b) => (b[3] || 0) - (a[3] || 0));

    const cx = width / 2;
    const cy = height / 2;
    const dots = [];

    // Spiral layout
    const maxRadius = Math.min(width, height) * 0.4;
    let angle = 0;
    let radius = 60;
    const angleStep = 0.3;
    const radiusStep = 3;

    games.forEach(game => {
      const reviews = game[3] || 0;
      const ratingIdx = game[5] || 0;
      const dotRadius = Math.max(3, Math.min(20, Math.sqrt(reviews) * 0.5));

      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;

      dots.push({
        game,
        x,
        y,
        radius: dotRadius,
        color: data.RATING_COLORS[ratingIdx] || '#888'
      });

      angle += angleStep;
      radius += radiusStep;

      if (radius > maxRadius) {
        radius = 60;
        angle += Math.PI / 6;
      }
    });

    return dots;
  }

  function render() {
    if (!ctx) return;

    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, width, height);

    const cx = width / 2;
    const cy = height / 2;

    const alpha = isAnimating ? animationProgress : 1;

    if (drillLevel === 0) {
      renderLevel0(cx, cy, alpha);
    } else if (drillLevel === 1) {
      renderLevel1(cx, cy, alpha);
    } else if (drillLevel === 2) {
      renderLevel2(cx, cy, alpha);
    }

    // Stats overlay
    renderStats();
  }

  function renderLevel0(cx, cy, alpha) {
    ctx.globalAlpha = alpha;

    const petals = getGenrePetals();
    const data = window._steamData;

    // Draw petals
    petals.forEach((petal, i) => {
      const isHovered = hoveredItem?.type === 'genre' && hoveredItem.index === i;

      ctx.fillStyle = petal.color;
      if (isHovered) {
        ctx.globalAlpha = alpha * 0.8;
      } else {
        ctx.globalAlpha = alpha * 0.6;
      }

      drawPetal(cx, cy, petal.innerRadius, petal.outerRadius, petal.startAngle, petal.endAngle);

      // Label
      ctx.globalAlpha = alpha;
      const midAngle = (petal.startAngle + petal.endAngle) / 2;
      const labelRadius = (petal.innerRadius + petal.outerRadius) / 2;
      const lx = cx + Math.cos(midAngle) * labelRadius;
      const ly = cy + Math.sin(midAngle) * labelRadius;

      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate(midAngle + Math.PI / 2);
      ctx.fillStyle = 'white';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(petal.name, 0, 0);
      ctx.restore();
    });

    // Center circle
    ctx.globalAlpha = alpha;
    const centerHovered = hoveredItem?.type === 'center';
    ctx.fillStyle = centerHovered ? '#222' : '#111';
    ctx.beginPath();
    ctx.arc(cx, cy, 80, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = 'white';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Steam', cx, cy - 15);

    const totalGames = data?.allGames?.filter(g => data.gamePassesFilter(g)).length || 0;
    ctx.font = '14px sans-serif';
    ctx.fillText(`${totalGames.toLocaleString()} games`, cx, cy + 10);

    ctx.globalAlpha = 1;
  }

  function renderLevel1(cx, cy, alpha) {
    ctx.globalAlpha = alpha;

    const petals = getDeveloperPetals();
    const data = window._steamData;
    const genreName = data?.genreNames[drillTarget] || 'Genre';

    // Draw petals
    petals.forEach((petal, i) => {
      const isHovered = hoveredItem?.type === 'developer' && hoveredItem.index === i;

      ctx.fillStyle = petal.color;
      if (isHovered) {
        ctx.globalAlpha = alpha * 0.9;
      } else {
        ctx.globalAlpha = alpha * 0.7;
      }

      drawPetal(cx, cy, petal.innerRadius, petal.outerRadius, petal.startAngle, petal.endAngle);

      // Label
      ctx.globalAlpha = alpha;
      const midAngle = (petal.startAngle + petal.endAngle) / 2;
      const labelRadius = (petal.innerRadius + petal.outerRadius) / 2;
      const lx = cx + Math.cos(midAngle) * labelRadius;
      const ly = cy + Math.sin(midAngle) * labelRadius;

      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate(midAngle + Math.PI / 2);
      ctx.fillStyle = 'white';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const shortName = petal.name.length > 20 ? petal.name.slice(0, 17) + '...' : petal.name;
      ctx.fillText(shortName, 0, 0);
      ctx.restore();
    });

    // Center circle
    ctx.globalAlpha = alpha;
    const centerHovered = hoveredItem?.type === 'center';
    ctx.fillStyle = centerHovered ? '#222' : '#111';
    ctx.beginPath();
    ctx.arc(cx, cy, 60, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = 'white';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(genreName, cx, cy - 10);

    const totalGames = petals.reduce((sum, p) => sum + p.count, 0);
    ctx.font = '12px sans-serif';
    ctx.fillText(`${totalGames} games`, cx, cy + 10);

    // Back button hint
    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#888';
    ctx.fillText('← Back', cx, cy + 30);

    ctx.globalAlpha = 1;
  }

  function renderLevel2(cx, cy, alpha) {
    ctx.globalAlpha = alpha;

    const dots = getGameDots();
    const data = window._steamData;
    const genreName = data?.genreNames[drillParent] || 'Genre';
    const devName = drillTarget || 'Developer';

    // Draw game dots
    dots.forEach((dot, i) => {
      const isHovered = hoveredItem?.type === 'game' && hoveredItem.index === i;

      ctx.fillStyle = dot.color;
      if (isHovered) {
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, dot.radius + 2, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.globalAlpha = alpha * 0.8;
      }

      ctx.beginPath();
      ctx.arc(dot.x, dot.y, dot.radius, 0, Math.PI * 2);
      ctx.fill();

      // Label top games
      if (i < 5 && dot.radius > 8) {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = 'white';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const name = dot.game[0].length > 15 ? dot.game[0].slice(0, 12) + '...' : dot.game[0];
        ctx.fillText(name, dot.x, dot.y + dot.radius + 2);
      }
    });

    // Center circle
    ctx.globalAlpha = alpha;
    const centerHovered = hoveredItem?.type === 'center';
    ctx.fillStyle = centerHovered ? '#222' : '#111';
    ctx.beginPath();
    ctx.arc(cx, cy, 50, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = 'white';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const shortDevName = devName.length > 15 ? devName.slice(0, 12) + '...' : devName;
    ctx.fillText(shortDevName, cx, cy - 5);

    ctx.font = '11px sans-serif';
    ctx.fillText(`${dots.length} games`, cx, cy + 10);

    // Back button hint
    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#888';
    ctx.fillText('← Back', cx, cy + 25);

    ctx.globalAlpha = 1;
  }

  function drawPetal(cx, cy, innerRadius, outerRadius, startAngle, endAngle) {
    ctx.beginPath();
    ctx.arc(cx, cy, innerRadius, startAngle, endAngle);
    ctx.arc(cx, cy, outerRadius, endAngle, startAngle, true);
    ctx.closePath();
    ctx.fill();
  }

  function renderStats() {
    const data = window._steamData;
    if (!data) return;

    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(10, 10, 250, 60);

    ctx.fillStyle = 'white';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    if (drillLevel === 0) {
      ctx.fillText('Genre Flower', 20, 20);
      ctx.font = '12px sans-serif';
      ctx.fillText('Click a petal to drill into genre', 20, 40);
    } else if (drillLevel === 1) {
      const genreName = data.genreNames[drillTarget] || 'Genre';
      ctx.fillText(`${genreName} - Top Developers`, 20, 20);
      ctx.font = '12px sans-serif';
      ctx.fillText('Click a petal to see games', 20, 40);
    } else if (drillLevel === 2) {
      const genreName = data.genreNames[drillParent] || 'Genre';
      const devName = drillTarget || 'Developer';
      const shortDev = devName.length > 20 ? devName.slice(0, 17) + '...' : devName;
      ctx.fillText(`${genreName} - ${shortDev}`, 20, 20);
      ctx.font = '12px sans-serif';
      ctx.fillText('Hover for game details', 20, 40);
    }
  }

  function showTooltip(x, y) {
    if (!hoveredItem) return;

    const data = window._steamData;
    let html = '';

    if (hoveredItem.type === 'genre') {
      const p = hoveredItem.data;
      html = `<b>${p.name}</b>\n`;
      html += `${p.count.toLocaleString()} games\n`;
      html += `Avg rating: ${p.avgRating.toFixed(1)}%\n`;
      html += `Avg price: $${p.avgPrice.toFixed(2)}\n`;
      if (p.topGame) {
        html += `Top: ${p.topGame[0]}`;
      }
    } else if (hoveredItem.type === 'developer') {
      const p = hoveredItem.data;
      html = `<b>${p.name}</b>\n`;
      html += `${p.count} games in this genre\n`;
      html += `Avg rating: ${p.avgRating.toFixed(1)}%`;
    } else if (hoveredItem.type === 'game') {
      const game = hoveredItem.data.game;
      html = `<b>${game[0]}</b>\n`;
      html += `Year: ${game[1]}\n`;
      html += `Rating: ${game[2]}% (${game[3].toLocaleString()} reviews)\n`;
      html += `Price: $${game[4]}\n`;
      html += `Developer: ${game[8] || 'Unknown'}`;
    } else if (hoveredItem.type === 'center') {
      if (drillLevel > 0) {
        html = 'Click to go back';
      } else {
        const totalGames = data?.allGames?.filter(g => data.gamePassesFilter(g)).length || 0;
        html = `<b>Steam Universe</b>\n${totalGames.toLocaleString()} games`;
      }
    }

    tooltip.innerHTML = html;
    tooltip.style.left = (x + 15) + 'px';
    tooltip.style.top = (y + 15) + 'px';
    tooltip.style.opacity = '1';
  }

  function hideTooltip() {
    if (tooltip) {
      tooltip.style.opacity = '0';
    }
  }

  // Export module
  window._steamViews = window._steamViews || {};
  window._steamViews.flower = {
    _initialized: false,
    init,
    activate,
    deactivate,
    onFilterChange
  };

})();
