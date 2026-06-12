/**
 * Steam Universe - Shared view utilities
 *
 * Loaded once before every view module. Holds the helpers that were previously
 * copy-pasted across chord/force/sankey/tree/treemap/flower: the genre palette,
 * canvas DPR setup, rounded-rect drawing, a single reusable tooltip, and pointer
 * (mouse + touch) input normalization.
 *
 * Data lives on window._steamData (built in index.html). View *utilities* live
 * here on window.SteamViz.
 */
(function() {
  'use strict';

  // Canonical genre palette. Views index into this by genre order; using a
  // single 16-colour list means a given genre is the same colour in every view.
  const GENRE_PALETTE = [
    '#4ade80', '#60a5fa', '#f97316', '#a78bfa', '#22d3ee', '#facc15',
    '#fb7185', '#34d399', '#c084fc', '#f472b6', '#38bdf8', '#fbbf24',
    '#a3e635', '#e879f9', '#2dd4bf', '#818cf8',
  ];

  /**
   * Size a canvas for the device pixel ratio and return its 2D context plus CSS
   * dimensions. setTransform (not scale) is used so repeat calls on resize stay
   * idempotent. Returns { ctx, width, height, dpr } in CSS pixels.
   */
  function setupCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, width, height, dpr };
  }

  /** Trace a rounded rectangle path (caller fills/strokes). */
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** Whole-number formatting with thousands separators. */
  function formatNum(n) {
    return Number(n || 0).toLocaleString();
  }

  /**
   * Normalize a mouse or touch event to canvas-relative coordinates.
   * Returns { x, y, clientX, clientY }. For touchend, falls back to
   * changedTouches so the final position is still available.
   */
  function pointerPos(canvas, evt) {
    const rect = canvas.getBoundingClientRect();
    const t = (evt.touches && evt.touches[0]) ||
              (evt.changedTouches && evt.changedTouches[0]) || evt;
    return {
      x: t.clientX - rect.left,
      y: t.clientY - rect.top,
      clientX: t.clientX,
      clientY: t.clientY,
    };
  }

  /**
   * Bind a hover handler that fires for both mouse and touch movement.
   * handler receives the normalized pointerPos object. Touch moves call
   * preventDefault so dragging a finger to inspect does not scroll the page.
   * Returns an unbind() function for use in a view's deactivate().
   */
  function bindPointerHover(canvas, handler) {
    const onMouse = (e) => handler(pointerPos(canvas, e));
    const onTouch = (e) => {
      if (e.cancelable) e.preventDefault();
      handler(pointerPos(canvas, e));
    };
    canvas.addEventListener('mousemove', onMouse);
    canvas.addEventListener('touchstart', onTouch, { passive: false });
    canvas.addEventListener('touchmove', onTouch, { passive: false });
    return function unbind() {
      canvas.removeEventListener('mousemove', onMouse);
      canvas.removeEventListener('touchstart', onTouch);
      canvas.removeEventListener('touchmove', onTouch);
    };
  }

  /**
   * Create one reusable HTML tooltip element shared by a view. Returns
   * { show(html, clientX, clientY), hide(), el }. The element is created lazily
   * on first show and positioned with viewport clamping so it never runs off
   * the right or bottom edge (a problem in the old per-view copies).
   */
  function makeTooltip() {
    let el = null;
    function ensure() {
      if (el) return el;
      el = document.createElement('div');
      el.style.cssText = [
        'position:fixed', 'pointer-events:none', 'z-index:1000',
        'background:rgba(10,10,10,0.95)', 'border:1px solid #444',
        'border-radius:6px', 'padding:8px 12px', 'font-size:13px',
        'color:#e0e0e0', 'max-width:280px', 'line-height:1.5',
        'box-shadow:0 4px 16px rgba(0,0,0,0.5)', 'display:none',
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      ].join(';');
      document.body.appendChild(el);
      return el;
    }
    return {
      get el() { return el; },
      show(html, clientX, clientY) {
        const node = ensure();
        node.innerHTML = html;
        node.style.display = 'block';
        // Measure, then clamp to the viewport.
        const w = node.offsetWidth;
        const h = node.offsetHeight;
        let x = clientX + 14;
        let y = clientY + 14;
        if (x + w > window.innerWidth) x = clientX - w - 14;
        if (y + h > window.innerHeight) y = clientY - h - 14;
        node.style.left = Math.max(4, x) + 'px';
        node.style.top = Math.max(4, y) + 'px';
      },
      hide() {
        if (el) el.style.display = 'none';
      },
    };
  }

  window.SteamViz = {
    GENRE_PALETTE,
    genreColor(i) {
      if (i == null || i < 0) return '#888';
      return GENRE_PALETTE[i % GENRE_PALETTE.length];
    },
    setupCanvas,
    roundRect,
    formatNum,
    pointerPos,
    bindPointerHover,
    makeTooltip,
  };
})();
