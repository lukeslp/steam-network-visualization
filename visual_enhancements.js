// Visual Enhancements for Steam Game Network Visualization
// This file contains CSS and JS snippets for enhancing the visual appeal of the visualization

// 1. Enhanced Color Schemes with Gradients and Dynamic Palettes
// Function to create a radial gradient for Canvas 2D nodes
function createNodeGradient(ctx, x, y, radius, color1, color2) {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, color1);
    gradient.addColorStop(1, color2);
    return gradient;
}

// Example usage in a Canvas drawing function for nodes
function drawNode(ctx, x, y, radius, baseColor) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = createNodeGradient(ctx, x, y, radius, baseColor, 'rgba(0,0,0,0.5)');
    ctx.fill();
}

// D3.js dynamic color scale for nodes based on data (e.g., approval rating)
const colorScale = d3.scaleSequential(d3.interpolateHcl('#ff6f61', '#6b5b95'))
    .domain([0, 100]); // Adjust domain based on your data range

// 2. Subtle Glow Effects for Nodes and Links
// Function to draw a node with glow effect
function drawGlowingNode(ctx, x, y, radius, color) {
    ctx.shadowBlur = 10; // Subtle blur radius for performance
    ctx.shadowColor = color.replace('1)', '0.6)'); // Lower opacity for glow
    drawNode(ctx, x, y, radius, color);
    ctx.shadowBlur = 0; // Reset to avoid affecting other drawings
}

// Function to draw a link with glow effect
function drawGlowingLink(ctx, x1, y1, x2, y2, color) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.shadowBlur = 5;
    ctx.shadowColor = color.replace('1)', '0.3)');
    ctx.stroke();
    ctx.shadowBlur = 0;
}

// 3. Smooth Tab Transitions with Fade and Slide Effects
// CSS for tab transitions (add to your stylesheet or inline style)
const tabTransitionCSS = `
.tab-content {
    transition: opacity 0.3s ease-in-out, transform 0.3s ease-in-out;
    opacity: 0;
    transform: translateY(10px);
}
.tab-content.active {
    opacity: 1;
    transform: translateY(0);
}
`;

// JavaScript to handle tab switching with transitions
function switchTab(tabId) {
    const contents = document.querySelectorAll('.tab-content');
    contents.forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(tabId).classList.add('active');
}

// 4. Micro-Interactions on Hover and Click
// Function to draw a node with hover effect (scale up slightly)
function drawNodeWithHover(ctx, x, y, radius, color, isHovered) {
    ctx.save();
    if (isHovered) {
        ctx.scale(1.2, 1.2); // Slight scale increase on hover
        ctx.globalAlpha = 0.8; // Slight transparency change
    }
    drawNode(ctx, x, y, radius, color);
    ctx.restore();
}

// Example event listener for hover detection (pseudo-code, adapt to your setup)
canvas.addEventListener('mousemove', (e) => {
    const mouseX = e.clientX;
    const mouseY = e.clientY;
    // Logic to check if mouse is over a node
    nodes.forEach(node => {
        const dist = Math.sqrt((mouseX - node.x) ** 2 + (mouseY - node.y) ** 2);
        node.isHovered = dist < node.radius;
    });
    redrawCanvas(); // Trigger redraw with hover effects
});

// 5. Ambient Background Effects with Lightweight Particles
// Particle system for ambient background effect
class Particle {
    constructor(canvas) {
        this.x = Math.random() * canvas.width;
        this.y = Math.random() * canvas.height;
        this.vx = (Math.random() - 0.5) * 0.5;
        this.vy = (Math.random() - 0.5) * 0.5;
        this.size = Math.random() * 2 + 1;
        this.life = Math.random() * 100 + 50;
    }
}

const particles = [];
const numParticles = 50; // Low number for performance
function initParticles(canvas) {
    for (let i = 0; i < numParticles; i++) {
        particles.push(new Particle(canvas));
    }
}

function updateParticles() {
    particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.1;
        if (p.life <= 0) {
            p.x = Math.random() * canvas.width;
            p.y = Math.random() * canvas.height;
            p.life = Math.random() * 100 + 50;
        }
    });
}

function drawParticles(ctx) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)'; // Very subtle opacity
    particles.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
    });
}

// Example animation loop integration
function animate() {
    updateParticles();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawParticles(ctx);
    // Draw other elements (nodes, links, etc.) on top
    requestAnimationFrame(animate);
}

// Initialize particles when canvas is ready
// initParticles(canvas);
// animate();
