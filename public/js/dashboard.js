// Monthly collections bar chart (single series, so no legend).
(function () {
  const canvas = document.getElementById('trendChart');
  if (!canvas || !window.Chart) return;
  const data = JSON.parse(canvas.dataset.chart);
  const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
  const compact = (n) => (n >= 100000 ? `₹${(n / 100000).toFixed(n % 100000 ? 1 : 0)}L`
    : n >= 1000 ? `₹${Math.round(n / 1000)}k` : `₹${n}`);

  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.color = '#5b6472';

  new Chart(canvas, {
    type: 'bar',
    data: {
      labels: data.labels,
      datasets: [{
        label: 'Collected',
        data: data.values,
        backgroundColor: 'rgba(0, 102, 214, .78)',
        hoverBackgroundColor: '#0066d6',
        borderRadius: { topLeft: 8, topRight: 8 },
        borderSkipped: 'bottom',
        maxBarThickness: 28,
        categoryPercentage: 0.7,
      }],
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(17, 24, 39, .88)',
          cornerRadius: 10,
          padding: 10,
          displayColors: false,
          callbacks: { label: (ctx) => `Collected: ${inr(ctx.parsed.y)}` },
        },
      },
      scales: {
        x: { grid: { display: false }, border: { color: 'rgba(15, 23, 42, .1)' }, ticks: { maxRotation: 0, autoSkip: true } },
        y: {
          beginAtZero: true,
          border: { display: false },
          grid: { color: 'rgba(15, 23, 42, .06)' },
          ticks: { maxTicksLimit: 5, callback: (v) => compact(v) },
        },
      },
    },
  });
})();
