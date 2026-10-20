(() => {
  const dataRoot = "assets/data/standard-map";
  const slider = document.getElementById("standard-map-k");
  const valueOutput = document.getElementById("standard-map-k-value");
  const epsilonSlider = document.getElementById("standard-map-epsilon");
  const epsilonOutput = document.getElementById("standard-map-epsilon-value");
  const resetButton = document.getElementById("standard-map-reset");
  const status = document.getElementById("standard-map-status");
  const phaseCanvas = document.getElementById("phase-canvas");
  const betaCanvas = document.getElementById("beta-canvas");
  const betaReadout = document.getElementById("beta-readout");
  const cache = new Map();
  const phaseSprites = new Map();
  let manifest;
  let currentData;
  let requestId = 0;

  function epsilonFilename(epsilon) {
    return `e-${Number(epsilon).toFixed(4)}.json`;
  }

  function formatK(k) {
    return Number(k).toFixed(Number(k) === 0 || Number(k) >= 1 ? 2 : 4).replace(/0+$/, "").replace(/\.$/, "");
  }

  function formatEpsilon(epsilon) {
    return Number(epsilon).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  }

  async function fetchJson(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Unable to load ${url}`);
    return response.json();
  }

  function loadPhaseSprite(filename) {
    if (!phaseSprites.has(filename)) {
      const source = `${dataRoot}/${filename}`;
      const pending = new Promise((resolve, reject) => {
        const image = new Image();
        image.decoding = "async";
        image.addEventListener("load", () => resolve(image), { once: true });
        image.addEventListener("error", () => reject(new Error(`Unable to load ${source}`)), { once: true });
        image.src = source;
      });
      phaseSprites.set(filename, pending);
    }
    return phaseSprites.get(filename);
  }

  async function loadSlice(index) {
    const k = manifest.kValues[index];
    const epsilon = manifest.epsilonValues[Number(epsilonSlider.value)];
    const cacheKey = String(epsilon);
    const thisRequest = ++requestId;
    valueOutput.textContent = formatK(k);
    epsilonOutput.textContent = formatEpsilon(epsilon);
    status.textContent = "Loading data…";
    slider.disabled = true;
    epsilonSlider.disabled = true;
    try {
      let epsilonData = cache.get(cacheKey);
      if (!epsilonData) {
        epsilonData = await fetchJson(`${dataRoot}/${epsilonFilename(epsilon)}`);
        cache.set(cacheKey, epsilonData);
      }
      if (thisRequest !== requestId) return;
      const data = epsilonData.slices[index];
      if (!data) throw new Error(`No data slice for K index ${index}`);
      const image = await loadPhaseSprite(data.phase.sprite);
      if (thisRequest !== requestId) return;
      currentData = {
        ...data,
        epsilon,
        phase: { ...data.phase, image },
      };
      status.textContent = "";
      drawAll();
    } catch (error) {
      status.textContent = "The data could not be loaded.";
      console.error(error);
    } finally {
      if (thisRequest === requestId) {
        slider.disabled = false;
        epsilonSlider.disabled = false;
      }
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

  function paletteColor(position, alpha = 1) {
    const stops = [
      [0, [196, 39, 69]],
      [0.5, [106, 36, 91]],
      [1, [27, 55, 133]],
    ];
    const t = Math.max(0, Math.min(1, position));
    const [startPosition, startColor] = stops.find((stop, index) => (
      index === stops.length - 1 || t <= stops[index + 1][0]
    ));
    const endIndex = Math.min(stops.length - 1, stops.findIndex((stop) => stop[0] === startPosition) + 1);
    const [endPosition, endColor] = stops[endIndex];
    const proportion = startPosition === endPosition ? 0 : (t - startPosition) / (endPosition - startPosition);
    const color = startColor.map((entry, index) => Math.round(entry + proportion * (endColor[index] - entry)));
    return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
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
    const panelWidth = currentData.phase.spritePanelWidth;
    const panelHeight = currentData.phase.spritePanelHeight;
    context.drawImage(
      currentData.phase.image,
      currentData.phase.spriteIndex * panelWidth,
      0,
      panelWidth,
      panelHeight,
      plot.left,
      plot.top,
      plot.right - plot.left,
      plot.bottom - plot.top,
    );
    context.strokeStyle = "#e7e1f1";
    context.lineWidth = 0.8;
    context.beginPath();
    context.moveTo(plot.left, yToPixel(0));
    context.lineTo(plot.right, yToPixel(0));
    context.stroke();
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

  function traceStrictlyConvexCurve(context, omega, value, xToPixel, yToPixel) {
    const slopes = value.slice(1).map((entry, index) => (entry - value[index]) / (omega[index + 1] - omega[index]));
    const bendFraction = 0.45;
    context.beginPath();
    context.moveTo(xToPixel(omega[0]), yToPixel(value[0]));

    for (let index = 0; index < slopes.length; index += 1) {
      const leftGap = index > 0 ? slopes[index] - slopes[index - 1] : Infinity;
      const rightGap = index < slopes.length - 1 ? slopes[index + 1] - slopes[index] : Infinity;
      const slopeGap = Math.min(leftGap, rightGap);
      const interval = omega[index + 1] - omega[index];
      const bend = bendFraction * slopeGap * interval;
      for (let step = 1; step <= 12; step += 1) {
        const t = step / 12;
        const rotation = omega[index] + t * interval;
        const beta = (1 - t) * value[index] + t * value[index + 1] - bend * t * (1 - t);
        context.lineTo(xToPixel(rotation), yToPixel(beta));
      }
    }
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
    for (let index = 0; index <= 180; index += 1) {
      const rotation = -0.5 + index / 180;
      const command = index === 0 ? "moveTo" : "lineTo";
      context[command](xToPixel(rotation), yToPixel(0.5 * rotation * rotation));
    }
    context.stroke();
    context.restore();

    const betaGradient = context.createLinearGradient(plot.left, 0, plot.right, 0);
    betaGradient.addColorStop(0, paletteColor(0));
    betaGradient.addColorStop(0.5, paletteColor(0.5));
    betaGradient.addColorStop(1, paletteColor(1));
    context.strokeStyle = betaGradient;
    context.lineWidth = 2;
    traceStrictlyConvexCurve(context, omega, value, xToPixel, yToPixel);
    context.stroke();
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
    betaReadout.textContent = `ω = ${omega[index].toFixed(4)}, β = ${currentData.beta.value[index].toFixed(6)} (strictly convex fit; period ${currentData.beta.period})`;
  });

  betaCanvas.addEventListener("mouseleave", () => {
    betaReadout.textContent = "Colour runs from red at ω = −0.5, through plum, to deep blue at ω = 0.5.";
  });

  slider.addEventListener("input", () => loadSlice(Number(slider.value)));
  epsilonSlider.addEventListener("input", () => loadSlice(Number(slider.value)));
  resetButton.addEventListener("click", () => {
    slider.value = "0";
    epsilonSlider.value = "0";
    loadSlice(0);
  });
  window.addEventListener("resize", () => {
    if (currentData) drawAll();
  });

  (async () => {
    if (window.location.protocol === "file:") {
      status.textContent = "Open this module through GitHub Pages or a local web server to load its data.";
      return;
    }
    try {
      manifest = await fetchJson(`${dataRoot}/manifest.json`);
      slider.max = String(manifest.kValues.length - 1);
      epsilonSlider.max = String(manifest.epsilonValues.length - 1);
      epsilonSlider.value = "0";
      slider.disabled = false;
      await loadSlice(0);
    } catch (error) {
      status.textContent = "The module data could not be loaded.";
      console.error(error);
    }
  })();
})();
