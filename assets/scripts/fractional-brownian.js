(() => {
  "use strict";
  const GRID = 256;
  const SAMPLE_COUNT = 100;
  const REPETITIONS = 1;
  const SWEEP_POINTS = 99;
  const BRIDGE_SUBDIVISIONS = 8;
  const $ = (id) => document.getElementById(id);
  const controls = [$("sample-hstar"), $("reference-h"), $("epsilon")];
  const generate = $("generate");
  const clear = $("clear-graph");
  const keep = $("keep-reference");
  const durationControl = $("duration");
  const sweepPlan = $("sweep-plan");
  const sweep = $("sweep");
  const stop = $("stop-sweep");
  const sweepProgress = $("sweep-progress");
  const pathsCanvas = $("paths-plot");
  const rateCanvas = $("rate-plot");
  const status = $("experiment-status");
  const proportionText = $("proportion");
  const graphText = $("graph-status");
  const theoryToggle = $("show-theory");
  const theoryStatus = $("theory-status");
  const history = $("run-history");
  const modelCache = new Map();
  const normal = FBmCore.normalGenerator();
  let reference = null;
  let referenceH = null;
  let referenceDuration = null;
  let referenceId = 0;
  let runId = 0;
  let latest = null;
  let runs = [];
  let stopRequested = false;

  function model(h, duration) {
    const key = h;
    if (!modelCache.has(key)) {
      if (modelCache.size >= 8) modelCache.delete(modelCache.keys().next().value);
      modelCache.set(key, FBmCore.factorIncrements(h, GRID));
    }
    const cached = modelCache.get(key);
    modelCache.delete(key);
    modelCache.set(key, cached);
    return { ...cached, scale: Math.pow(duration / GRID, h) };
  }

  function chordalInterpolation(path) {
    const refined = new Float64Array(GRID * BRIDGE_SUBDIVISIONS + 1);
    for (let i = 0; i < GRID; i += 1) {
      for (let j = 0; j <= BRIDGE_SUBDIVISIONS; j += 1) {
        refined[i * BRIDGE_SUBDIVISIONS + j] = path[i] + (path[i + 1] - path[i]) * j / BRIDGE_SUBDIVISIONS;
      }
    }
    return refined;
  }

  // Conditional on its two grid values, a Brownian segment is its chord plus
  // an independent bridge. Recursive midpoints give exact finite samples.
  function brownianBridgeInterpolation(path, duration) {
    const refined = chordalInterpolation(path);
    const fineStep = duration / (GRID * BRIDGE_SUBDIVISIONS);
    function fillMidpoints(left, right) {
      if (right - left <= 1) return;
      const middle = (left + right) >> 1;
      const variance = (right - left) * fineStep / 4;
      refined[middle] = (refined[left] + refined[right]) / 2 + Math.sqrt(variance) * normal();
      fillMidpoints(left, middle); fillMidpoints(middle, right);
    }
    for (let i = 0; i < GRID; i += 1) fillMidpoints(i * BRIDGE_SUBDIVISIONS, (i + 1) * BRIDGE_SUBDIVISIONS);
    return refined;
  }

  function updateSweepPlan() {
    const total = SWEEP_POINTS * REPETITIONS * SAMPLE_COUNT;
    if (Number(controls[0].value) === 0.5) {
      sweepPlan.textContent = `99 points, 100 paths per point (${total.toLocaleString()} paths total), plus Brownian quadrature.`;
      return;
    }
    sweepPlan.textContent = `99 points, 100 paths per point (${total.toLocaleString()} paths total).`;
  }

  function formatTime(time) {
    if (time === 0) return "0";
    return time < 0.001 ? time.toExponential(1).replace(".0e", "e") : String(Number(time.toPrecision(3)));
  }

  function canvasContext(canvas) {
    const width = Math.max(1, Math.round(canvas.clientWidth));
    const height = Math.max(1, Math.round(canvas.clientHeight));
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = "#fffdf9";
    ctx.fillRect(0, 0, width, height);
    return { ctx, width, height };
  }

  function frame(ctx, width, height, xLabel, yLabel) {
    const rect = { left: 62, top: 18, right: width - 20, bottom: height - 48 };
    ctx.strokeStyle = "#d8d1d2";
    ctx.lineWidth = 1;
    ctx.strokeRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
    ctx.fillStyle = "#625960";
    ctx.font = "12px Figtree, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(xLabel, (rect.left + rect.right) / 2, height - 11);
    ctx.save();
    ctx.translate(15, (rect.top + rect.bottom) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(yLabel, 0, 0);
    ctx.restore();
    return rect;
  }

  function drawPaths() {
    const { ctx, width, height } = canvasContext(pathsCanvas);
    const r = frame(ctx, width, height, "time t", "path value");
    if (!latest) {
      ctx.fillStyle = "#625960"; ctx.textAlign = "center";
      ctx.fillText("Generate an experiment to see the paths.", width / 2, height / 2);
      return;
    }
    const { ref, paths, epsilon, duration } = latest;
    const pointCount = ref.length - 1;
    let lo = Infinity; let hi = -Infinity;
    for (const value of ref) { lo = Math.min(lo, value - epsilon); hi = Math.max(hi, value + epsilon); }
    for (const path of paths) for (const value of path) { lo = Math.min(lo, value); hi = Math.max(hi, value); }
    const pad = (hi - lo) * 0.06 || 0.1; lo -= pad; hi += pad;
    const x = (i) => r.left + (i / pointCount) * (r.right - r.left);
    const y = (value) => r.bottom - ((value - lo) / (hi - lo)) * (r.bottom - r.top);
    ctx.font = "11px Figtree, sans-serif"; ctx.fillStyle = "#625960";
    ctx.textAlign = "right";
    const decimals = Math.min(6, Math.max(1, Math.ceil(-Math.log10(hi - lo)) + 1));
    for (let i = 0; i <= 4; i += 1) {
      const value = lo + (hi - lo) * i / 4;
      ctx.fillText(value.toFixed(decimals), r.left - 7, y(value) + 4);
    }
    ctx.textAlign = "center";
    for (let i = 0; i <= 4; i += 1) ctx.fillText(formatTime(duration * i / 4), x(pointCount * i / 4), r.bottom + 18);
    ctx.save(); ctx.beginPath(); ctx.rect(r.left, r.top, r.right - r.left, r.bottom - r.top); ctx.clip();
    ctx.beginPath();
    for (let i = 0; i <= pointCount; i += 1) { if (i === 0) ctx.moveTo(x(i), y(ref[i] + epsilon)); else ctx.lineTo(x(i), y(ref[i] + epsilon)); }
    for (let i = pointCount; i >= 0; i -= 1) ctx.lineTo(x(i), y(ref[i] - epsilon));
    ctx.closePath(); ctx.fillStyle = "rgba(107, 177, 225, 0.28)"; ctx.fill();
    ctx.strokeStyle = "rgba(100, 40, 72, 0.16)"; ctx.lineWidth = 0.85;
    for (const path of paths) {
      ctx.beginPath(); ctx.moveTo(x(0), y(path[0]));
      for (let i = 1; i <= pointCount; i += 1) ctx.lineTo(x(i), y(path[i]));
      ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(x(0), y(ref[0]));
    for (let i = 1; i <= pointCount; i += 1) ctx.lineTo(x(i), y(ref[i]));
    ctx.strokeStyle = "#285b9b"; ctx.lineWidth = 2.2; ctx.stroke(); ctx.restore();
  }

  function drawRates() {
    const { ctx, width, height } = canvasContext(rateCanvas);
    const r = frame(ctx, width, height, "1 / H", "discretised tube rate");
    // Keep only the most recent result at each H, including boundary results.
    const latestByH = new Map();
    for (const run of runs) latestByH.set(run.h, run);
    const plotted = Array.from(latestByH.values()).sort((a, b) => 1 / a.h - 1 / b.h);
    const xMin = 1;
    const furthestX = plotted.length ? Math.max(...plotted.map((run) => 1 / run.h)) : 20;
    const roughStep = Math.max((furthestX - xMin) / 5, 0.2);
    const magnitude = 10 ** Math.floor(Math.log10(roughStep));
    const normalizedStep = roughStep / magnitude;
    const tickStep = (normalizedStep <= 1 ? 1 : normalizedStep <= 2 ? 2 : normalizedStep <= 5 ? 5 : 10) * magnitude;
    const xMax = Math.max(xMin + tickStep, Math.ceil(furthestX / tickStep) * tickStep);
    const graphHStar = runs.length ? runs[0].hStar : Number(controls[0].value);
    const theoryVisible = theoryToggle.checked;
    const theoryKink = 1 / graphHStar;
    const theoryValue = (xValue) => xValue > theoryKink
      ? (1 + 2 * graphHStar) * xValue - 2
      : theoryKink;
    const theoryKind = Math.abs(graphHStar - 0.5) < 1e-12 ? "proved for H* = 0.50" : "conjectural for this H*";
    theoryStatus.textContent = theoryVisible
      ? `Blue: (1 + 2(H* − H)) / H for H < H*, and 1 / H* otherwise; ${theoryKind}. It is compared visually with the discretised results.`
      : "The theoretical curve is hidden.";
    let yMin = 0; let yMax = 1;
    const finiteRuns = plotted.filter((run) => run.value !== null);
    const isBoundary = (run) => run.method === "sample" && (run.hits === 0 || run.hits === run.total);
    const visible = plotted.filter((run) => run.value !== null || isBoundary(run));
    const yValues = finiteRuns.map((run) => run.value);
    if (theoryVisible) yValues.push(theoryValue(xMin), theoryValue(xMax));
    if (yValues.length) {
      yMin = Math.min(...yValues);
      yMax = Math.max(...yValues);
      const padding = Math.max(0.15, (yMax - yMin) * 0.15, Math.abs(yMin) * 0.05, Math.abs(yMax) * 0.05);
      yMin -= padding; yMax += padding;
    }
    const x = (value) => r.left + (value - xMin) / (xMax - xMin) * (r.right - r.left);
    const y = (value) => r.bottom - (value - yMin) / (yMax - yMin) * (r.bottom - r.top);
    const pointY = (run) => isBoundary(run) ? (run.hits === 0 ? r.top + 5 : r.bottom - 5) : y(run.value);
    ctx.font = "11px Figtree, sans-serif"; ctx.fillStyle = "#625960"; ctx.textAlign = "center";
    for (let tick = Math.ceil(xMin / tickStep) * tickStep; tick <= xMax + tickStep * 1e-8; tick += tickStep) {
      ctx.fillText(String(Number(tick.toPrecision(5))), x(tick), r.bottom + 18);
    }
    ctx.textAlign = "right";
    for (let i = 0; i <= 4; i += 1) { const tick = yMin + (yMax - yMin) * i / 4; ctx.fillText(tick.toFixed(2), r.left - 7, y(tick) + 4); }
    if (!visible.length) {
      ctx.textAlign = "center"; ctx.fillText("Generate an experiment to see a point.", width / 2, height / 2);
    }
    if (theoryVisible) {
      ctx.strokeStyle = "#285b9b"; ctx.lineWidth = 2;
      const knot = Math.max(xMin, Math.min(xMax, theoryKink));
      ctx.beginPath(); ctx.moveTo(x(xMin), y(theoryValue(xMin)));
      if (knot > xMin && knot < xMax) ctx.lineTo(x(knot), y(theoryValue(knot)));
      ctx.lineTo(x(xMax), y(theoryValue(xMax))); ctx.stroke();
    }
    ctx.fillStyle = "#744155";
    ctx.strokeStyle = "#744155"; ctx.lineWidth = 1.8;
    const adjusted = visible.filter(isBoundary).length;
    if (visible.length > 1) {
      if (adjusted) ctx.setLineDash([5, 4]);
      ctx.beginPath();
      let pathOpen = false;
      plotted.forEach((run) => {
        if (run.value === null && !isBoundary(run)) { pathOpen = false; return; }
        if (!pathOpen) ctx.moveTo(x(1 / run.h), pointY(run));
        else ctx.lineTo(x(1 / run.h), pointY(run));
        pathOpen = true;
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const run of visible) {
      ctx.beginPath(); ctx.arc(x(1 / run.h), pointY(run), 4.5, 0, 2 * Math.PI);
      if (isBoundary(run)) { ctx.fillStyle = "#fffdf9"; ctx.fill(); ctx.stroke(); ctx.fillStyle = "#744155"; } else ctx.fill();
    }
    const unresolved = plotted.length - visible.length;
    graphText.textContent = `${visible.length} plotted point${visible.length === 1 ? "" : "s"}; ${adjusted} hollow point${adjusted === 1 ? "" : "s"} from an observed proportion of 0 or 1; ${unresolved} unresolved quadrature result${unresolved === 1 ? "" : "s"}.`;
  }

  function drawHistory() {
    history.replaceChildren();
    if (!runs.length) {
      const row = document.createElement("tr"); const cell = document.createElement("td");
      cell.colSpan = 9; cell.textContent = "No experiments yet."; row.append(cell); history.append(row); return;
    }
    for (const run of runs.slice().reverse()) {
      const row = document.createElement("tr");
      const graphValue = run.method === "quadrature" ? (run.value === null ? "Not resolved" : run.value.toFixed(3)) : run.hits === 0 ? "Top edge (P = 0)" : run.hits === run.total ? "Bottom edge (P = 1)" : run.value === null ? "Not defined" : run.value.toFixed(3);
      const estimate = run.method === "quadrature" ? (run.logProbability === null ? "Not resolved" : `10^(${(run.logProbability / Math.LN10).toFixed(2)}) (quadrature + bridges)`) : `${(run.hits / run.total).toPrecision(3)} (sample)`;
      for (const text of [run.id, run.hStar.toFixed(2), run.h.toFixed(5), run.epsilon.toFixed(2), formatTime(run.duration), `${run.hits} / ${run.total}`, estimate, graphValue, `#${run.refId}`]) {
        const cell = document.createElement("td"); cell.textContent = text; row.append(cell);
      }
      history.append(row);
    }
  }

  function setBusy(busy, isSweep = false) {
    for (const element of [...controls, durationControl, generate, clear, keep, sweep]) element.disabled = busy;
    stop.disabled = !busy || !isSweep;
    generate.textContent = busy ? "Generating…" : "Generate";
  }

  function chooseReference(h, duration, forceNew = false) {
    if (forceNew || !keep.checked || !reference || referenceH !== h || referenceDuration !== duration) {
      reference = FBmCore.samplePath(model(h, duration), normal);
      referenceH = h; referenceDuration = duration; referenceId += 1;
    }
    return reference;
  }

  async function generateBatches(hStar, h, epsilon, duration, currentReference, repetitions, isSweep) {
    const sampleModel = model(hStar, duration);
    let paths = []; let hits = 0;
    for (let batch = 0; batch < repetitions; batch += 1) {
      paths = [];
      for (let i = 0; i < SAMPLE_COUNT; i += 1) {
        const path = FBmCore.samplePath(sampleModel, normal); paths.push(path);
        if (FBmCore.insideTube(path, currentReference, epsilon)) hits += 1;
        if ((i + 1) % 20 === 0) {
          status.textContent = `H = ${h.toFixed(5)}: batch ${batch + 1} / ${repetitions}, paths ${i + 1} / ${SAMPLE_COUNT}…`;
          if (isSweep) sweepProgress.textContent = status.textContent;
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (isSweep && stopRequested) return null;
        }
      }
    }
    const result = { paths, hits, total: SAMPLE_COUNT * repetitions, method: "sample", logProbability: null, bridgeLogFactor: null };
    if (hStar === 0.5) {
      result.method = "quadrature";
      let previous = null;
      for (const order of [48, 96, 192]) {
        const computation = FBmCore.brownianTubeQuadrature(currentReference, epsilon, duration, order);
        let done = false;
        while (!done) {
          done = computation.advance(16);
          status.textContent = `H = ${h.toFixed(5)}: Brownian quadrature, order ${order}…`;
          if (isSweep) sweepProgress.textContent = status.textContent;
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (isSweep && stopRequested) return null;
        }
        const estimate = computation.result();
        if (Number.isFinite(estimate) && estimate < -1e-12 && previous !== null && previous < -1e-12 &&
            Math.abs(estimate - previous) <= 0.05 &&
            Math.abs(Math.log(-estimate) - Math.log(-previous)) / -Math.log(epsilon) <= 0.02) {
          // Theorem 4.5's bridge decomposition: conditionally on the grid,
          // the 256 Brownian bridges are independent. This is the explicit
          // bridge factor accompanying the grid-cylinder computation.
          result.bridgeLogFactor = GRID * FBmCore.brownianBridgeLogSurvival(epsilon, duration / GRID);
          result.logProbability = estimate + result.bridgeLogFactor;
          break;
        }
        previous = estimate;
      }
    }
    return result;
  }

  function recordResult(hStar, h, epsilon, duration, currentReference, result) {
    const { paths, hits, total } = result;
    const rawValue = result.method === "quadrature"
      ? (result.logProbability === null ? null : Math.log(-result.logProbability) / -Math.log(epsilon))
      : FBmCore.graphValue(hits, total, epsilon);
    // log(-log(P^(1/epsilon))) / -log(epsilon) = rawValue + 1.
    const value = rawValue === null ? null : rawValue + 1;
    const run = { id: ++runId, hStar, h, epsilon, duration, hits, total, value, method: result.method, logProbability: result.logProbability, bridgeLogFactor: result.bridgeLogFactor, refId: referenceId };
    if (runs.length && (runs[0].hStar !== hStar || runs[0].epsilon !== epsilon || runs[0].duration !== duration)) runs = [];
    runs.push(run);
    const displayReference = hStar === 0.5 ? chordalInterpolation(currentReference) : currentReference;
    const displayPaths = hStar === 0.5
      ? paths.map((path) => brownianBridgeInterpolation(path, duration))
      : paths;
    latest = { ref: displayReference, paths: displayPaths, epsilon, duration };
    drawPaths(); drawRates(); drawHistory();
    const proportionDigits = Math.max(3, Math.ceil(Math.log10(total)));
    const note = run.method === "quadrature" ? (run.logProbability === null ? " The separate Brownian quadrature did not pass its resolution check; no point was plotted." : ` Brownian quadrature with the bridge factor gives log₁₀ P ≈ ${(run.logProbability / Math.LN10).toFixed(2)}.`) : " The discretised probability is this observed proportion.";
    proportionText.textContent = `Observed proportion inside the tube: ${(hits / total).toFixed(proportionDigits)} (${hits} out of ${total} paths).${note}`;
    return run;
  }

  async function runExperiment() {
    const hStar = Number(controls[0].value); const h = Number(controls[1].value); const epsilon = Number(controls[2].value); const duration = Number(durationControl.value);
    setBusy(true); status.textContent = "Preparing the fractional Brownian paths…";
    await new Promise((resolve) => setTimeout(resolve, 20));
    try {
      const currentReference = chooseReference(h, duration);
      const result = await generateBatches(hStar, h, epsilon, duration, currentReference, REPETITIONS, false);
      const run = recordResult(hStar, h, epsilon, duration, currentReference, result);
      status.textContent = `Run ${run.id}: H* = ${hStar.toFixed(2)}, H = ${h.toFixed(2)}, ε = ${epsilon.toFixed(2)}, t = ${formatTime(duration)}; reference #${referenceId}.`;
    } catch (error) {
      console.error(error); status.textContent = "The experiment could not be generated. Please try again.";
    } finally { setBusy(false); }
  }

  async function runSweep() {
    const hStar = Number(controls[0].value); const epsilon = Number(controls[2].value); const duration = Number(durationControl.value);
    if (!(epsilon >= 0.01 && epsilon <= 0.95)) {
      status.textContent = "Choose ε between 0.01 and 0.95.";
      sweepProgress.textContent = status.textContent;
      return;
    }
    const repetitions = REPETITIONS;
    const xStart = 1 / 0.99; const xEnd = 1 / 0.01;
    const hValues = Array.from({ length: SWEEP_POINTS }, (_, i) => 1 / (xStart + (xEnd - xStart) * i / (SWEEP_POINTS - 1)));
    stopRequested = false; setBusy(true, true); status.textContent = "Preparing the automatic graph…";
    sweepProgress.textContent = status.textContent;
    await new Promise((resolve) => setTimeout(resolve, 20));
    try {
      let completed = 0;
      for (const h of hValues) {
        const currentReference = chooseReference(h, duration, true);
        const result = await generateBatches(hStar, h, epsilon, duration, currentReference, repetitions, true);
        if (!result) break;
        recordResult(hStar, h, epsilon, duration, currentReference, result);
        completed += 1;
      }
      status.textContent = stopRequested
        ? `Stopped after ${completed} of ${hValues.length} H values; the unfinished value was not added.`
        : hStar === 0.5 ? `Automatic graph complete: ${completed} H values; Brownian quadrature and 100 paths per value.` : `Automatic graph complete: ${completed} H values, 100 paths per value.`;
      sweepProgress.textContent = status.textContent;
    } catch (error) {
      console.error(error); status.textContent = "The automatic graph could not be completed. Completed points remain visible.";
      sweepProgress.textContent = status.textContent;
    } finally { setBusy(false); }
  }

  controls.forEach((control) => control.addEventListener("input", () => {
    $(`${control.id}-value`).textContent = Number(control.value).toFixed(2);
    if (control === controls[2] || control === controls[0]) updateSweepPlan();
    if (control === controls[0]) drawRates();
    if (latest) status.textContent = "Parameters changed. Press Generate to run a new experiment.";
  }));
  generate.addEventListener("click", runExperiment);
  theoryToggle.addEventListener("change", drawRates);
  durationControl.addEventListener("change", () => { if (latest) status.textContent = "System parameters changed. Press Generate or draw the graph to run a new experiment."; });
  sweep.addEventListener("click", runSweep);
  stop.addEventListener("click", () => { stopRequested = true; status.textContent = "Stopping…"; sweepProgress.textContent = status.textContent; });
  clear.addEventListener("click", () => { runs = []; drawRates(); drawHistory(); });
  let resizeTimer;
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { drawPaths(); drawRates(); }, 100); });
  updateSweepPlan(); drawPaths(); drawRates();
})();
