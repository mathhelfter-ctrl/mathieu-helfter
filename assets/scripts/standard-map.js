(() => {
  const dataRoot = "assets/data/standard-map";
  const slider = document.getElementById("standard-map-k");
  const valueOutput = document.getElementById("standard-map-k-value");
  const resetButton = document.getElementById("standard-map-reset");
  const status = document.getElementById("standard-map-status");
  const phaseCanvas = document.getElementById("phase-canvas");
  const betaCanvas = document.getElementById("beta-canvas");
  const betaReadout = document.getElementById("beta-readout");
  const cache = new Map();
  let manifest;
  let currentData;
  let requestId = 0;

  function kFilename(k) {
    return `k-${Number(k).toFixed(4)}.json`;
  }

  function formatK(k) {
    return Number(k).toFixed(Number(k) === 0 || Number(k) >= 1 ? 2 : 4).replace(/0+$/, "").replace(/\.$/, "");
  }

  async function fetchJson(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Unable to load ${url}`);
    return response.json();
  }

  async function loadSlice(index) {
    const k = manifest.kValues[index];
    const thisRequest = ++requestId;
    valueOutput.textContent = formatK(k);
    status.textContent = "Loading precomputed data…";
    slider.disabled = true;
    try {
      let data = cache.get(k);
      if (!data) {
        data = await fetchJson(`${dataRoot}/${kFilename(k)}`);
        cache.set(k, data);
      }
      if (thisRequest !== requestId) return;
      currentData = data;
      status.textContent = "Displaying precomputed data.";
      drawAll();
    } catch (error) {
      status.textContent = "The precomputed data could not be loaded.";
      console.error(error);
    } finally {
      if (thisRequest === requestId) slider.disabled = false;
    }
  }

  function setCanvasSize(canvas) {
    const width = Math.max(260, Math.floor(canvas.clientWidth));
    const height = Math.max(240, Math.floor(canvas.clientHeight));
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    const context = canvas.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { context, width, height };
  }

  function drawFrame(context, width, height, margins, xLabel, yLabel) {
    const plot = {
      left: margins.left,
      right: width - margins.right,
      top: margins.top,
      bottom: height - margins.bottom,
    };
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.strokeStyle = "#d8d1e7";
    context.lineWidth = 1;
    context.strokeRect(plot.left, plot.top, plot.right - plot.left, plot.bottom - plot.top);
    context.fillStyle = "#645f73";
    context.font = "12px Segoe UI, Arial, sans-serif";
    context.textAlign = "center";
    context.fillText(xLabel, (plot.left + plot.right) / 2, height - 11);
    context.save();
    context.translate(14, (plot.top + plot.bottom) / 2);
    context.rotate(-Math.PI / 2);
    context.fillText(yLabel, 0, 0);
    context.restore();
    return plot;
  }

  function drawPhase() {
    const { context, width, height } = setCanvasSize(phaseCanvas);
    if (!currentData) return;
    const yWindow = currentData.phase.yWindow;
    const plot = drawFrame(context, width, height, { left: 46, right: 15, top: 15, bottom: 38 }, "x mod 1", "y");
    const xToPixel = (x) => plot.left + x * (plot.right - plot.left);
    const yToPixel = (y) => plot.bottom - ((y - yWindow[0]) / (yWindow[1] - yWindow[0])) * (plot.bottom - plot.top);

    context.font = "11px Segoe UI, Arial, sans-serif";
    context.fillStyle = "#645f73";
    context.textAlign = "center";
    [0, 0.5, 1].forEach((x) => context.fillText(x.toFixed(1), xToPixel(x), plot.bottom + 16));
    context.textAlign = "right";
    [yWindow[0], 0, yWindow[1]].forEach((y) => context.fillText(y.toFixed(2), plot.left - 6, yToPixel(y) + 4));
    context.strokeStyle = "#e7e1f1";
    context.beginPath();
    context.moveTo(plot.left, yToPixel(0));
    context.lineTo(plot.right, yToPixel(0));
    context.stroke();

    context.fillStyle = "rgba(75, 59, 133, 0.48)";
    const points = currentData.phase.points;
    for (let i = 0; i < points.length; i += 2) {
      context.fillRect(xToPixel(points[i]), yToPixel(points[i + 1]), 1.25, 1.25);
    }
  }

  function extent(values) {
    let minimum = Infinity;
    let maximum = -Infinity;
    values.forEach((value) => {
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
    });
    return [minimum, maximum];
  }

  function drawBeta() {
    const { context, width, height } = setCanvasSize(betaCanvas);
    if (!currentData) return;
    const { omega, value } = currentData.beta;
    const reference = omega.map((rotation) => 0.5 * rotation * rotation);
    const [minimum, maximum] = extent(value.concat(reference));
    const padding = Math.max(0.005, 0.12 * (maximum - minimum));
    const yMin = minimum - padding;
    const yMax = maximum + padding;
    const plot = drawFrame(context, width, height, { left: 57, right: 15, top: 15, bottom: 38 }, "rotation number ω", "β(ω)");
    const xToPixel = (x) => plot.left + ((x + 0.5) / 1) * (plot.right - plot.left);
    const yToPixel = (y) => plot.bottom - ((y - yMin) / (yMax - yMin)) * (plot.bottom - plot.top);

    context.font = "11px Segoe UI, Arial, sans-serif";
    context.fillStyle = "#645f73";
    context.textAlign = "center";
    [-0.5, 0, 0.5].forEach((x) => context.fillText(x.toFixed(1), xToPixel(x), plot.bottom + 16));
    context.textAlign = "right";
    [yMin, (yMin + yMax) / 2, yMax].forEach((y) => context.fillText(y.toFixed(3), plot.left - 6, yToPixel(y) + 4));

    context.save();
    context.setLineDash([5, 4]);
    context.strokeStyle = "#8a819d";
    context.lineWidth = 1.5;
    context.beginPath();
    reference.forEach((y, index) => {
      const command = index === 0 ? "moveTo" : "lineTo";
      context[command](xToPixel(omega[index]), yToPixel(y));
    });
    context.stroke();
    context.restore();

    context.strokeStyle = "#4b3b85";
    context.lineWidth = 2;
    context.beginPath();
    value.forEach((y, index) => {
      const command = index === 0 ? "moveTo" : "lineTo";
      context[command](xToPixel(omega[index]), yToPixel(y));
    });
    context.stroke();
    context.fillStyle = "#4b3b85";
    value.forEach((y, index) => {
      context.beginPath();
      context.arc(xToPixel(omega[index]), yToPixel(y), 2, 0, 2 * Math.PI);
      context.fill();
    });
    context.fillStyle = "#645f73";
    context.textAlign = "left";
    context.fillText("dashed: β₀(ω) = ½ω²", plot.left + 6, plot.top + 16);

    betaCanvas.dataset.plot = JSON.stringify({ left: plot.left, right: plot.right, top: plot.top, bottom: plot.bottom, yMin, yMax });
  }

  function drawAll() {
    drawPhase();
    drawBeta();
  }

  betaCanvas.addEventListener("mousemove", (event) => {
    if (!currentData || !betaCanvas.dataset.plot) return;
    const plot = JSON.parse(betaCanvas.dataset.plot);
    const bounds = betaCanvas.getBoundingClientRect();
    const localX = event.clientX - bounds.left;
    const omega = currentData.beta.omega;
    const proportion = Math.max(0, Math.min(1, (localX - plot.left) / (plot.right - plot.left)));
    const index = Math.round(proportion * (omega.length - 1));
    betaReadout.textContent = `ω = ${omega[index].toFixed(4)}, numerical β = ${currentData.beta.value[index].toFixed(6)} (period ${currentData.beta.period})`;
  });

  betaCanvas.addEventListener("mouseleave", () => {
    betaReadout.textContent = "Move over the plot to inspect a sampled rotation number.";
  });

  slider.addEventListener("input", () => loadSlice(Number(slider.value)));
  resetButton.addEventListener("click", () => {
    slider.value = "0";
    loadSlice(0);
  });
  window.addEventListener("resize", () => {
    if (currentData) drawAll();
  });

  (async () => {
    try {
      manifest = await fetchJson(`${dataRoot}/manifest.json`);
      slider.max = String(manifest.kValues.length - 1);
      slider.disabled = false;
      await loadSlice(0);
    } catch (error) {
      status.textContent = "The module data could not be loaded.";
      console.error(error);
    }
  })();
})();
