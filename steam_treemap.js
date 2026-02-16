import * as d3 from 'd3';

const backgroundColor = '#121212';

// Function to generate genre color using golden angle
const getGenreColor = (genreIdx) => {
  const hue = (genreIdx * 137.508) % 360;
  return d3.hsl(hue, 0.7, 0.6).toString();
};

export function drawTreemap(containerId, data) {
  const container = document.getElementById(containerId);
  let width = container.clientWidth;
  let height = container.clientHeight;

  // Clear previous rendering
  container.innerHTML = '';

  // Create canvas
  const canvas = d3.select(container)
    .append('canvas')
    .attr('width', width)
    .attr('height', height);
  const ctx = canvas.node().getContext('2d');

  // Hierarchy data preparation
  const hierarchy = d3.hierarchy(data)
    .sum(d => d.value || 1);

  let currentLevel = hierarchy;

  // Breadcrumb trail
  const breadcrumb = d3.select(container)
    .append('div')
    .style('position', 'absolute')
    .style('top', '10px')
    .style('left', '10px')
    .style('background', 'rgba(0,0,0,0.5)')
    .style('color', '#fff')
    .style('padding', '5px');

  // Back button
  const backButton = d3.select(container)
    .append('button')
    .text('Back')
    .style('position', 'absolute')
    .style('top', '10px')
    .style('right', '10px')
    .style('background', '#333')
    .style('color', '#fff')
    .style('border', 'none')
    .style('padding', '5px 10px')
    .style('cursor', 'pointer')
    .style('display', 'none')
    .on('click', () => {
      if (currentLevel.parent) {
        currentLevel = currentLevel.parent;
        updateBreadcrumb();
        render();
      }
    });

  function updateBreadcrumb() {
    const path = [];
    let node = currentLevel;
    while (node) {
      path.unshift(node.data.name);
      node = node.parent;
    }
    breadcrumb.text(path.join(' > '));
    backButton.style('display', path.length > 1 ? 'block' : 'none');
  }

  function render() {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width, height);

    // Compute treemap layout
    d3.treemap()
      .size([width, height])
      .padding(2)
      .round(true)
      (currentLevel);

    // Draw rectangles
    currentLevel.leaves().forEach(leaf => {
      const x = leaf.x0;
      const y = leaf.y0;
      const w = leaf.x1 - leaf.x0;
      const h = leaf.y1 - leaf.y0;
      ctx.fillStyle = getGenreColor(leaf.data.genreIdx || leaf.parent.data.genreIdx || 0);
      ctx.fillRect(x, y, w, h);

      // Label if space allows
      if (w > 30 && h > 15) {
        ctx.fillStyle = '#fff';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(leaf.data.name, x + w / 2, y + h / 2);
      }
    });
  }

  render();
  updateBreadcrumb();

  // Click to drill down
  canvas.on('click', (event) => {
    const rect = canvas.node().getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const clickedLeaf = currentLevel.leaves().find(leaf => x >= leaf.x0 && x <= leaf.x1 && y >= leaf.y0 && y <= leaf.y1);
    if (clickedLeaf && clickedLeaf.children) {
      currentLevel = clickedLeaf;
      updateBreadcrumb();
      render();
    }
  });

  // Handle window resize
  window.addEventListener('resize', () => {
    width = container.clientWidth;
    height = container.clientHeight;
    canvas.attr('width', width);
    canvas.attr('height', height);
    render();
  });
}
