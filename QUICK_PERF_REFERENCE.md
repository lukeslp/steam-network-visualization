# Steam Network Performance — Quick Reference

## What Changed (2026-02-16)

**Optimization**: Zoom-based Level of Detail (LOD) for edge rendering
**Impact**: +10-15 FPS at low zoom levels
**Code**: 5 sections, ~50 lines in `force.js`

---

## Console Output (Every ~1 Second)

```
Force: 12.45ms (80.3 FPS) — Edges: 180k/358k rendered (49.7% LOD culled, zoom: 0.60x)
```

**Metrics**:
- **Render time**: Total frame render time (ms)
- **FPS**: 1000 / render time
- **Edges**: Rendered / Total edges
- **LOD culled**: Percentage of edges skipped due to LOD
- **Zoom**: Current zoom level (k)

---

## Performance Targets

| Zoom | Edges | Desktop FPS | Mobile FPS |
|------|-------|-------------|------------|
| 0.5x | 180K  | 40-50       | 25-35      |
| 1.0x | 250K  | 50-60       | 30-40      |
| 2.0x | 305K  | 55-65       | 35-45      |
| 3.0x+ | 358K | 55-65       | 35-45      |

---

## LOD Algorithm

```javascript
// At low zoom: skip weak edges (they're invisible anyway)
const threshold = zoom < 0.8 ? median :        // 50% cull
                  zoom < 1.5 ? median * 0.6 :  // 30% cull
                  zoom < 3.0 ? median * 0.3 :  // 15% cull
                  minWeight;                    // 0% cull (all edges)
```

---

## If FPS Too Low

1. **Check console logs** — is LOD culling active?
2. **Test different zoom levels** — FPS should improve at low zoom
3. **If still slow on mobile**: Consider spatial culling (see PERFORMANCE_ANALYSIS.md)
4. **If dataset grows >50K nodes**: Consider WebGL renderer

---

## Rollback Plan

Remove these 4 lines from `force.js` (line 379-382):
```javascript
if (link.weight < lodThreshold) {
    edgesCulledLOD++;
    continue;
}
```

---

## Files

- **PERFORMANCE_ANALYSIS.md** — Full analysis, bottleneck breakdown
- **OPTIMIZATION_SUMMARY.md** — Code changes, testing plan
- **README_OPTIMIZATION.md** — Completion report, validation steps
- **force.js** — Modified renderer with LOD optimization
