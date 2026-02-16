import * as d3 from 'd3';

const backgroundColor = '#121212';

export function drawHeatmap(containerId, data) {
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

  // Data processing: year x rating bucket
  const yearMin = d3.min(data, d => d.releaseYear);
  const yearMax = d3.max(data, d => d.releaseYear);
  const ratingBuckets = [0, 20, 40, 60, 80, 100];
  const heatmapData = d3.rollups(data,
    v => v.length,
    d => d.releaseYear,
    d => ratingBuckets.findIndex(r => r >= d.rating)
  ).flatMap(([year, buckets]) => buckets.map(([bucket, count]) => ({ year, bucket, count })));

  const maxCount = d3.max(heatmapData, d => d.count);
  const colorScale = d3.scaleSequential(d3.interpolateBlues).domain([0, Math.log(maxCount + 1)]);

  // Zoom and pan setup
  let scale = 1;
  let translateX = 0;
  let translateY = 0;

  const zoom = d3.zoom()
    .scaleExtent([1, 10])
    .on('zoom', (event) => {
      scale = event.transform.k;
      translateX = event.transform.x;
      translateY = event.transform.y;
      render();
    });

  d3.select(canvas.node()).call(zoom);

  function render() {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(translateX + 50, translateY + 50); // Margin for axes
    ctx.scale(scale, scale);

    const cellWidth = (width - 100) / (yearMax - yearMin + 1) / scale;
    const cellHeight = (height - 100) / ratingBuckets.length / scale;

    // Draw heatmap cells
    heatmapData.forEach(d => {
      const x = (d.year - yearMin) * cellWidth;
      const y = d.bucket * cellHeight;
      ctx.fillStyle = colorScale(Math.log(d.count + 1));
      ctx.fillRect(x, y, cellWidth, cellHeight);
    });

    // Draw axes
    ctx.fillStyle = '#fff';
    ctx.font = `${12 / scale}px Arial`;
    ctx.textAlign = 'center';
    for (let y = yearMin; y <= yearMax; y += Math.ceil((yearMax - yearMin) / 10 * scale)) {
      const xPos = (y - yearMin) * cellWidth + cellWidth / 2;
      ctx.fillText(y, xPos, -10);
    }
    ctx.textAlign = 'right';
    ratingBuckets.forEach((r, i) => {
      ctx.fillText(`${r}%`, -10, i * cellHeight + cellHeight / 2 + 5);
    });

    ctx.restore();
  }

  render();

  // Tooltip on hover
  canvas.on('mousemove', (event) => {
    const rect = canvas.node().getBoundingClientRect();
    const x = (event.clientX - rect.left - translateX - 50) / scale;
    const y = (event.clientY - rect.top - translateY - 50) / scale;
    const year = Math.floor(x / ((width - 100) / (yearMax - yearMin + 1) / scale)) + yearMin;
    const bucket = Math.floor(y / ((height - 100) / ratingBuckets.length / scale));
    const cell = heatmapData.find(d => d.year === year && d.bucket === bucket);
    if (cell) {
      d3.select(container).selectAll('.tooltip').remove();
      d3.select(container)
        .append('div')
        .attr('class', 'tooltip')
        .style('position', 'absolute')
        .style('left', `${event.clientX + 10}px`)
        .style('top', `${event.clientY}px`)
        .style('background', 'rgba(0,0,0,0.8)')
        .style('color', '#fff')
        .style('padding', '5px')
        .text(`Year: ${year}, Rating: ${ratingBuckets[bucket]}%, Games: ${cell.count}`);
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
