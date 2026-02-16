/**
 * Steam Universe — Network Graph (Live Force Simulation)
 *
 * Physics-driven d3-force layout of ~9K game nodes with ~300K+
 * co-review connections. Warm-starts from pre-computed positions
 * (steam_force_layout.json), then runs live simulation with
 * node repulsion, link attraction, and center gravity.
 *
 * Drag nodes to rearrange. Press R to reheat, F to fit.
 *
 * Registers as window._steamViews.force
 */
(function() {
    'use strict';

    const canvas = document.getElementById('canvas-force');
    const ctx = canvas.getContext('2d');
    let width, height, dpr;
    let active = false;

    // ── Simulation state ──
    let simulation = null;
    let simNodes = [];           // d3-force node objects {x, y, vx, vy, r, game, ...}
    let renderLinks = [];        // ALL links for drawing: [{si, ti, weight}]
    let forceLinks = [];         // Subset for physics (separate copies)
    let layoutLoaded = false;
    let layoutError = false;
    let tickCount = 0;

    // ── Zoom / interaction ──
    let transform = d3.zoomIdentity;
    let zoomBehavior = null;
    let draggedNode = null;
    let hoveredNode = null;
    let selectedNode = null;
    let sizeMode = 'reviews';    // 'reviews' | 'rating' | 'price' | 'connections'
    let nodeDegree = null;       // Map: simIdx → connection count
    let skipEdgeFrames = 0;      // Skip edges for N renders after tab switch

    // ── Touch state ──
    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;
    let touchHoldTimer = null;
    let touchedNode = null;

    // ── Tuning ──
    const NODE_MIN_R = 1.5;
    const NODE_MAX_R = 14;
    const LABEL_ZOOM = 2.5;
    const SIM_SPREAD = 500;          // Maps [0,1] layout to [-500, 500]
    const MAX_FORCE_LINKS = 20000;   // Links used for force calculation
    const MIN_RENDER_WEIGHT = 50;    // Min weight for rendered edges

    // ── Loading indicator ──
    function drawLoading(msg) {
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = '#888';
        ctx.font = '14px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(msg || 'Loading network...', width / 2, height / 2);
    }

    // ── Load data and initialize everything ──
    async function loadAndBuild() {
        drawLoading('Loading network positions...');
        try {
            const resp = await fetch('steam_force_layout.json?v=2');
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const layoutData = await resp.json();
            const positions = layoutData.positions;

            const steamData = window._steamData;
            if (!steamData) throw new Error('Steam data not ready');
            const { netData } = steamData;
            const nodes = netData.nodes;
            const links = netData.links;

            // ── Node radius scale ──
            let maxReviews = 0;
            for (const n of nodes) {
                if (n._game && positions[n.id]) {
                    maxReviews = Math.max(maxReviews, n._game[3] || 0);
                }
            }
            const rScale = d3.scaleSqrt()
                .domain([0, maxReviews])
                .range([NODE_MIN_R, NODE_MAX_R]);

            // ── Build simulation nodes ──
            const simIdxByOrigIdx = new Map();
            simNodes = [];
            for (let i = 0; i < nodes.length; i++) {
                const n = nodes[i];
                const pos = positions[n.id];
                if (!pos) continue;

                const game = n._game;
                const reviews = game ? game[3] : (n.reviews || 0);

                simIdxByOrigIdx.set(i, simNodes.length);
                simNodes.push({
                    x: (pos[0] - 0.5) * SIM_SPREAD * 2,
                    y: (pos[1] - 0.5) * SIM_SPREAD * 2,
                    r: rScale(reviews),
                    game: game,
                    origIdx: i,
                    id: n.id,
                    title: n.title,
                    reviews: reviews,
                    _simIdx: simNodes.length,
                });
            }
            // Fix _simIdx (was set before push)
            for (let i = 0; i < simNodes.length; i++) {
                simNodes[i]._simIdx = i;
            }

            // ── Build ALL links between layout nodes ──
            renderLinks = [];
            for (const link of links) {
                const si = simIdxByOrigIdx.get(link.source);
                const ti = simIdxByOrigIdx.get(link.target);
                if (si === undefined || ti === undefined) continue;
                if (link.weight < MIN_RENDER_WEIGHT) continue;
                renderLinks.push({ si, ti, weight: link.weight });
            }
            renderLinks.sort((a, b) => b.weight - a.weight);

            // ── Compute node degrees (connection counts) ──
            nodeDegree = new Map();
            for (const link of renderLinks) {
                nodeDegree.set(link.si, (nodeDegree.get(link.si) || 0) + 1);
                nodeDegree.set(link.ti, (nodeDegree.get(link.ti) || 0) + 1);
            }

            // ── Subset for force physics (separate objects) ──
            const forceCount = Math.min(renderLinks.length, MAX_FORCE_LINKS);
            forceLinks = [];
            for (let i = 0; i < forceCount; i++) {
                forceLinks.push({
                    source: renderLinks[i].si,
                    target: renderLinks[i].ti,
                    weight: renderLinks[i].weight,
                });
            }

            layoutLoaded = true;
            initSimulation();

            if (active) {
                fitToScreen();
                simulation.alpha(0.3).restart();
            }

        } catch (e) {
            layoutError = true;
            console.warn('Force layout failed:', e.message);
            drawLoading('Network data unavailable: ' + e.message);
        }
    }

    // ── Node size recalculation ──
    function recalcNodeSizes() {
        if (!simNodes.length) return;

        let maxVal = 0;
        const vals = simNodes.map(n => {
            let v;
            switch (sizeMode) {
                case 'rating':
                    v = n.game ? n.game[2] : 50;   // 0-100
                    break;
                case 'price':
                    v = n.game ? n.game[4] : 0;     // dollars
                    break;
                case 'connections':
                    v = nodeDegree ? (nodeDegree.get(n._simIdx) || 0) : 0;
                    break;
                default: // 'reviews'
                    v = n.reviews || 0;
                    break;
            }
            if (v > maxVal) maxVal = v;
            return v;
        });

        const scale = sizeMode === 'rating'
            ? d3.scaleLinear().domain([0, 100]).range([NODE_MIN_R, NODE_MAX_R])
            : d3.scaleSqrt().domain([0, maxVal || 1]).range([NODE_MIN_R, NODE_MAX_R]);

        for (let i = 0; i < simNodes.length; i++) {
            simNodes[i].r = scale(vals[i]);
        }

        // Update collide force radii
        if (simulation) {
            simulation.force('collide', d3.forceCollide(d => d.r + 0.5).strength(0.15).iterations(1));
        }
    }

    // ── d3-force simulation ──
    function initSimulation() {
        const maxWeight = forceLinks.length > 0 ? forceLinks[0].weight : 1;

        simulation = d3.forceSimulation(simNodes)
            .force('charge', d3.forceManyBody()
                .strength(-10)
                .distanceMax(SIM_SPREAD * 1.5)
                .theta(0.9)
            )
            .force('link', d3.forceLink(forceLinks)
                .distance(25)
                .strength(d => 0.008 + 0.04 * Math.min(1, d.weight / maxWeight))
            )
            .force('center', d3.forceCenter(0, 0).strength(0.008))
            .force('collide', d3.forceCollide(d => d.r + 0.5).strength(0.15).iterations(1))
            .alphaDecay(0.028)
            .alphaMin(0.005)
            .velocityDecay(0.45)
            .alpha(0.3)
            .on('tick', onTick)
            .stop();
    }

    function onTick() {
        tickCount++;
        if (active) render();
    }

    // ── Fit network to viewport ──
    function fitToScreen() {
        if (!simNodes.length) return;

        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const n of simNodes) {
            if (n.x < x0) x0 = n.x;
            if (n.y < y0) y0 = n.y;
            if (n.x > x1) x1 = n.x;
            if (n.y > y1) y1 = n.y;
        }

        const dataW = (x1 - x0) || 100;
        const dataH = (y1 - y0) || 100;
        const pad = 140;
        const k = Math.min(
            (width - pad) / dataW,
            (height - pad) / dataH
        );
        const cx = (x0 + x1) / 2;
        const cy = (y0 + y1) / 2;

        transform = d3.zoomIdentity
            .translate(width / 2 - cx * k, height / 2 - cy * k)
            .scale(k);

        if (zoomBehavior) {
            d3.select(canvas).call(zoomBehavior.transform, transform);
        }
    }

    // ── Resize ──
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

    // ── Coordinate transforms ──
    function toScreenX(sx) { return sx * transform.k + transform.x; }
    function toScreenY(sy) { return sy * transform.k + transform.y; }
    function fromScreenX(px) { return (px - transform.x) / transform.k; }
    function fromScreenY(py) { return (py - transform.y) / transform.k; }

    // ── Main render ──
    function render() {
        if (!active || !layoutLoaded) return;

        ctx.clearRect(0, 0, width, height);

        const k = transform.k;
        const data = window._steamData;
        const filterActive = data ? data.filterActive() : false;
        const gamePassesFilter = data ? data.gamePassesFilter : () => true;
        const getGameColor = data ? data.getGameColor : () => '#4a9eff';

        // Viewport bounds for culling
        const vx0 = -40, vy0 = -40, vx1 = width + 40, vy1 = height + 40;
        const settling = simulation && simulation.alpha() > 0.005;

        // ── Draw ALL edges ──
        // Skip edges for a few renders after tab switch so the browser stays responsive
        const drawEdges = skipEdgeFrames <= 0 && (!settling || (tickCount % 4 === 0));
        if (skipEdgeFrames > 0) {
            skipEdgeFrames--;
            if (skipEdgeFrames === 0) {
                // Now schedule the first edge render on the next frame
                requestAnimationFrame(() => { if (active) render(); });
            }
        }

        if (drawEdges && renderLinks.length > 0) {
            // Weight-based color coding for edges
            // Classify each edge into a color bucket by weight
            function edgeStyle(w) {
                if (w >= 500) return { color: '#FF4488', alpha: 0.25, width: 0.8 };  // Very strong — pink
                if (w >= 200) return { color: '#FF8833', alpha: 0.18, width: 0.5 };  // Strong — orange
                if (w >= 100) return { color: '#DDDD33', alpha: 0.12, width: 0.35 }; // Medium — yellow
                return { color: '#66AADD', alpha: 0.06, width: 0.25 };               // Weak — blue
            }

            const settlingDim = settling ? 0.4 : 1.0;

            // Group edges by bucket for batched rendering (4 groups)
            const groups = { '#FF4488': [], '#FF8833': [], '#DDDD33': [], '#66AADD': [] };
            for (let i = 0; i < renderLinks.length; i++) {
                const link = renderLinks[i];
                const s = simNodes[link.si];
                const t = simNodes[link.ti];

                if (filterActive && s.game && t.game &&
                    !gamePassesFilter(s.game) && !gamePassesFilter(t.game)) continue;

                const sx = toScreenX(s.x);
                const sy = toScreenY(s.y);
                const ex = toScreenX(t.x);
                const ey = toScreenY(t.y);

                if ((sx < vx0 && ex < vx0) || (sx > vx1 && ex > vx1) ||
                    (sy < vy0 && ey < vy0) || (sy > vy1 && ey > vy1)) continue;

                const style = edgeStyle(link.weight);
                groups[style.color].push(sx, sy, ex, ey);
            }

            // Draw each color group as a batched path
            const styles = [
                { color: '#66AADD', alpha: 0.06, width: 0.25 },
                { color: '#DDDD33', alpha: 0.12, width: 0.35 },
                { color: '#FF8833', alpha: 0.18, width: 0.5 },
                { color: '#FF4488', alpha: 0.25, width: 0.8 },
            ];
            for (const style of styles) {
                const pts = groups[style.color];
                if (pts.length === 0) continue;
                ctx.lineWidth = Math.max(0.15, style.width / Math.sqrt(k));
                ctx.strokeStyle = style.color;
                ctx.globalAlpha = style.alpha * settlingDim;
                ctx.beginPath();
                for (let j = 0; j < pts.length; j += 4) {
                    ctx.moveTo(pts[j], pts[j+1]);
                    ctx.lineTo(pts[j+2], pts[j+3]);
                }
                ctx.stroke();
            }
        }

        // ── Highlighted edges for hovered/selected node — color-coded by weight ──
        // Moved outside of drawEdges to ensure visibility during settling or tab switch
        const highlightNode = hoveredNode || selectedNode;
        if (highlightNode) {
            const hIdx = highlightNode._simIdx;
            const baseColor = hoveredNode ? [122, 184, 255] : [255, 159, 67]; // blue or orange

            for (const link of renderLinks) {
                if (link.si !== hIdx && link.ti !== hIdx) continue;
                const s = simNodes[link.si];
                const t = simNodes[link.ti];
                const sx = toScreenX(s.x);
                const sy = toScreenY(s.y);
                const ex = toScreenX(t.x);
                const ey = toScreenY(t.y);

                // Weight-based intensity
                const wNorm = Math.min(1, link.weight / 500);
                const lw = Math.max(0.4, (0.4 + wNorm * 0.8) / Math.sqrt(k));
                const alpha = 0.3 + wNorm * 0.5;

                ctx.lineWidth = lw;
                ctx.strokeStyle = `rgba(${baseColor[0]},${baseColor[1]},${baseColor[2]},${alpha})`;
                ctx.globalAlpha = 1; // Explicitly reset to avoid alpha leakage
                ctx.beginPath();
                ctx.moveTo(sx, sy);
                ctx.lineTo(ex, ey);
                ctx.stroke();
            }
        }

        ctx.globalAlpha = 1;

        // ── Draw nodes ──
        for (const node of simNodes) {
            const sx = toScreenX(node.x);
            const sy = toScreenY(node.y);
            const r = Math.max(1, node.r * Math.min(k, 4));

            // Viewport culling
            if (sx + r < vx0 || sx - r > vx1 || sy + r < vy0 || sy - r > vy1) continue;

            const passesFilter = !filterActive || !node.game || gamePassesFilter(node.game);
            const color = node.game ? getGameColor(node.game) : '#4a9eff';

            ctx.globalAlpha = passesFilter ? 0.92 : 0.10;

            // Highlight ring
            if (hoveredNode === node || selectedNode === node) {
                ctx.globalAlpha = 1;
                ctx.fillStyle = '#fff';
                ctx.beginPath();
                ctx.arc(sx, sy, r + 2, 0, Math.PI * 2);
                ctx.fill();
            }

            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(sx, sy, r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;

        // ── Labels at high zoom (skip during settling) ──
        if (k >= LABEL_ZOOM && !settling) {
            ctx.font = Math.max(9, 11 / Math.sqrt(k)) + 'px -apple-system, BlinkMacSystemFont, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';

            const sorted = simNodes.slice().sort((a, b) => b.reviews - a.reviews);
            const maxLabels = Math.min(sorted.length, Math.floor(k * 30));
            const labelRects = [];
            let labelsDrawn = 0;

            for (const node of sorted) {
                if (labelsDrawn >= maxLabels) break;
                if (filterActive && node.game && !gamePassesFilter(node.game)) continue;

                const sx = toScreenX(node.x);
                const sy = toScreenY(node.y);
                if (sx < vx0 || sx > vx1 || sy < vy0 || sy > vy1) continue;

                const r = Math.max(1, node.r * Math.min(k, 4));
                const lx = sx + r + 4;
                const ly = sy;
                const tw = ctx.measureText(node.title).width;
                const lh = 12;
                const rect = { x: lx, y: ly - lh / 2, w: tw, h: lh };

                let overlaps = false;
                for (const other of labelRects) {
                    if (rect.x < other.x + other.w && rect.x + rect.w > other.x &&
                        rect.y < other.y + other.h && rect.y + rect.h > other.y) {
                        overlaps = true;
                        break;
                    }
                }
                if (overlaps) continue;

                labelRects.push(rect);
                ctx.fillStyle = hoveredNode === node ? '#fff' : 'rgba(200,200,200,0.8)';
                ctx.fillText(node.title, lx, ly);
                labelsDrawn++;
            }
        }

        // ── Hover tooltip ──
        if (hoveredNode && !draggedNode) {
            const sx = toScreenX(hoveredNode.x);
            const sy = toScreenY(hoveredNode.y);
            drawNodeTooltip(sx, sy - 25, hoveredNode);
        }

        // ── Stats bar ──
        drawStats(settling);
    }

    // ── Tooltip ──
    function drawNodeTooltip(sx, sy, node) {
        const game = node.game;
        const title = node.title;
        const subtitle = game
            ? `${game[1]} · ${game[2]}% positive · ${game[3].toLocaleString()} reviews`
            : `${node.reviews.toLocaleString()} reviews`;

        ctx.font = 'bold 12px -apple-system, sans-serif';
        const tw = Math.max(ctx.measureText(title).width, ctx.measureText(subtitle).width);
        const pad = 10;
        const h = 42;
        const rx = sx - tw / 2 - pad;
        const ry = sy - h - 8;

        ctx.fillStyle = 'rgba(10, 10, 10, 0.92)';
        ctx.strokeStyle = '#444';
        ctx.lineWidth = 1;
        roundRect(ctx, rx, ry, tw + pad * 2, h, 6);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 12px -apple-system, sans-serif';
        ctx.fillText(title, sx, ry + 14);
        ctx.font = '11px -apple-system, sans-serif';
        ctx.fillText(subtitle, sx, ry + 28);
    }

    // ── Stats bar ──
    function drawStats(settling) {
        const alpha = simulation ? simulation.alpha() : 0;
        const status = settling ? `Simulating (alpha: ${alpha.toFixed(3)})` : 'Stable';
        const text = `${simNodes.length} nodes, ${renderLinks.length} edges | ${status}`;

        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1;
        const pad = 8;
        const tw = ctx.measureText(text).width;
        const h = 24;
        const w = tw + pad * 2;
        const rx = width - w - 10;
        const ry = height - h - 10;
        roundRect(ctx, rx, ry, w, h, 6);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#fff';
        ctx.font = '11px -apple-system, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, rx + pad, ry + h / 2);
    }

    // ── Rounded rectangle helper ──
    function roundRect(ctx, x, y, width, height, radius) {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
    }

    // ── Interaction handlers (omitted for brevity; assume they set hoveredNode, selectedNode, etc.) ──

    // ── Public interface (omitted for brevity) ──

    // ── Initialization (omitted for brevity) ──
})();
