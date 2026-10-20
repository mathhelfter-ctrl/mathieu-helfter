(() => {
  const dataUrl = "assets/data/infinite-fractals/data.json";
  const pSlider = document.getElementById("multifractal-p");
  const pOutput = document.getElementById("multifractal-p-value");
  const gammaSelect = document.getElementById("multifractal-gamma");
  const nSelect = document.getElementById("multifractal-n");
  const status = document.getElementById("multifractal-status");
  const projectionCanvas = document.getElementById("projection-canvas");
  const spectrumCanvas = document.getElementById("spectrum-canvas");
  const scaleSummary = document.getElementById("scale-summary");
  const spectrumReadout = document.getElementById("spectrum-readout");
  let data;

  function pKey(value) {
    return Number(value).toFixed(3);
  }

  function gammaKey(value) {
    return Number(value).toFixed(1);
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

  function frame(context, width, height, xLabel, yLabel) {
    const plot = { left: 48, right: width - 15, top: 15, bottom: height - 38 };
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.strokeStyle = "#d8d1e7";
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

  function paddedExtent(flatPoints, offset) {
    let minimum = Infinity;
    let maximum = -Infinity;
    for (let i = offset; i < flatPoints.length; i += 2) {
      minimum = Math.min(minimum, flatPoints[i]);
      maximum = Math.max(maximum, flatPoints[i]);
    }
    const padding = Math.max(0.0001, 0.12 * (maximum - minimum || 0.001));
    return [minimum - padding, maximum + padding];
  }

  function drawProjection(points) {
    const { context, width, height } = setCanvasSize(projectionCanvas);
    const plot = frame(context, width, height, "chosen probe u", "chosen probe v");
    const [xMin, xMax] = paddedExtent(points, 0);
    const [yMin, yMax] = paddedExtent(points, 1);
    const xToPixel = (x) => plot.left + ((x - xMin) / (xMax - xMin)) * (plot.right - plot.left);
    const yToPixel = (y) => plot.bottom - ((y - yMin) / (yMax - yMin)) * (plot.bottom - plot.top);
    context.fillStyle = "rgba(75, 59, 133, 0.52)";
    for (let i = 0; i < points.length; i += 2) {
      context.beginPath();
      context.arc(xToPixel(points[i]), yToPixel(points[i + 1]), 2, 0, Math.PI * 2);
      context.fill();
    }
  }

  function drawSpectrum(spectrum) {
    const { context, width, height } = setCanvasSize(spectrumCanvas);
    const plot = frame(context, width, height, "local exponent α", "spectrum f(α)");
    const maxEntropy = Math.log(2);
    let xMin;
    let xMax;
    if (spectrum.isPoint) {
      xMin = spectrum.alpha[0] - 0.25;
      xMax = spectrum.alpha[0] + 0.25;
    } else {
      const minimum = Math.min(...spectrum.alpha);
      const maximum = Math.max(...spectrum.alpha);
      const padding = 0.1 * (maximum - minimum);
      xMin = minimum - padding;
      xMax = maximum + padding;
    }
    const yMin = -0.04;
    const yMax = maxEntropy * 1.12;
    const xToPixel = (x) => plot.left + ((x - xMin) / (xMax - xMin)) * (plot.right - plot.left);
    const yToPixel = (y) => plot.bottom - ((y - yMin) / (yMax - yMin)) * (plot.bottom - plot.top);

    context.strokeStyle = "#4b3b85";
    context.lineWidth = 2;
    if (spectrum.isPoint) {
      context.fillStyle = "#4b3b85";
      context.beginPath();
      context.arc(xToPixel(spectrum.alpha[0]), yToPixel(spectrum.f[0]), 5, 0, Math.PI * 2);
      context.fill();
    } else {
      context.beginPath();
      spectrum.alpha.forEach((alpha, index) => {
        const method = index === 0 ? "moveTo" : "lineTo";
        context[method](xToPixel(alpha), yToPixel(spectrum.f[index]));
      });
      context.stroke();
    }
    context.fillStyle = "#d05f8b";
    context.beginPath();
    context.arc(xToPixel(spectrum.typical[0]), yToPixel(spectrum.typical[1]), 4.5, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#645f73";
    context.font = "11px Segoe UI, Arial, sans-serif";
    context.textAlign = "left";
    context.fillText("pink: typical frequency q = p", plot.left + 6, plot.top + 16);
  }

  function currentSelection() {
    const p = data.pValues[Number(pSlider.value)];
    return { p, pKey: pKey(p), gammaKey: gammaKey(gammaSelect.value), n: String(nSelect.value) };
  }

  function drawAll() {
    const selection = currentSelection();
    const points = data.clouds[selection.pKey][selection.gammaKey][selection.n];
    const spectrum = data.spectra[selection.pKey];
    const summary = data.summaries[selection.gammaKey][selection.n];
    pOutput.textContent = Number(selection.p).toFixed(3);
    drawProjection(points);
    drawSpectrum(spectrum);
    scaleSummary.textContent = `N = ${selection.n} coordinates · r_N = ${summary.radius.toExponential(3)} · ${summary.cylinderLabel} cylinders at this resolution · the corresponding power-law dimension tends to infinity as N increases.`;
    spectrumReadout.textContent = spectrum.isPoint
      ? "At p = 1/2 the spectrum is the single point (log 2, log 2)."
      : "The pink marker corresponds to the typical digit frequency q = p.";
  }

  function makeOptions(select, values) {
    values.forEach((value) => {
      const option = document.createElement("option");
      option.value = String(value);
      option.textContent = String(value);
      select.append(option);
    });
  }

  async function start() {
    if (window.location.protocol === "file:") {
      status.textContent = "Open this module through GitHub Pages or a local web server to load its data.";
      return;
    }
    try {
      const response = await fetch(dataUrl);
      if (!response.ok) throw new Error("Unable to load the precomputed data.");
      data = await response.json();
      pSlider.max = String(data.pValues.length - 1);
      pSlider.value = String(Math.floor(data.pValues.length / 2));
      makeOptions(gammaSelect, data.gammaValues);
      makeOptions(nSelect, data.nValues);
      gammaSelect.value = String(data.gammaValues[1]);
      nSelect.value = String(data.nValues[3]);
      pSlider.disabled = false;
      gammaSelect.disabled = false;
      nSelect.disabled = false;
      status.textContent = "Displaying precomputed data.";
      drawAll();
    } catch (error) {
      status.textContent = "The precomputed data could not be loaded.";
      console.error(error);
    }
  }

  pSlider.addEventListener("input", drawAll);
  gammaSelect.addEventListener("change", drawAll);
  nSelect.addEventListener("change", drawAll);
  window.addEventListener("resize", () => {
    if (data) drawAll();
  });
  start();
})();
