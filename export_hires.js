#!/usr/bin/env node
/**
 * High-Resolution Static Image Export for Steam Network Visualizations
 *
 * Generates publication-quality PNGs at 4K, 8K, and 16K for:
 * - Universe (scatter plot)
 * - Network (force-directed graph) — precomputed & fresh layouts
 * - Chord diagram — genres, tags, and games modes
 *
 * Usage: node export_hires.js [--only universe|network|chord] [--res 4k|8k|16k]
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const http = require('http');

const RESOLUTIONS = {
    '4k':  { w: 3840,  h: 2160  },
    '8k':  { w: 7680,  h: 4320  },
    '16k': { w: 15360, h: 8640  },
};

const EXPORT_DIR = path.join(__dirname, 'exports');
const SERVE_PORT = 9876;

// Parse CLI args
const args = process.argv.slice(2);
let onlyViz = null;
let onlyRes = null;
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--only' && args[i + 1]) onlyViz = args[++i];
    if (args[i] === '--res' && args[i + 1]) onlyRes = args[++i];
}

/**
 * Start a simple static file server for the steam directory
 */
function startServer() {
    return new Promise((resolve) => {
        const MIME = {
            '.html': 'text/html', '.js': 'application/javascript',
            '.json': 'application/json', '.css': 'text/css',
            '.png': 'image/png', '.jpg': 'image/jpeg',
        };
        const server = http.createServer((req, res) => {
            const urlPath = req.url.split('?')[0];
            let filePath = path.join(__dirname, urlPath === '/' ? 'index.html' : urlPath);
            const ext = path.extname(filePath);
            fs.readFile(filePath, (err, data) => {
                if (err) { res.writeHead(404); res.end('Not found'); return; }
                res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
                res.end(data);
            });
        });
        server.listen(SERVE_PORT, () => {
            console.log(`Static server on http://localhost:${SERVE_PORT}`);
            resolve(server);
        });
    });
}

/**
 * Extract canvas as PNG buffer using toBlob() — handles large canvases
 */
async function canvasToPNG(page, canvasVar) {
    return await page.evaluate(async (varName) => {
        const canvas = eval(varName);
        if (!canvas || !canvas.toBlob) return null;
        return new Promise((resolve) => {
            canvas.toBlob((blob) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.readAsDataURL(blob);
            }, 'image/png');
        });
    }, canvasVar);
}

/**
 * Save a data URL to a file
 */
function saveDataURL(dataUrl, filePath) {
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
    const mb = (fs.statSync(filePath).size / 1024 / 1024).toFixed(1);
    console.log(`  Saved: ${path.basename(filePath)} (${mb} MB)`);
}

async function main() {
    if (!fs.existsSync(EXPORT_DIR)) fs.mkdirSync(EXPORT_DIR, { recursive: true });

    const server = await startServer();
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    // Increase timeouts for large renders
    page.setDefaultTimeout(300000); // 5 minutes

    console.log('Loading page...');
    await page.goto(`http://localhost:${SERVE_PORT}/`, { waitUntil: 'domcontentloaded' });

    // Wait for data to load
    await page.waitForFunction(() => {
        return window._steamData && window._steamData.allGames && window._steamData.allGames.length > 0;
    }, { timeout: 60000 });

    const gameCount = await page.evaluate(() => window._steamData.allGames.length);
    console.log(`Data loaded: ${gameCount} games\n`);

    const resolutions = onlyRes ? { [onlyRes]: RESOLUTIONS[onlyRes] } : RESOLUTIONS;

    // ── Universe (scatter) ──
    if (!onlyViz || onlyViz === 'universe') {
        console.log('=== Universe (Scatter) ===');
        for (const [label, { w, h }] of Object.entries(resolutions)) {
            process.stdout.write(`  Rendering ${label.toUpperCase()} (${w}×${h})...`);
            const dataUrl = await page.evaluate(async ({ w, h }) => {
                const canvas = window._steamExportScatter(w, h);
                if (!canvas) return null;
                return new Promise((resolve) => {
                    canvas.toBlob((blob) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result);
                        reader.readAsDataURL(blob);
                    }, 'image/png');
                });
            }, { w, h });

            if (dataUrl) {
                saveDataURL(dataUrl, path.join(EXPORT_DIR, `universe-${label}.png`));
            } else {
                console.log(' FAILED');
            }
        }
        console.log();
    }

    // ── Network (force) — precomputed ──
    if (!onlyViz || onlyViz === 'network') {
        console.log('=== Network (Force) — Precomputed Layout ===');
        // Activate force view so it loads
        await page.evaluate(() => {
            const forceTab = document.querySelector('[data-tab="force"]');
            if (forceTab) forceTab.click();
        });
        await page.waitForTimeout(2000); // Let it initialize

        for (const [label, { w, h }] of Object.entries(resolutions)) {
            process.stdout.write(`  Rendering ${label.toUpperCase()} (${w}×${h})...`);
            const dataUrl = await page.evaluate(async ({ w, h }) => {
                const view = window._steamViews && window._steamViews.force;
                if (!view || !view.exportRender) return null;
                const canvas = view.exportRender(w, h, 'precomputed');
                if (!canvas) return null;
                return new Promise((resolve) => {
                    canvas.toBlob((blob) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result);
                        reader.readAsDataURL(blob);
                    }, 'image/png');
                });
            }, { w, h });

            if (dataUrl) {
                saveDataURL(dataUrl, path.join(EXPORT_DIR, `network-precomputed-${label}.png`));
            } else {
                console.log(' FAILED');
            }
        }
        console.log();

        console.log('=== Network (Force) — Fresh Simulation ===');
        for (const [label, { w, h }] of Object.entries(resolutions)) {
            process.stdout.write(`  Rendering ${label.toUpperCase()} (${w}×${h})... (sim may take a minute)`);
            const dataUrl = await page.evaluate(async ({ w, h }) => {
                const view = window._steamViews && window._steamViews.force;
                if (!view || !view.exportRender) return null;
                const canvas = view.exportRender(w, h, 'fresh');
                if (!canvas) return null;
                return new Promise((resolve) => {
                    canvas.toBlob((blob) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result);
                        reader.readAsDataURL(blob);
                    }, 'image/png');
                });
            }, { w, h });

            if (dataUrl) {
                saveDataURL(dataUrl, path.join(EXPORT_DIR, `network-fresh-${label}.png`));
            } else {
                console.log(' FAILED');
            }
        }
        console.log();
    }

    // ── Chord diagram — all 3 modes ──
    if (!onlyViz || onlyViz === 'chord') {
        console.log('=== Chord Diagram ===');
        // Activate chord view
        await page.evaluate(() => {
            const chordTab = document.querySelector('[data-tab="chord"]');
            if (chordTab) chordTab.click();
        });
        await page.waitForTimeout(1000);

        const modes = ['genre', 'tags', 'games'];
        const modeLabels = { genre: 'genres', tags: 'tags', games: 'games' };

        for (const mode of modes) {
            console.log(`  Mode: ${modeLabels[mode]}`);
            for (const [label, { w, h }] of Object.entries(resolutions)) {
                process.stdout.write(`    Rendering ${label.toUpperCase()} (${w}×${h})...`);
                const dataUrl = await page.evaluate(async ({ w, h, mode }) => {
                    const view = window._steamViews && window._steamViews.chord;
                    if (!view || !view.exportRender) return null;
                    const canvas = view.exportRender(w, h, mode);
                    if (!canvas) return null;
                    return new Promise((resolve) => {
                        canvas.toBlob((blob) => {
                            const reader = new FileReader();
                            reader.onload = () => resolve(reader.result);
                            reader.readAsDataURL(blob);
                        }, 'image/png');
                    });
                }, { w, h, mode });

                if (dataUrl) {
                    saveDataURL(dataUrl, path.join(EXPORT_DIR, `chord-${modeLabels[mode]}-${label}.png`));
                } else {
                    console.log(' FAILED');
                }
            }
        }
        console.log();
    }

    // ── Social share collage (1200×630) ──
    if (!onlyViz) {
        console.log('=== Social Share Collage (1200×630) ===');
        const u4k = path.join(EXPORT_DIR, 'universe-4k.png');
        const n4k = path.join(EXPORT_DIR, 'network-precomputed-4k.png');
        const c4k = path.join(EXPORT_DIR, 'chord-genres-4k.png');

        if (fs.existsSync(u4k) && fs.existsSync(n4k) && fs.existsSync(c4k)) {
            // Load the 3 images as base64 for compositing in-browser
            const images = {
                universe: 'data:image/png;base64,' + fs.readFileSync(u4k).toString('base64'),
                network: 'data:image/png;base64,' + fs.readFileSync(n4k).toString('base64'),
                chord: 'data:image/png;base64,' + fs.readFileSync(c4k).toString('base64'),
            };

            const dataUrl = await page.evaluate(async (imgs) => {
                function loadImg(src) {
                    return new Promise((resolve) => {
                        const img = new Image();
                        img.onload = () => resolve(img);
                        img.src = src;
                    });
                }

                const [uImg, nImg, cImg] = await Promise.all([
                    loadImg(imgs.universe), loadImg(imgs.network), loadImg(imgs.chord),
                ]);

                const W = 1200, H = 630, gap = 1;
                const panelW = (W - gap * 2) / 3;
                const c = document.createElement('canvas');
                c.width = W;
                c.height = H;
                const ctx = c.getContext('2d');

                ctx.fillStyle = '#0a0a0a';
                ctx.fillRect(0, 0, W, H);

                // Draw each panel — center-cropped from the 4K source
                const panels = [
                    { img: uImg, x: 0 },
                    { img: nImg, x: panelW + gap },
                    { img: cImg, x: (panelW + gap) * 2 },
                ];

                for (const p of panels) {
                    // Center-crop: scale source to fill panel height, then center horizontally
                    const srcAspect = p.img.width / p.img.height;
                    const panelAspect = panelW / H;
                    let sx, sy, sw, sh;
                    if (srcAspect > panelAspect) {
                        // Source wider — crop sides
                        sh = p.img.height;
                        sw = sh * panelAspect;
                        sx = (p.img.width - sw) / 2;
                        sy = 0;
                    } else {
                        // Source taller — crop top/bottom
                        sw = p.img.width;
                        sh = sw / panelAspect;
                        sx = 0;
                        sy = (p.img.height - sh) / 2;
                    }
                    ctx.drawImage(p.img, sx, sy, sw, sh, p.x, 0, panelW, H);
                }

                return new Promise((resolve) => {
                    c.toBlob((blob) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result);
                        reader.readAsDataURL(blob);
                    }, 'image/png');
                });
            }, images);

            if (dataUrl) {
                saveDataURL(dataUrl, path.join(__dirname, 'steam-universe-social.png'));
                console.log('  Social collage saved as steam-universe-social.png');
            }
        } else {
            console.log('  Skipped — 4K exports not all available');
        }
    }

    await browser.close();
    server.close();
    console.log('\nDone! All exports in ./exports/');
}

main().catch((err) => {
    console.error('Export failed:', err);
    process.exit(1);
});
