import * as d3 from 'd3';

const backgroundColor = '#121212';

// Function to generate genre color using golden angle
const getGenreColor = (genreIdx) => {
  const hue = (genreIdx * 137.508) % 360;
  return d3.hsl(hue, 0.7, 0.6).toString();
};

export function drawChordDiagram(containerId, data) {
  const container = document.getElementById(containerId);
  const width = container.clientWidth;
  const height = container.clientHeight;
  const innerRadius = Math.min(width, height) * 0.41;
  const outerRadius = innerRadius * 1.1;

  // Clear previous rendering
  container.innerHTML = '';

  // Create canvas
  const canvas = d3.select(container)
    .append('canvas')
    .attr('width', width)
    .attr('height', height);
  const ctx = canvas.node().getContext('2d');

  // Setup zoom and pan
  let scale = 1;
  let translateX = width / 2;
  let translateY = height / 2;

  const zoom = d3.zoom()
    .scaleExtent([0.5, 5])
    .on('zoom', (event) => {
      scale = event.transform.k;
      translateX = event.transform.x + width / 2;
      translateY = event.transform.y + height / 2;
      render();
    });

  d3.select(canvas.node()).call(zoom);

  // Reset button
  const resetButton = d3.select(container)
    .append('button')
    .text('Reset View')
    .style('position', 'absolute')
    .style('top', '10px')
    .style('right', '10px')
    .style('background', '#333')
    .style('color', '#fff')
    .style('border', 'none')
    .style('padding', '5px 10px')
    .style('cursor', 'pointer')
    .on('click', () => {
      scale = 1;
      translateX = width / 2;
      translateY = height / 2;
      d3.select(canvas.node()).call(zoom.transform, d3.zoomIdentity);
      render();
    });

  // Prepare data (top 100 games)
  const games = data.slice(0, 100);
  const matrix = games.map((g1) => games.map((g2) => g1.relatedGames.includes(g2.id) ? 1 : 0));

  const chord = d3.chord()
    .padAngle(0.05)
    .sortSubgroups(d3.descending);

  const chords = chord(matrix);
  const groupAngles = chords.groups.map(g => ({ startAngle: g.startAngle, endAngle: g.endAngle, value: g.value }));

  function render() {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(translateX, translateY);
    ctx.scale(scale, scale);

    // Draw arcs
    games.forEach((game, i) => {
      const group = groupAngles[i];
      ctx.beginPath();
      ctx.strokeStyle = getGenreColor(game.genreIdx);
      ctx.lineWidth = 10;
      ctx.arc(0, 0, innerRadius, group.startAngle, group.endAngle);
      ctx.stroke();

      // Label (visible if zoomed in or space allows)
      if (scale > 1.5 || i % Math.floor(100 / scale) === 0) {
        const midAngle = (group.startAngle + group.endAngle) / 2;
        const x = outerRadius * Math.cos(midAngle);
        const y = outerRadius * Math.sin(midAngle);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(midAngle + Math.PI / 2);
        ctx.fillStyle = '#fff';
        ctx.font = `${12 / scale}px Arial`;
        ctx.textAlign = midAngle > Math.PI ? 'right' : 'left';
        ctx.fillText(game.name, 0, 0);
        ctx.restore();
      }
    });

    // Draw chords
    chords.forEach((chord, i) => {
      const source = groupAngles[chord.source.index];
      const target = groupAngles[chord.target.index];
      const x1 = innerRadius * Math.cos((source.startAngle + source.endAngle) / 2);
      const y1 = innerRadius * Math.sin((source.startAngle + source.endAngle) / 2);
      const x2 = innerRadius * Math.cos((target.startAngle + target.endAngle) / 2);
      const y2 = innerRadius * Math.sin((target.startAngle + target.endAngle) / 2);
      const controlDist = innerRadius * 0.7;
      const cx = 0;
      const cy = 0;

      ctx.beginPath();
      ctx.strokeStyle = getGenreColor(games[chord.source.index].genreIdx);
      ctx.globalAlpha = 0.3 + (chord.source.value / 10);
      ctx.lineWidth = 2 / scale;
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo(cx, cy, x2, y2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    });

    ctx.restore();
  }

  render();

  // Handle window resize
  window.addEventListener('resize', () => {
    canvas.attr('width', container.clientWidth);
    canvas.attr('height', container.clientHeight);
    render();
  });
}
