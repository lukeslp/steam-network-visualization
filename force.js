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
    let layoutMode = 'default';  // 'default' | 'tight' | 'spread' | 'clustered'
    let groupMode = 'genre';     // 'genre' | 'community'
    let nodeDegree = null;       // Map: simIdx → connection count
    let skipEdgeFrames = 0;      // Skip edges for N renders after tab switch
    let communitiesData = null;  // Map: nodeId → community index
    let numCommunities = 0;      // Number of communities detected
    let medianWeight = 0;        // Median edge weight for LOD culling

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
            // TODO: Change back to 'steam_force_layout.json' after testing
            const resp = await fetch('steam_force_layout_test.json?v=6');
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const layoutData = await resp.json();
            const positions = layoutData.positions;

            // Load community data if available
            if (layoutData.communities) {
                communitiesData = layoutData.communities;
                numCommunities = layoutData.meta?.num_communities || 0;
                console.log(`Loaded ${numCommunities} communities from layout data`);
            } else {
                console.log('No community data in layout file (run compute_layout.py to generate)');
            }

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

            // ── Compute median weight for LOD ──
            if (renderLinks.length > 0) {
                const weights = renderLinks.map(l => l.weight);
                medianWeight = weights[Math.floor(weights.length / 2)];
                console.log(`Median edge weight: ${medianWeight} (${renderLinks.length} edges)`);
            }

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

    // ── Get node color based on group mode ──
    function getNodeColor(node) {
        if (groupMode === 'community' && communitiesData && node.id) {
            // Color by community
            const commId = communitiesData[node.id];
            if (commId !== undefined) {
                // Use distinct hues across communities (HSL color wheel)
                const hue = (commId * 137.5) % 360; // Golden angle for even distribution
                return `hsl(${hue}, 70%, 60%)`;
            }
        }
        // Default: color by genre using shared Steam data
        const data = window._steamData;
        if (data && data.getGameColor && node.game) {
            return data.getGameColor(node.game);
        }
        return '#4a9eff';
    }

    // ── Main render ──
    function render() {
        if (!active || !layoutLoaded) return;

        const t0 = performance.now(); // Start timing

        // Clear with explicit background fill to prevent ghost artifacts
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, width, height);

        const k = transform.k;
        const data = window._steamData;
        const filterActive = data ? data.filterActive() : false;
        const gamePassesFilter = data ? data.gamePassesFilter : () => true;

        // Viewport bounds for culling
        const vx0 = -40, vy0 = -40, vx1 = width + 40, vy1 = height + 40;
        const settling = simulation && simulation.alpha() > 0.005;

        // ── Draw ALL edges ──
        // Skip edges only for a few renders after tab switch so the browser stays responsive
        const drawEdges = skipEdgeFrames <= 0;
        if (skipEdgeFrames > 0) {
            skipEdgeFrames--;
            if (skipEdgeFrames === 0) {
                // Now schedule the first edge render on the next frame
                requestAnimationFrame(() => { if (active) render(); });
            }
        }

        if (drawEdges && renderLinks.length > 0) {
            // ── LOD: Zoom-based weight threshold ──
            // At low zoom, skip weak edges (they're near-invisible anyway at alpha 0.06)
            const lodThreshold = k < 0.8 ? medianWeight :
                                 k < 1.5 ? medianWeight * 0.6 :
                                 k < 3.0 ? medianWeight * 0.3 : MIN_RENDER_WEIGHT;

            // Weight-based color coding for edges
            // Classify each edge into a color bucket by weight
            function edgeStyle(w) {
                if (w >= 500) return { color: '#FF4488', alpha: 0.25, width: 0.8 };  // Very strong — pink
                if (w >= 200) return { color: '#FF8833', alpha: 0.18, width: 0.5 };  // Strong — orange
                if (w >= 100) return { color: '#DDDD33', alpha: 0.12, width: 0.35 }; // Medium — yellow
                return { color: '#66AADD', alpha: 0.06, width: 0.25 };               // Weak — blue
            }

            // Smooth transition from settling (dim) to settled (full)
            // Ramp from 0.4 → 1.0 as alpha goes from 0.02 → 0.005
            const simAlpha = simulation ? simulation.alpha() : 0;
            const settlingDim = simAlpha > 0.02 ? 0.4 : simAlpha > 0.005 ? 0.4 + 0.6 * (1 - (simAlpha - 0.005) / 0.015) : 1.0;
            const highlightDim = (hoveredNode || selectedNode) ? 0.35 : 1.0;

            // Group edges by bucket for batched rendering (4 groups)
            const groups = { '#FF4488': [], '#FF8833': [], '#DDDD33': [], '#66AADD': [] };
            let edgesProcessed = 0, edgesCulledLOD = 0, edgesCulledViewport = 0, edgesCulledFilter = 0;

            for (let i = 0; i < renderLinks.length; i++) {
                const link = renderLinks[i];

                // LOD cull: skip weak edges at low zoom
                if (link.weight < lodThreshold) {
                    edgesCulledLOD++;
                    continue;
                }

                const s = simNodes[link.si];
                const t = simNodes[link.ti];

                if (filterActive && s.game && t.game &&
                    !gamePassesFilter(s.game) && !gamePassesFilter(t.game)) {
                    edgesCulledFilter++;
                    continue;
                }

                const sx = toScreenX(s.x);
                const sy = toScreenY(s.y);
                const ex = toScreenX(t.x);
                const ey = toScreenY(t.y);

                if ((sx < vx0 && ex < vx0) || (sx > vx1 && ex > vx1) ||
                    (sy < vy0 && ey < vy0) || (sy > vy1 && ey > vy1)) {
                    edgesCulledViewport++;
                    continue;
                }

                const style = edgeStyle(link.weight);
                groups[style.color].push(sx, sy, ex, ey);
                edgesProcessed++;
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
                ctx.globalAlpha = style.alpha * settlingDim * highlightDim;
                ctx.beginPath();
                for (let j = 0; j < pts.length; j += 4) {
                    ctx.moveTo(pts[j], pts[j+1]);
                    ctx.lineTo(pts[j+2], pts[j+3]);
                }
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
            const color = getNodeColor(node);

            ctx.globalAlpha = passesFilter ? 0.92 : 0.10;

            // Highlight ring — thicker at low zoom for visibility
            if (hoveredNode === node || selectedNode === node) {
                const ringW = Math.max(2, 3 / Math.sqrt(k));
                ctx.globalAlpha = 1;
                ctx.fillStyle = '#fff';
                ctx.beginPath();
                ctx.arc(sx, sy, r + ringW, 0, Math.PI * 2);
                ctx.fill();
            }

            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(sx, sy, r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;

        // ── Highlighted edges for hovered/selected node — drawn AFTER nodes ──
        // (Outside drawEdges guard so connections show even during settling/tab-switch)
        const highlightNode = hoveredNode || selectedNode;
        if (highlightNode && renderLinks.length > 0) {
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

                // Viewport cull
                if ((sx < vx0 && ex < vx0) || (sx > vx1 && ex > vx1) ||
                    (sy < vy0 && ey < vy0) || (sy > vy1 && ey > vy1)) continue;

                // Weight-based intensity
                const wNorm = Math.min(1, link.weight / 500);
                const lw = Math.max(0.4, (0.4 + wNorm * 0.8) / Math.sqrt(k));
                const alpha = 0.3 + wNorm * 0.5;

                ctx.lineWidth = lw;
                ctx.strokeStyle = `rgba(${baseColor[0]},${baseColor[1]},${baseColor[2]},${alpha})`;
                ctx.beginPath();
                ctx.moveTo(sx, sy);
                ctx.lineTo(ex, ey);
                ctx.stroke();
            }
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

        // ── Performance tracking ──
        const t1 = performance.now();
        const renderTime = t1 - t0;

        // Store rolling average (last 60 frames)
        if (!window._perfStats) {
            window._perfStats = {
                times: [],
                edgeStats: { processed: [], culledLOD: [], culledViewport: [], culledFilter: [] }
            };
        }
        window._perfStats.times.push(renderTime);
        if (typeof edgesProcessed !== 'undefined') {
            window._perfStats.edgeStats.processed.push(edgesProcessed);
            window._perfStats.edgeStats.culledLOD.push(edgesCulledLOD);
            window._perfStats.edgeStats.culledViewport.push(edgesCulledViewport);
            window._perfStats.edgeStats.culledFilter.push(edgesCulledFilter);
        }

        if (window._perfStats.times.length > 60) {
            window._perfStats.times.shift();
            window._perfStats.edgeStats.processed.shift();
            window._perfStats.edgeStats.culledLOD.shift();
            window._perfStats.edgeStats.culledViewport.shift();
            window._perfStats.edgeStats.culledFilter.shift();
        }

        // Log every 60 frames (once per second at 60fps)
        if (tickCount % 60 === 0 && window._perfStats.times.length === 60) {
            const avgTime = window._perfStats.times.reduce((a, b) => a + b, 0) / 60;
            const fps = 1000 / avgTime;
            const avgProcessed = window._perfStats.edgeStats.processed.reduce((a, b) => a + b, 0) / 60;
            const avgLOD = window._perfStats.edgeStats.culledLOD.reduce((a, b) => a + b, 0) / 60;
            const avgViewport = window._perfStats.edgeStats.culledViewport.reduce((a, b) => a + b, 0) / 60;
            const avgFilter = window._perfStats.edgeStats.culledFilter.reduce((a, b) => a + b, 0) / 60;
            const total = avgProcessed + avgLOD + avgViewport + avgFilter;
            const lodPct = total > 0 ? (avgLOD / total * 100).toFixed(1) : 0;
            console.log(`Force: ${avgTime.toFixed(2)}ms (${fps.toFixed(1)} FPS) — Edges: ${Math.round(avgProcessed)}/${Math.round(total)} rendered (${lodPct}% LOD culled, zoom: ${transform.k.toFixed(2)}x)`);
        }
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

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff';
        ctx.fillText(title, sx, ry + 14);
        ctx.font = '10px -apple-system, sans-serif';
        ctx.fillStyle = '#999';
        ctx.fillText(subtitle, sx, ry + 30);
    }

    function drawStats(settling) {
        const nodeCount = simNodes.length.toLocaleString();
        const edgeCount = renderLinks.length.toLocaleString();
        const status = settling ? ' · settling...' : ' · drag nodes to rearrange';
        const text = `${nodeCount} nodes · ${edgeCount} edges${status}`;

        ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';

        const stw = ctx.measureText(text).width;
        const sy = height - 30;

        ctx.fillStyle = 'rgba(10, 10, 10, 0.75)';
        roundRect(ctx, 8, sy - 4, stw + 16, 22, 4);
        ctx.fill();

        ctx.fillStyle = '#888';
        ctx.fillText(text, 16, sy);
    }

    function roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    // ── Hit detection ──
    function hitTest(mx, my) {
        if (!layoutLoaded) return null;

        const lx = fromScreenX(mx);
        const ly = fromScreenY(my);
        const k = transform.k;

        let closest = null;
        let closestDist = Infinity;
        const maxDist = 20 / k;

        for (const node of simNodes) {
            const dx = node.x - lx;
            const dy = node.y - ly;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const hitR = node.r + maxDist * 0.5;
            if (dist < hitR && dist < closestDist) {
                closestDist = dist;
                closest = node;
            }
        }
        return closest;
    }

    // ── Zoom setup ──
    function setupZoom() {
        zoomBehavior = d3.zoom()
            .scaleExtent([0.05, 30])
            .filter(function(event) {
                // Always allow wheel zoom and dblclick
                if (event.type === 'wheel' || event.type === 'dblclick') return true;
                // On mousedown/touchstart: check for node drag
                if (event.type === 'mousedown' || event.type === 'touchstart') {
                    const [mx, my] = d3.pointer(event, canvas);
                    const hit = hitTest(mx, my);
                    if (hit) {
                        startDrag(hit);
                        return false; // Suppress zoom — we're dragging
                    }
                }
                // Default: allow pan (no ctrl, no right-click)
                return !event.ctrlKey && !event.button;
            })
            .on('zoom', (event) => {
                transform = event.transform;
                // Only render from zoom if simulation is idle
                if (!simulation || simulation.alpha() < 0.005) {
                    render();
                }
            });

        d3.select(canvas).call(zoomBehavior);
    }

    // ── Node dragging ──
    function startDrag(node) {
        draggedNode = node;
        node.fx = node.x;
        node.fy = node.y;
        simulation.alphaTarget(0.3).restart();
        canvas.style.cursor = 'grabbing';

        window.addEventListener('mousemove', onDragMove);
        window.addEventListener('mouseup', onDragEnd);
        window.addEventListener('touchmove', onDragMove, { passive: false });
        window.addEventListener('touchend', onDragEnd);
    }

    function onDragMove(event) {
        if (!draggedNode) return;
        event.preventDefault();

        const rect = canvas.getBoundingClientRect();
        const clientX = event.touches ? event.touches[0].clientX : event.clientX;
        const clientY = event.touches ? event.touches[0].clientY : event.clientY;
        const mx = clientX - rect.left;
        const my = clientY - rect.top;

        draggedNode.fx = fromScreenX(mx);
        draggedNode.fy = fromScreenY(my);
    }

    function onDragEnd() {
        if (!draggedNode) return;
        draggedNode.fx = null;
        draggedNode.fy = null;
        draggedNode = null;
        simulation.alphaTarget(0);
        canvas.style.cursor = 'grab';

        window.removeEventListener('mousemove', onDragMove);
        window.removeEventListener('mouseup', onDragEnd);
        window.removeEventListener('touchmove', onDragMove);
        window.removeEventListener('touchend', onDragEnd);
    }

    // ── Mouse event handlers ──
    function onMouseMove(e) {
        if (draggedNode) return;
        if (!layoutLoaded) return;

        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        const hit = hitTest(mx, my);
        if (hit !== hoveredNode) {
            hoveredNode = hit;
            canvas.style.cursor = hit ? 'pointer' : 'grab';
            // Re-render if simulation is idle
            if (!simulation || simulation.alpha() < 0.005) render();
        }
    }

    function onClick(e) {
        if (draggedNode) return;
        if (!layoutLoaded) return;

        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        const hit = hitTest(mx, my);
        if (hit) {
            selectedNode = selectedNode === hit ? null : hit;
        } else if (selectedNode) {
            selectedNode = null;
        }
        render();
    }

    function onMouseLeave() {
        if (draggedNode) return;
        hoveredNode = null;
        canvas.style.cursor = 'default';
        if (!simulation || simulation.alpha() < 0.005) render();
    }

    // ── Touch event handlers ──
    function onTouchStart(e) {
        if (!layoutLoaded) return;

        // Clear any existing hold timer
        if (touchHoldTimer) {
            clearTimeout(touchHoldTimer);
            touchHoldTimer = null;
        }

        // Only handle single-finger touches for selection/tooltip
        if (e.touches.length !== 1) return;

        const rect = canvas.getBoundingClientRect();
        const touch = e.touches[0];
        const mx = touch.clientX - rect.left;
        const my = touch.clientY - rect.top;

        touchStartX = mx;
        touchStartY = my;
        touchStartTime = Date.now();

        const hit = hitTest(mx, my);
        touchedNode = hit;

        // Start hold timer for tooltip (400ms)
        if (hit) {
            touchHoldTimer = setTimeout(() => {
                hoveredNode = hit;
                if (!simulation || simulation.alpha() < 0.005) render();
            }, 400);
        }
    }

    function onTouchMove(e) {
        if (!layoutLoaded) return;

        // Clear hold timer on movement
        if (touchHoldTimer) {
            clearTimeout(touchHoldTimer);
            touchHoldTimer = null;
        }

        // If dragging a node or multi-touch, don't show tooltip
        if (draggedNode || e.touches.length !== 1) return;

        const rect = canvas.getBoundingClientRect();
        const touch = e.touches[0];
        const mx = touch.clientX - rect.left;
        const my = touch.clientY - rect.top;

        // Update tooltip as finger moves
        const hit = hitTest(mx, my);
        if (hit !== hoveredNode) {
            hoveredNode = hit;
            if (!simulation || simulation.alpha() < 0.005) render();
        }
    }

    function onTouchEnd(e) {
        if (!layoutLoaded) return;

        // Clear hold timer
        if (touchHoldTimer) {
            clearTimeout(touchHoldTimer);
            touchHoldTimer = null;
        }

        // Only process taps (single finger, short duration, minimal movement)
        if (e.changedTouches.length !== 1) {
            touchedNode = null;
            return;
        }

        const rect = canvas.getBoundingClientRect();
        const touch = e.changedTouches[0];
        const mx = touch.clientX - rect.left;
        const my = touch.clientY - rect.top;

        const duration = Date.now() - touchStartTime;
        const dx = mx - touchStartX;
        const dy = my - touchStartY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Detect tap: < 300ms duration, < 10px movement
        if (duration < 300 && dist < 10) {
            const hit = hitTest(mx, my);
            if (hit) {
                // Tap on node: toggle selection
                selectedNode = selectedNode === hit ? null : hit;
                e.preventDefault();
            } else if (selectedNode) {
                // Tap on empty space: clear selection
                selectedNode = null;
                e.preventDefault();
            }
            render();
        }

        touchedNode = null;
    }

    function onResize() {
        if (!active) return;
        resize();
        if (layoutLoaded) render();
    }

    // ── Keyboard shortcuts ──
    function onKeyDown(e) {
        if (!active) return;
        if (e.key === 'r' || e.key === 'R') {
            // Reheat simulation
            if (simulation) simulation.alpha(0.5).restart();
        } else if (e.key === 'f' || e.key === 'F') {
            // Fit to screen
            fitToScreen();
        }
    }

    // ── Community color generation ──
    function generateCommunityColor(commId) {
        // Generate distinct colors using golden ratio for hue distribution
        const golden_ratio_conjugate = 0.618033988749895;
        const h = (commId * golden_ratio_conjugate) % 1.0;
        const s = 0.65 + (commId % 3) * 0.1; // Vary saturation slightly
        const l = 0.55 + (commId % 2) * 0.1; // Vary lightness slightly

        // Convert HSL to RGB
        const hslToRgb = (h, s, l) => {
            let r, g, b;
            if (s === 0) {
                r = g = b = l;
            } else {
                const hue2rgb = (p, q, t) => {
                    if (t < 0) t += 1;
                    if (t > 1) t -= 1;
                    if (t < 1/6) return p + (q - p) * 6 * t;
                    if (t < 1/2) return q;
                    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                    return p;
                };
                const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
                const p = 2 * l - q;
                r = hue2rgb(p, q, h + 1/3);
                g = hue2rgb(p, q, h);
                b = hue2rgb(p, q, h - 1/3);
            }
            return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
        };

        const [r, g, b] = hslToRgb(h, s, l);
        return `rgb(${r},${g},${b})`;
    }

    // ── Get node color based on current group mode ──
    function getNodeColor(node) {
        const data = window._steamData;

        if (groupMode === 'community' && communitiesData) {
            const nodeId = node.id;
            const commId = communitiesData[nodeId];
            if (commId !== undefined) {
                return generateCommunityColor(commId);
            }
            return '#888'; // Fallback for nodes without community
        } else {
            // Genre coloring (existing behavior)
            return node.game ? (data ? data.getGameColor(node.game) : '#4a9eff') : '#4a9eff';
        }
    }

    // ── Public API (module registration) ──
    window._steamViews = window._steamViews || {};
    window._steamViews.force = {
        _initialized: false,

        async init() {
            resize();
            setupZoom();
            canvas.addEventListener('mousemove', onMouseMove);
            canvas.addEventListener('click', onClick);
            canvas.addEventListener('mouseleave', onMouseLeave);
            canvas.addEventListener('touchstart', onTouchStart, { passive: false });
            canvas.addEventListener('touchmove', onTouchMove, { passive: false });
            canvas.addEventListener('touchend', onTouchEnd, { passive: false });
            window.addEventListener('resize', onResize);
            window.addEventListener('keydown', onKeyDown);
            await loadAndBuild();
        },

        activate() {
            active = true;
            skipEdgeFrames = 3;  // Skip edges for first few renders so tab switch stays responsive
            resize();
            // Defer heavy rendering to next frame so tab click returns immediately
            requestAnimationFrame(() => {
                if (!active) return;
                if (layoutLoaded) {
                    fitToScreen();
                    if (simulation && simulation.alpha() > 0.005) {
                        // Still settling — restart the simulation timer (it renders via onTick)
                        simulation.restart();
                    }
                    // Render nodes immediately (edges skipped by skipEdgeFrames counter).
                    // Edges appear after counter expires on a subsequent frame.
                    render();
                } else if (layoutError) {
                    drawLoading('Network data unavailable.');
                }
            });
        },

        deactivate() {
            active = false;
            // Pause simulation when not visible
            if (simulation) simulation.stop();
            // Clear touch hold timer
            if (touchHoldTimer) {
                clearTimeout(touchHoldTimer);
                touchHoldTimer = null;
            }
        },

        onFilterChange() {
            if (!active) return;
            render();
        },

        setSizeMode(mode) {
            sizeMode = mode;
            recalcNodeSizes();
            // Brief reheat so collide force adjusts to new sizes
            if (simulation && active) {
                simulation.alpha(0.05).restart();
            } else if (active) {
                render();
            }
            // Update note text
            if (window.updateNetworkNote) window.updateNetworkNote();
        },

        setLayoutMode(mode) {
            layoutMode = mode;
            if (!simulation || !active) return;

            const maxWeight = forceLinks.length > 0 ? forceLinks[0].weight : 1;

            if (mode === 'tight') {
                simulation
                    .force('charge', d3.forceManyBody().strength(-5).distanceMax(SIM_SPREAD * 0.8).theta(0.9))
                    .force('link', d3.forceLink(forceLinks).distance(12)
                        .strength(d => 0.02 + 0.08 * Math.min(1, d.weight / maxWeight)))
                    .force('center', d3.forceCenter(0, 0).strength(0.03));
                // Remove genre clustering if present
                simulation.force('x', null).force('y', null);
            } else if (mode === 'spread') {
                simulation
                    .force('charge', d3.forceManyBody().strength(-25).distanceMax(SIM_SPREAD * 3).theta(0.8))
                    .force('link', d3.forceLink(forceLinks).distance(50)
                        .strength(d => 0.003 + 0.015 * Math.min(1, d.weight / maxWeight)))
                    .force('center', d3.forceCenter(0, 0).strength(0.002));
                simulation.force('x', null).force('y', null);
            } else if (mode === 'clustered') {
                // Cluster by primary genre — assign genre-based target positions
                const data = window._steamData;
                const genreCount = data ? data.genreNames.length : 14;
                const maxG = Math.min(14, genreCount);
                const angleStep = (2 * Math.PI) / maxG;
                const clusterR = SIM_SPREAD * 0.6;

                simulation
                    .force('charge', d3.forceManyBody().strength(-8).distanceMax(SIM_SPREAD * 1.2).theta(0.9))
                    .force('link', d3.forceLink(forceLinks).distance(20)
                        .strength(d => 0.006 + 0.03 * Math.min(1, d.weight / maxWeight)))
                    .force('center', d3.forceCenter(0, 0).strength(0.005))
                    .force('x', d3.forceX(d => {
                        const g = d.game ? (d.game[6] || [])[0] : 0;
                        const gi = (g !== undefined && g < maxG) ? g : 0;
                        return Math.cos(gi * angleStep) * clusterR;
                    }).strength(0.04))
                    .force('y', d3.forceY(d => {
                        const g = d.game ? (d.game[6] || [])[0] : 0;
                        const gi = (g !== undefined && g < maxG) ? g : 0;
                        return Math.sin(gi * angleStep) * clusterR;
                    }).strength(0.04));
            } else {
                // Default
                simulation
                    .force('charge', d3.forceManyBody().strength(-10).distanceMax(SIM_SPREAD * 1.5).theta(0.9))
                    .force('link', d3.forceLink(forceLinks).distance(25)
                        .strength(d => 0.008 + 0.04 * Math.min(1, d.weight / maxWeight)))
                    .force('center', d3.forceCenter(0, 0).strength(0.008));
                simulation.force('x', null).force('y', null);
            }

            simulation.alpha(0.4).restart();
        },

        setGroupMode(mode) {
            if (!['genre', 'community'].includes(mode)) return;
            groupMode = mode;
            if (mode === 'community' && !communitiesData) {
                console.warn('Community data not available. Run compute_layout.py to generate community data.');
            }
            if (active) render();
            // Update legend
            if (window.updateNetworkLegend) window.updateNetworkLegend();
        },

        getGroupMode() {
            return groupMode;
        },

        hasCommunitiesData() {
            return communitiesData !== null;
        },

        getNumCommunities() {
            return numCommunities;
        },

        // Search: zoom to a game node by matching game array reference
        // ── High-res export for Playwright ──
        exportRender(w, h, layoutSource) {
            if (!layoutLoaded || !simNodes.length) return null;
            const data = window._steamData;
            const getGameColor = data ? data.getGameColor : () => '#4a9eff';

            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            const cx = c.getContext('2d');

            // Background
            cx.fillStyle = '#0a0a0a';
            cx.fillRect(0, 0, w, h);

            // Choose node positions
            let nodes;
            if (layoutSource === 'fresh') {
                // Deep copy nodes and run fresh simulation
                nodes = simNodes.map(n => ({ ...n, x: n.x, y: n.y }));
                const maxWeight = forceLinks.length > 0 ? forceLinks[0].weight : 1;
                const freshLinks = forceLinks.map(l => ({
                    source: l.source, target: l.target, weight: l.weight
                }));
                const sim = d3.forceSimulation(nodes)
                    .force('charge', d3.forceManyBody().strength(-10).distanceMax(SIM_SPREAD * 1.5).theta(0.9))
                    .force('link', d3.forceLink(freshLinks).distance(25)
                        .strength(d => 0.008 + 0.04 * Math.min(1, d.weight / maxWeight)))
                    .force('center', d3.forceCenter(0, 0).strength(0.008))
                    .force('collide', d3.forceCollide(d => d.r + 0.5).strength(0.15).iterations(1))
                    .alphaDecay(0.028).alphaMin(0.001).velocityDecay(0.45)
                    .alpha(1.0).stop();
                // Run until settled
                for (let i = 0; i < 500 && sim.alpha() > 0.001; i++) sim.tick();
            } else {
                nodes = simNodes;
            }

            // Fit to export canvas
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
            for (const n of nodes) {
                if (n.x < x0) x0 = n.x;
                if (n.y < y0) y0 = n.y;
                if (n.x > x1) x1 = n.x;
                if (n.y > y1) y1 = n.y;
            }
            const dataW = (x1 - x0) || 100;
            const dataH = (y1 - y0) || 100;
            const padPx = Math.round(w * 0.04);
            const k = Math.min((w - padPx * 2) / dataW, (h - padPx * 2) / dataH);
            const dataCx = (x0 + x1) / 2;
            const dataCy = (y0 + y1) / 2;
            const tx = w / 2 - dataCx * k;
            const ty = h / 2 - dataCy * k;
            function toX(sx) { return sx * k + tx; }
            function toY(sy) { return sy * k + ty; }

            const fontScale = w / 1920;

            // Draw ALL edges (batched by color bucket)
            function edgeStyle(wt) {
                if (wt >= 500) return { color: '#FF4488', alpha: 0.25, width: 0.8 };
                if (wt >= 200) return { color: '#FF8833', alpha: 0.18, width: 0.5 };
                if (wt >= 100) return { color: '#DDDD33', alpha: 0.12, width: 0.35 };
                return { color: '#66AADD', alpha: 0.06, width: 0.25 };
            }
            const groups = { '#FF4488': [], '#FF8833': [], '#DDDD33': [], '#66AADD': [] };
            for (const link of renderLinks) {
                const s = nodes[link.si];
                const t = nodes[link.ti];
                if (!s || !t) continue;
                const style = edgeStyle(link.weight);
                groups[style.color].push(toX(s.x), toY(s.y), toX(t.x), toY(t.y));
            }
            const styles = [
                { color: '#66AADD', alpha: 0.06, width: 0.25 },
                { color: '#DDDD33', alpha: 0.12, width: 0.35 },
                { color: '#FF8833', alpha: 0.18, width: 0.5 },
                { color: '#FF4488', alpha: 0.25, width: 0.8 },
            ];
            for (const style of styles) {
                const pts = groups[style.color];
                if (pts.length === 0) continue;
                cx.lineWidth = Math.max(0.15 * fontScale, style.width * fontScale / Math.sqrt(k));
                cx.strokeStyle = style.color;
                cx.globalAlpha = style.alpha;
                cx.beginPath();
                for (let j = 0; j < pts.length; j += 4) {
                    cx.moveTo(pts[j], pts[j+1]);
                    cx.lineTo(pts[j+2], pts[j+3]);
                }
                cx.stroke();
            }
            cx.globalAlpha = 1;

            // Draw nodes
            for (const node of nodes) {
                const sx = toX(node.x);
                const sy = toY(node.y);
                const r = Math.max(1, node.r * Math.min(k, 4));
                const color = getNodeColor(node);
                cx.fillStyle = color;
                cx.globalAlpha = 0.92;
                cx.beginPath();
                cx.arc(sx, sy, r, 0, Math.PI * 2);
                cx.fill();
            }
            cx.globalAlpha = 1;

            // Labels for top-degree nodes
            const fontSize = Math.max(9, 11 * fontScale);
            cx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
            cx.textAlign = 'left';
            cx.textBaseline = 'middle';
            const sorted = nodes.slice().sort((a, b) => b.reviews - a.reviews);
            const maxLabels = Math.min(sorted.length, 80);
            const labelRects = [];
            let labelsDrawn = 0;
            for (const node of sorted) {
                if (labelsDrawn >= maxLabels) break;
                const sx = toX(node.x);
                const sy = toY(node.y);
                const r = Math.max(1, node.r * Math.min(k, 4));
                const lx = sx + r + 4 * fontScale;
                const ly = sy;
                const tw = cx.measureText(node.title).width;
                const lh = fontSize + 2;
                const rect = { x: lx, y: ly - lh / 2, w: tw, h: lh };
                let overlaps = false;
                for (const other of labelRects) {
                    if (rect.x < other.x + other.w && rect.x + rect.w > other.x &&
                        rect.y < other.y + other.h && rect.y + rect.h > other.y) {
                        overlaps = true; break;
                    }
                }
                if (overlaps) continue;
                labelRects.push(rect);
                cx.fillStyle = 'rgba(200,200,200,0.8)';
                cx.fillText(node.title, lx, ly);
                labelsDrawn++;
            }

            return c;
        },

        selectGame(game) {
            if (!layoutLoaded || !simNodes.length) return false;

            // Find the simNode whose .game matches this game array
            let target = null;
            const title = game[0].toLowerCase();
            for (const node of simNodes) {
                if (node.game === game) { target = node; break; }
            }
            // Fallback: match by title
            if (!target) {
                for (const node of simNodes) {
                    if (node.title && node.title.toLowerCase() === title) { target = node; break; }
                }
            }
            if (!target) return false;

            // Zoom to the node
            const targetK = 6;
            const tx = width / 2 - target.x * targetK;
            const ty = height / 2 - target.y * targetK;

            transform = d3.zoomIdentity.translate(tx, ty).scale(targetK);
            if (zoomBehavior) {
                d3.select(canvas).transition().duration(500)
                    .call(zoomBehavior.transform, transform);
            }

            selectedNode = target;
            hoveredNode = target;
            render();
            return true;
        },
    };
})();
