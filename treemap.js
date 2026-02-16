(function() {
    'use strict';

    const canvas = document.getElementById('canvas-treemap');
    const ctx = canvas.getContext('2d');

    let active = false;
    let width = 0;
    let height = 0;
    let dpr = window.devicePixelRatio || 1;

    // Data
    let hierarchyData = null;
    let treemapLayout = null;
    let currentRoot = null;
    let fullHierarchyData = null;

    // Interaction
    let hoveredNode = null;
    let breadcrumb = [];
    let navigationStack = [];
    const breadcrumbHeight = 40;
    let backBtnRect = null;

    // Hierarchical color tracking
    let currentGenreIdx = null;

    // Animation
    let animation = null; // { startTime, duration, fromRects, nodes, root }

    // Rating color for game-level leaves
    function ratingColor(avgRatio) {
        const t = Math.max(0, Math.min(1, avgRatio / 100));
        return d3.interpolateRdYlGn(t);
    }

    // Genre color — vivid golden angle hue
    const genreColorCache = {};
    function genreColor(genreIndex) {
        if (genreColorCache[genreIndex]) return genreColorCache[genreIndex];
        const hue = (genreIndex * 137.508) % 360;
        const color = d3.hsl(hue, 0.80, 0.50).formatHex();
        genreColorCache[genreIndex] = color;
        return color;
    }

    // Tag color — desaturated version of parent genre
    function tagColor(genreIdx, avgRating) {
        if (genreIdx !== null && genreIdx !== undefined) {
            const hue = (genreIdx * 137.508) % 360;
            // Blend genre hue with rating lightness
            const ratingT = Math.max(0, Math.min(1, (avgRating || 50) / 100));
            const lightness = 0.25 + ratingT * 0.15; // 0.25 to 0.40
            return d3.hsl(hue, 0.35, lightness).formatHex();
        }
        return ratingColor(avgRating || 50);
    }

    // Node color based on hierarchy level
    function nodeColor(node) {
        if (node.data.isGenre) {
            return genreColor(node.data.genreIndex);
        } else if (node.data.isTag) {
            return tagColor(currentGenreIdx, node.data.avgRating);
        } else if (node.data.isGame) {
            return ratingColor(node.data.avgRating || 50);
        }
        return '#444';
    }

    function buildHierarchy() {
        const steamData = window._steamData;
        if (!steamData) return null;

        const { allGames, genreNames, tagNames, gamePassesFilter } = steamData;

        const genreMap = new Map();
        for (let i = 0; i < genreNames.length; i++) {
            genreMap.set(i, { name: genreNames[i], tags: new Map() });
        }

        allGames.forEach(game => {
            if (!gamePassesFilter(game)) return;

            const [name, year, ratio, reviews, price, ratingIdx, genreIdxs, tagIdxs, developer] = game;

            genreIdxs.forEach(genreIdx => {
                if (!genreMap.has(genreIdx)) return;
                const genre = genreMap.get(genreIdx);

                tagIdxs.forEach(tagIdx => {
                    if (!genre.tags.has(tagIdx)) {
                        genre.tags.set(tagIdx, {
                            name: tagNames[tagIdx],
                            games: [],
                            totalRatio: 0,
                            count: 0
                        });
                    }

                    const tag = genre.tags.get(tagIdx);
                    tag.games.push(game);
                    tag.totalRatio += ratio;
                    tag.count++;
                });
            });
        });

        const children = [];

        genreMap.forEach((genre, genreIdx) => {
            if (genre.tags.size === 0) return;

            const sortedTags = Array.from(genre.tags.values())
                .sort((a, b) => b.count - a.count)
                .slice(0, 20);

            const genreChildren = sortedTags.map(tag => {
                const topGames = tag.games
                    .sort((a, b) => b[3] - a[3])
                    .slice(0, 30);

                const gameChildren = topGames.map(game => ({
                    name: game[0],
                    value: Math.max(1, game[3]),
                    avgRating: game[2],
                    year: game[1],
                    reviews: game[3],
                    price: game[4],
                    developer: game[8] || '',
                    isGame: true,
                    _game: game
                }));

                return {
                    name: tag.name,
                    children: gameChildren,
                    avgRating: tag.totalRatio / tag.count,
                    totalGames: tag.count,
                    isTag: true
                };
            });

            children.push({
                name: genre.name,
                children: genreChildren,
                isGenre: true,
                genreIndex: genreIdx
            });
        });

        return {
            name: 'Steam',
            children: children,
            isRoot: true
        };
    }

    function computeTreemap(data) {
        const dataToUse = data || hierarchyData;
        if (!dataToUse) return;

        const root = d3.hierarchy(dataToUse)
            .sum(d => d.value || 0)
            .sort((a, b) => b.value - a.value);

        treemapLayout = d3.treemap()
            .size([width, height - breadcrumbHeight])
            .paddingTop(22)
            .paddingInner(2)
            .paddingOuter(4)
            .tile(d3.treemapSquarify)
            .round(true);

        treemapLayout(root);
        currentRoot = root;

        return root;
    }

    function resize() {
        if (!active) return;

        width = canvas.clientWidth;
        height = canvas.clientHeight;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        computeTreemap();
        render();
    }

    function getVisibleNodes(node) {
        return node.children || [];
    }

    function drawRoundedRect(x, y, w, h, r) {
        if (w < 2 * r) r = w / 2;
        if (h < 2 * r) r = h / 2;

        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    // Glassmorphic breadcrumb bar
    function drawBreadcrumb() {
        // Glass background
        ctx.fillStyle = 'rgba(10, 10, 10, 0.75)';
        ctx.fillRect(0, 0, width, breadcrumbHeight);

        // Subtle bottom border
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, breadcrumbHeight);
        ctx.lineTo(width, breadcrumbHeight);
        ctx.stroke();

        let x = 8;
        const y = breadcrumbHeight / 2 + 5;

        // Back button
        backBtnRect = null;
        if (navigationStack.length > 0) {
            const btnW = 50;
            const btnH = 26;
            const btnX = x;
            const btnY = (breadcrumbHeight - btnH) / 2;

            drawRoundedRect(btnX, btnY, btnW, btnH, 4);
            ctx.fillStyle = 'rgba(255,255,255,0.06)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.12)';
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.font = 'bold 13px "Helvetica Neue", sans-serif';
            ctx.fillStyle = '#aaa';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('\u2190 Back', btnX + btnW / 2, breadcrumbHeight / 2);

            backBtnRect = { x: btnX, y: btnY, w: btnW, h: btnH };
            x += btnW + 10;

            ctx.strokeStyle = 'rgba(255,255,255,0.08)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x - 5, 8);
            ctx.lineTo(x - 5, breadcrumbHeight - 8);
            ctx.stroke();
        }

        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.font = '12px "Helvetica Neue", sans-serif';

        breadcrumb.forEach((item, idx) => {
            const text = item.name;
            const metrics = ctx.measureText(text);

            if (item.isCurrent) {
                ctx.fillStyle = '#fff';
                ctx.font = 'bold 12px "Helvetica Neue", sans-serif';
            } else {
                ctx.fillStyle = '#666';
                ctx.font = '12px "Helvetica Neue", sans-serif';
            }

            ctx.fillText(text, x, y);
            item.x = x;
            item.width = metrics.width;

            x += metrics.width;

            if (idx < breadcrumb.length - 1) {
                ctx.fillStyle = '#444';
                ctx.font = '12px "Helvetica Neue", sans-serif';
                ctx.fillText(' \u203A ', x, y);
                x += ctx.measureText(' \u203A ').width;
            }
        });
    }

    function drawNode(node, rect) {
        const r = rect || node;
        const x = r.x0;
        const y = r.y0 + breadcrumbHeight;
        const w = r.x1 - r.x0;
        const h = r.y1 - r.y0;

        if (w < 1 || h < 1) return;

        const fillColor = nodeColor(node);

        // Hover effect
        if (hoveredNode === node) {
            ctx.globalAlpha = 1;
        } else if (hoveredNode) {
            ctx.globalAlpha = 0.7;
        } else {
            ctx.globalAlpha = 0.95;
        }

        // Soft glow shadow
        ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
        ctx.shadowBlur = 3;
        ctx.shadowOffsetX = 1;
        ctx.shadowOffsetY = 1;

        drawRoundedRect(x, y, w, h, 3);
        ctx.fillStyle = fillColor;
        ctx.fill();

        // Reset shadow for border
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;

        // Subtle inner glow border
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 0.5;
        ctx.stroke();

        ctx.globalAlpha = 1;

        // Labels with sqrt-based font capping
        if (w > 40 && h > 16) {
            ctx.save();
            ctx.rect(x + 2, y + 2, w - 4, h - 4);
            ctx.clip();

            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';

            if (node.data.isGenre) {
                // Sqrt-based font size, capped at 32px
                const fontSize = Math.min(32, Math.max(11, Math.sqrt(w * h) / 8));
                ctx.font = `bold ${fontSize}px "Helvetica Neue", sans-serif`;
                ctx.fillStyle = '#fff';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(node.data.name, x + w / 2, y + h / 2);
            }
            else if (node.data.isTag) {
                const fontSize = Math.min(14, Math.max(10, Math.sqrt(w * h) / 12));
                ctx.font = `${fontSize}px "Helvetica Neue", sans-serif`;
                ctx.fillStyle = '#fff';
                ctx.fillText(node.data.name, x + 5, y + 5);

                if (h > 34 && w > 80) {
                    ctx.font = '10px "Helvetica Neue", sans-serif';
                    ctx.fillStyle = '#ddd';
                    const count = node.data.totalGames || node.value || 0;
                    const rating = node.data.avgRating ? `${Math.round(node.data.avgRating)}%` : '';
                    ctx.fillText(`${count.toLocaleString()} games \u2022 ${rating}`, x + 5, y + 20);
                }
            }
            else if (node.data.isGame) {
                const name = node.data.name;
                const truncated = w < 100 && name.length > 15 ? name.slice(0, 13) + '\u2026' : name;

                ctx.font = w > 100 ? '11px "Helvetica Neue", sans-serif' : '9px "Helvetica Neue", sans-serif';
                ctx.fillStyle = '#fff';
                ctx.fillText(truncated, x + 4, y + 4);

                if (h > 30 && w > 60) {
                    ctx.font = '9px "Helvetica Neue", sans-serif';
                    ctx.fillStyle = '#ddd';
                    ctx.fillText(`${node.data.reviews.toLocaleString()} rev \u2022 ${Math.round(node.data.avgRating)}%`, x + 4, y + 17);
                }
            }

            ctx.restore();
        }
    }

    function render() {
        if (!active || !currentRoot) return;

        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, width, height);

        const nodes = getVisibleNodes(currentRoot);
        nodes.forEach(node => drawNode(node));

        drawBreadcrumb();

        if (hoveredNode) {
            drawTooltip(hoveredNode);
        }
    }

    // Animation frame renderer
    function animateFrame(timestamp) {
        if (!animation) return;

        const elapsed = timestamp - animation.startTime;
        const t = Math.min(1, elapsed / animation.duration);
        const eased = d3.easeCubicInOut(t);

        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, width, height);

        const nodes = animation.nodes;
        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            const from = animation.fromRects[i];
            const to = { x0: node.x0, y0: node.y0, x1: node.x1, y1: node.y1 };

            const interpolated = {
                x0: from.x0 + (to.x0 - from.x0) * eased,
                y0: from.y0 + (to.y0 - from.y0) * eased,
                x1: from.x1 + (to.x1 - from.x1) * eased,
                y1: from.y1 + (to.y1 - from.y1) * eased
            };

            // Fade in labels after 60%
            const labelAlpha = t < 0.6 ? 0 : (t - 0.6) / 0.4;
            ctx.globalAlpha = 0.3 + 0.7 * eased;

            drawNode(node, interpolated);
        }

        ctx.globalAlpha = 1;
        drawBreadcrumb();

        if (t < 1) {
            requestAnimationFrame(animateFrame);
        } else {
            animation = null;
            render();
        }
    }

    function animateTransition(newData, clickedRect) {
        // Compute new treemap
        hierarchyData = newData;
        const root = computeTreemap(newData);
        updateBreadcrumb(root);

        const nodes = getVisibleNodes(root);

        // Build "from" rects — all start from clicked rect (drill-in) or full viewport (back)
        const fromRects = nodes.map(() => {
            if (clickedRect) {
                return {
                    x0: clickedRect.x0,
                    y0: clickedRect.y0,
                    x1: clickedRect.x1,
                    y1: clickedRect.y1
                };
            } else {
                // Back navigation — animate from full viewport center
                return {
                    x0: width * 0.1,
                    y0: (height - breadcrumbHeight) * 0.1,
                    x1: width * 0.9,
                    y1: (height - breadcrumbHeight) * 0.9
                };
            }
        });

        animation = {
            startTime: performance.now(),
            duration: 500,
            fromRects,
            nodes,
            root
        };

        hoveredNode = null;
        requestAnimationFrame(animateFrame);
    }

    function drawTooltip(node) {
        const data = node.data;
        if (!data) return;

        const lines = [];
        lines.push(data.name);

        if (data.isGame) {
            lines.push(`${data.year} \u2022 ${Math.round(data.avgRating)}% positive`);
            lines.push(`${data.reviews.toLocaleString()} reviews`);
            if (data.price !== undefined) {
                lines.push(data.price > 0 ? `$${data.price.toFixed(2)}` : 'Free');
            }
            if (data.developer) {
                lines.push(`by ${data.developer}`);
            }
        } else if (data.isTag) {
            const count = data.totalGames || node.value || 0;
            const rating = data.avgRating ? `${Math.round(data.avgRating)}%` : 'N/A';
            lines.push(`${count.toLocaleString()} games \u2022 ${rating} positive`);
            lines.push('Click to see top games');
        } else {
            const count = node.value || 0;
            lines.push(`${count.toLocaleString()} games`);
            lines.push('Click to explore tags');
        }

        ctx.font = '12px "Helvetica Neue", monospace';
        const lineHeight = 16;
        const padding = 10;
        const maxWidth = Math.max(...lines.map(l => ctx.measureText(l).width));
        const tooltipWidth = maxWidth + padding * 2;
        const tooltipHeight = lines.length * lineHeight + padding * 2;

        let tooltipX = node.x0 + (node.x1 - node.x0) / 2 - tooltipWidth / 2;
        let tooltipY = node.y0 + breadcrumbHeight - tooltipHeight - 8;

        if (tooltipX + tooltipWidth > width - 10) tooltipX = width - tooltipWidth - 10;
        if (tooltipX < 10) tooltipX = 10;
        if (tooltipY < breadcrumbHeight + 10) tooltipY = node.y1 + breadcrumbHeight + 10;

        ctx.fillStyle = 'rgba(20, 20, 20, 0.95)';
        drawRoundedRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight, 4);
        ctx.fill();

        ctx.strokeStyle = '#444';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';

        lines.forEach((line, i) => {
            if (i === 0) {
                ctx.font = 'bold 12px "Helvetica Neue", sans-serif';
                ctx.fillStyle = '#fff';
            } else {
                ctx.font = '11px "Helvetica Neue", monospace';
                ctx.fillStyle = i === lines.length - 1 && !data.isGame ? '#33BBEE' : '#aaa';
            }
            ctx.fillText(line, tooltipX + padding, tooltipY + padding + i * lineHeight);
        });
    }

    function findNodeAtPoint(x, y, root) {
        const nodes = getVisibleNodes(root);

        for (let node of nodes) {
            const nx = node.x0;
            const ny = node.y0 + breadcrumbHeight;
            const nw = node.x1 - node.x0;
            const nh = node.y1 - node.y0;

            if (x >= nx && x <= nx + nw && y >= ny && y <= ny + nh) {
                return node;
            }
        }

        return null;
    }

    function updateBreadcrumb(root) {
        breadcrumb = [];
        navigationStack.forEach((data, idx) => {
            breadcrumb.push({ name: data.name, stackIndex: idx });
        });
        breadcrumb.push({ name: root.data.name, node: root, isCurrent: true });
    }

    function zoomTo(node) {
        if (!node) return;

        const data = node.data;
        if (!data || (!data.children && !data.isRoot)) return;

        // Track genre for hierarchical coloring
        if (data.isGenre) {
            currentGenreIdx = data.genreIndex;
        }

        // Save clicked rect for animation origin
        const clickedRect = { x0: node.x0, y0: node.y0, x1: node.x1, y1: node.y1 };

        navigationStack.push(hierarchyData);

        animateTransition(data, clickedRect);
    }

    function goBack() {
        if (navigationStack.length === 0) return;

        hierarchyData = navigationStack.pop();

        // Update genre tracking
        if (hierarchyData.isRoot || hierarchyData.isGenre) {
            currentGenreIdx = hierarchyData.isGenre ? hierarchyData.genreIndex : null;
        }

        animateTransition(hierarchyData, null);
    }

    // Touch state
    let touchStartX = 0;
    let touchStartY = 0;
    let touchHoldTimer = null;
    let touchHoldClearTimer = null;

    function handleMouseMove(e) {
        if (!active || animation) return;

        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (y <= breadcrumbHeight && backBtnRect &&
            x >= backBtnRect.x && x <= backBtnRect.x + backBtnRect.w) {
            if (hoveredNode) {
                hoveredNode = null;
                render();
            }
            canvas.style.cursor = 'pointer';
            return;
        }

        const node = findNodeAtPoint(x, y, currentRoot);

        if (node !== hoveredNode) {
            hoveredNode = node;
            canvas.style.cursor = node ? 'pointer' : 'default';
            render();
        }
    }

    function handleClick(e) {
        if (!active || animation) return;

        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (y <= breadcrumbHeight && backBtnRect) {
            if (x >= backBtnRect.x && x <= backBtnRect.x + backBtnRect.w &&
                y >= backBtnRect.y && y <= backBtnRect.y + backBtnRect.h) {
                goBack();
                return;
            }
        }

        if (y <= breadcrumbHeight) {
            for (let i = 0; i < breadcrumb.length; i++) {
                const item = breadcrumb[i];
                if (item.isCurrent) continue;
                if (x >= item.x && x <= item.x + item.width) {
                    while (navigationStack.length > item.stackIndex + 1) {
                        navigationStack.pop();
                    }
                    hierarchyData = navigationStack.pop();
                    currentGenreIdx = null;
                    const root = computeTreemap(hierarchyData);
                    updateBreadcrumb(root);
                    hoveredNode = null;
                    render();
                    return;
                }
            }
        }

        const node = findNodeAtPoint(x, y, currentRoot);
        if (node && node.children && node.children.length > 0) {
            zoomTo(node);
        }
    }

    function handleMouseLeave() {
        if (hoveredNode) {
            hoveredNode = null;
            canvas.style.cursor = 'default';
            render();
        }
    }

    function handleTouchStart(e) {
        if (!active || animation) return;

        e.preventDefault();

        const touch = e.touches[0];
        const rect = canvas.getBoundingClientRect();
        touchStartX = touch.clientX - rect.left;
        touchStartY = touch.clientY - rect.top;

        if (touchHoldTimer) {
            clearTimeout(touchHoldTimer);
            touchHoldTimer = null;
        }
        if (touchHoldClearTimer) {
            clearTimeout(touchHoldClearTimer);
            touchHoldClearTimer = null;
        }

        const node = findNodeAtPoint(touchStartX, touchStartY, currentRoot);
        if (node) {
            touchHoldTimer = setTimeout(() => {
                hoveredNode = node;
                render();
                touchHoldTimer = null;
            }, 400);
        }
    }

    function handleTouchMove(e) {
        if (!active) return;

        const touch = e.touches[0];
        const rect = canvas.getBoundingClientRect();
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;

        const dx = x - touchStartX;
        const dy = y - touchStartY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > 10 && touchHoldTimer) {
            clearTimeout(touchHoldTimer);
            touchHoldTimer = null;
        }
    }

    function handleTouchEnd(e) {
        if (!active || animation) return;

        e.preventDefault();

        const touch = e.changedTouches[0];
        const rect = canvas.getBoundingClientRect();
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;

        if (touchHoldTimer) {
            clearTimeout(touchHoldTimer);
            touchHoldTimer = null;
        }

        const dx = x - touchStartX;
        const dy = y - touchStartY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 10) {
            if (y <= breadcrumbHeight && backBtnRect) {
                if (x >= backBtnRect.x && x <= backBtnRect.x + backBtnRect.w &&
                    y >= backBtnRect.y && y <= backBtnRect.y + backBtnRect.h) {
                    goBack();
                    return;
                }
            }

            if (y <= breadcrumbHeight) {
                for (let i = 0; i < breadcrumb.length; i++) {
                    const item = breadcrumb[i];
                    if (item.isCurrent) continue;
                    if (x >= item.x && x <= item.x + item.width) {
                        while (navigationStack.length > item.stackIndex + 1) {
                            navigationStack.pop();
                        }
                        hierarchyData = navigationStack.pop();
                        currentGenreIdx = null;
                        const root = computeTreemap(hierarchyData);
                        updateBreadcrumb(root);
                        hoveredNode = null;
                        render();
                        return;
                    }
                }
            }

            const node = findNodeAtPoint(x, y, currentRoot);
            if (node && node.children && node.children.length > 0) {
                zoomTo(node);
            }
        }

        if (hoveredNode) {
            touchHoldClearTimer = setTimeout(() => {
                hoveredNode = null;
                render();
                touchHoldClearTimer = null;
            }, 300);
        }
    }

    // Public API
    window._steamViews = window._steamViews || {};
    window._steamViews.treemap = {
        _initialized: false,

        init() {
            if (this._initialized) return;

            canvas.addEventListener('mousemove', handleMouseMove);
            canvas.addEventListener('click', handleClick);
            canvas.addEventListener('mouseleave', handleMouseLeave);

            canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
            canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
            canvas.addEventListener('touchend', handleTouchEnd, { passive: false });

            window.addEventListener('resize', resize);

            this._initialized = true;
        },

        activate() {
            active = true;
            hierarchyData = buildHierarchy();
            fullHierarchyData = hierarchyData;
            navigationStack = [];
            currentGenreIdx = null;
            resize();
            const root = computeTreemap();
            updateBreadcrumb(root);
            render();
        },

        deactivate() {
            active = false;
            hoveredNode = null;
            animation = null;
        },

        onFilterChange() {
            if (!active) return;
            hierarchyData = buildHierarchy();
            fullHierarchyData = hierarchyData;
            navigationStack = [];
            currentGenreIdx = null;
            const root = computeTreemap();
            updateBreadcrumb(root);
            render();
        },

        selectGame(game) {
            if (!active || !hierarchyData) return;

            if (navigationStack.length > 0) {
                hierarchyData = fullHierarchyData;
                navigationStack = [];
            }

            const genreIdx = game[6][0];
            const steamData = window._steamData;
            const genreName = steamData.genreNames[genreIdx];
            const genreData = hierarchyData.children.find(c => c.name === genreName);
            if (genreData) {
                currentGenreIdx = genreData.genreIndex;
                navigationStack.push(hierarchyData);
                hierarchyData = genreData;
                const root = computeTreemap(genreData);
                updateBreadcrumb(root);
                hoveredNode = null;
                render();
            }
        }
    };
})();
