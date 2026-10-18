// Monthly collections bar chart (single series, so no legend).
(function () {
  const canvas = document.getElementById('trendChart');
  if (!canvas || !window.Chart) return;
  const data = JSON.parse(canvas.dataset.chart);
  const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
  const compact = (n) => (n >= 100000 ? `₹${(n / 100000).toFixed(n % 100000 ? 1 : 0)}L`
    : n >= 1000 ? `₹${Math.round(n / 1000)}k` : `₹${n}`);

  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.color = '#64707d';

  new Chart(canvas, {
    type: 'bar',
    data: {
      labels: data.labels,
      datasets: [{
        label: 'Collected',
        data: data.values,
        backgroundColor: '#1f5f8b',
        hoverBackgroundColor: '#163f5e',
        borderRadius: { topLeft: 4, topRight: 4 },
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
          backgroundColor: '#17212b',
          padding: 10,
          displayColors: false,
          callbacks: { label: (ctx) => `Collected: ${inr(ctx.parsed.y)}` },
        },
      },
      scales: {
        x: { grid: { display: false }, border: { color: '#e3e8ef' }, ticks: { maxRotation: 0, autoSkip: true } },
        y: {
          beginAtZero: true,
          border: { display: false },
          grid: { color: '#eef1f5' },
          ticks: { maxTicksLimit: 5, callback: (v) => compact(v) },
        },
      },
    },
  });
})();
