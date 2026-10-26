(() => {
  "use strict";

  const core = window.StandardMapCore;
  const newModeInput = document.getElementById("standard-map-new-mode");
  const addModeButton = document.getElementById("standard-map-add-mode");
  const playAllButton = document.getElementById("standard-map-play-all");
  const pauseAllButton = document.getElementById("standard-map-pause-all");
  const resetAllButton = document.getElementById("standard-map-reset-all");
  const addedModes = document.getElementById("standard-map-added-modes");
  const randomModeCountInput = document.getElementById("standard-map-random-count");
  const randomModeButton = document.getElementById("standard-map-random-mode");
  const status = document.getElementById("standard-map-status");
  const phaseSvg = document.getElementById("phase-svg");
  const phaseReadout = document.getElementById("phase-readout");
  const betaCanvas = document.getElementById("beta-canvas");
  const betaReadout = document.getElementById("beta-readout");
  const samplingQuality = document.getElementById("standard-map-quality");
  const displayRate = document.getElementById("standard-map-display-rate");
  const displayRateOutput = document.getElementById("standard-map-display-rate-output");
  const alphaInput = document.getElementById("standard-map-alpha");
  const alphaOutput = document.getElementById("standard-map-alpha-output");
  const autoDecayButton = document.getElementById("standard-map-auto-decay");
  const phaseResetViewButton = document.getElementById("phase-reset-view");
  const betaAutocenterViewButton = document.getElementById("beta-autocenter-view");
  const betaAutocenterLockButton = document.getElementById("beta-autocenter-lock");
  const betaResetViewButton = document.getElementById("beta-reset-view");
  const betaDerivativeButton = document.getElementById("beta-derivative-button");

  if (!core) {
    status.textContent = "The numerical module could not start.";
    return;
  }

  const modes = new Map([[1, 0]]);
  const PHASE_ITERATIONS = 2000;
  const PHASE_WINDOW = [-0.3, 0.3];
  const PHASE_DATA_BOUND = 1;
  const PHASE_MIN_X_SPAN = 1 / 32;
  const BETA_X_WINDOW = [-0.5, 0.5];
  const BETA_VALUE_DEFAULT_WINDOW = [-0.035, 0.005];
  const BETA_DERIVATIVE_DEFAULT_WINDOW = [-0.12, 0.12];
  const BETA_MIN_X_SPAN = (BETA_X_WINDOW[1] - BETA_X_WINDOW[0]) / 32;
  const ZERO_SNAP_THRESHOLD = 0.0015;
  const RANDOM_MODE_DEFAULT_COUNT = 3;
  const RANDOM_MODE_MAX = 20;
  const TWO_PI = 2 * Math.PI;
  const BETA_TRANSITION_DURATION = 150;
  const OSCILLATION_BETA_INTERVAL = 120;
  const BETA_INTERPOLATION_SAMPLES = 8;
  const PHASE_RATE_MIN = 0.05;
  const PHASE_RATE_MAX = 60;
  const BETA_OPTIONS_BY_PHASE_SAMPLING = {
    16: { period: 8, minStarts: 2, maxStarts: 2, maxIterations: 80 },
    32: { period: 10, minStarts: 2, maxStarts: 2, maxIterations: 100 },
    64: { period: 12, minStarts: 3, maxStarts: 3, maxIterations: 120 },
    128: { period: 24, minStarts: 4, maxStarts: 10, maxIterations: 280 },
    256: { period: 32, minStarts: 6, maxStarts: 18, maxIterations: 420 }
  };
  const modeControls = new Map();
  let betaData = null;
  let betaDisplayed = null;
  let betaTransition = null;
  let betaTransitionFrame = 0;
  let phaseData = null;
  let phaseDisplayed = null;
  let phaseTransition = null;
  let phaseTransitionFrame = 0;
  let phaseView = { xMin: 0, xMax: 1, yMin: PHASE_WINDOW[0], yMax: PHASE_WINDOW[1] };
  let betaDisplayMode = "value";
  const betaYBounds = {
    value: [...BETA_VALUE_DEFAULT_WINDOW],
    derivative: [...BETA_DERIVATIVE_DEFAULT_WINDOW]
  };
  const betaViews = {
    value: { xMin: BETA_X_WINDOW[0], xMax: BETA_X_WINDOW[1], yMin: BETA_VALUE_DEFAULT_WINDOW[0], yMax: BETA_VALUE_DEFAULT_WINDOW[1] },
    derivative: { xMin: BETA_X_WINDOW[0], xMax: BETA_X_WINDOW[1], yMin: BETA_DERIVATIVE_DEFAULT_WINDOW[0], yMax: BETA_DERIVATIVE_DEFAULT_WINDOW[1] }
  };
  let betaView = { ...betaViews.value };
  let betaAutoCenterLocked = true;
  let betaRequest = 0;
  let betaTimer = 0;
  let betaWorker = null;
  let betaIsComputing = false;
  let phaseFrame = 0;
  let phaseNeedsRecompute = false;
  let phaseDrag = null;
  let betaDrag = null;
  const oscillators = new Map();
  let globalPlayback = false;
  let automaticDecay = true;
  let oscillationFrame = 0;
  let oscillationLastPhase = -Infinity;
  let oscillationLastBeta = -Infinity;

  function formatCoefficient(value) {
    const rounded = Number(value);
    if (Math.abs(rounded) < 0.00005) return "0";
    return rounded.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  }

  function snapToZero(slider) {
    const value = Number(slider.value);
    if (Math.abs(value) > ZERO_SNAP_THRESHOLD) return value;
    slider.value = "0";
    return 0;
  }

  function phaseViewWindow() {
    return phaseView;
  }

  function betaViewWindow() {
    return betaView;
  }

  function betaYWindow() {
    return betaYBounds[betaDisplayMode];
  }

  function betaDefaultYWindow() {
    return betaDisplayMode === "derivative" ? BETA_DERIVATIVE_DEFAULT_WINDOW : BETA_VALUE_DEFAULT_WINDOW;
  }

  function updateBetaDisplayButtons() {
    const derivativeSelected = betaDisplayMode === "derivative";
    betaDerivativeButton.classList.toggle("is-active", derivativeSelected);
    betaDerivativeButton.setAttribute("aria-pressed", String(derivativeSelected));
  }

  function setBetaAutoCenterLocked(locked) {
    betaAutoCenterLocked = locked;
    setPressed(betaAutocenterLockButton, locked);
    const state = locked ? "locked" : "unlocked";
    betaAutocenterLockButton.setAttribute("aria-label", "Automatic beta centring is " + state);
    betaAutocenterLockButton.title = "Automatic beta centring is " + state;
  }

  function selectBetaDisplay(mode) {
    if (mode === betaDisplayMode) return;
    betaViews[betaDisplayMode] = { ...betaView };
    betaDisplayMode = mode;
    betaView = { ...betaViews[mode] };
    updateBetaDisplayButtons();
    drawBeta();
  }

  function formatAxisValue(value, digits = 3) {
    const threshold = 0.5 * 10 ** (-digits);
    return Math.abs(value) < threshold ? "0" : value.toFixed(digits);
  }

  function formatBetaBoundaryValue(value) {
    if (value === 0) return "0";
    const digits = clamp(1 - Math.floor(Math.log10(Math.abs(value))), 3, 6);
    return value.toFixed(digits);
  }

  function svgElement(name, attributes = {}) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", name);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
    return element;
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function boundedInterval(start, span, minimum, maximum) {
    const size = clamp(span, 0, maximum - minimum);
    const left = clamp(start, minimum, maximum - size);
    return [left, Math.min(maximum, left + size)];
  }

  function wheelFactor(deltaY) {
    return clamp(Math.exp(-deltaY * 0.003), 0.65, 1.55);
  }

  function pointerFractions(event, element, plot, width, height) {
    const bounds = element.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * width;
    const y = ((event.clientY - bounds.top) / bounds.height) * height;
    return {
      x: clamp((x - plot.left) / (plot.right - plot.left), 0, 1),
      y: clamp((y - plot.top) / (plot.bottom - plot.top), 0, 1)
    };
  }

  function activeModes() {
    return [...modes.entries()]
      .map(([mode, value]) => ({ mode, value }))
      .filter(({ value }) => Math.abs(value) > 1e-14)
      .sort((left, right) => left.mode - right.mode);
  }

  function normalisationExponent() {
    return Number(alphaInput.value);
  }

  function updateAlphaOutput() {
    alphaOutput.textContent = normalisationExponent().toFixed(3);
  }

  function setAutomaticDecay(enabled) {
    automaticDecay = enabled;
    setPressed(autoDecayButton, enabled);
  }

  function refreshSuggestedMode() {
    const firstAvailable = Array.from({ length: 99 }, (_, index) => index + 1)
      .find((mode) => !modes.has(mode));
    const everyModeIsSelected = firstAvailable === undefined;
    newModeInput.value = String(firstAvailable ?? 99);
    newModeInput.disabled = everyModeIsSelected;
    addModeButton.disabled = everyModeIsSelected;
  }

  function automaticDecayExponent() {
    const selectedModes = [...modes.keys()];
    if (!selectedModes.length) return 1.5;
    const effectiveMode = Math.exp(
      selectedModes.reduce((sum, mode) => sum + Math.log(mode), 0) / selectedModes.length
    );
    const isolatedModeExponent = 1.25 + 0.25 / Math.sqrt(effectiveMode);
    // Empirical compensation for the accumulated force of several active
    // frequencies: c^m keeps dense selections readable without altering a
    // single-mode standard map. The manual slider remains available to tune it.
    const densityCompensation = 1.04 ** Math.max(0, selectedModes.length - 1);
    return clamp(isolatedModeExponent * densityCompensation, 0, 4);
  }

  function applyAutomaticDecay() {
    alphaInput.value = automaticDecayExponent().toFixed(3);
    updateAlphaOutput();
  }

  function autoDecay() {
    setAutomaticDecay(true);
    applyAutomaticDecay();
    parameterChanged();
  }

  function betaComputationOptions() {
    const base = BETA_OPTIONS_BY_PHASE_SAMPLING[phaseCurveCount()] || BETA_OPTIONS_BY_PHASE_SAMPLING[64];
    return { ...base, alpha: normalisationExponent() };
  }

  function phaseCurveCount() {
    return Number(samplingQuality.value);
  }

  function phaseFrameRate() {
    const position = Number(displayRate.value);
    if (!Number.isFinite(position) || position <= 0) return 0;
    const logarithmicPosition = clamp(position, 0, 1);
    return PHASE_RATE_MIN * Math.pow(PHASE_RATE_MAX / PHASE_RATE_MIN, logarithmicPosition);
  }

  function phaseUpdateInterval() {
    const framesPerSecond = phaseFrameRate();
    return framesPerSecond > 0 ? 1000 / framesPerSecond : Infinity;
  }

  function phaseUsesInterpolation() {
    return phaseFrameRate() > 0;
  }

  function updateDisplayRateOutput() {
    const rate = phaseFrameRate();
    if (rate === 0) {
      displayRateOutput.textContent = "Paused";
    } else if (rate < 1) {
      displayRateOutput.textContent = rate.toFixed(2) + " fps";
    } else if (rate < 10) {
      displayRateOutput.textContent = rate.toFixed(1) + " fps";
    } else {
      displayRateOutput.textContent = Math.round(rate) + " fps";
    }
  }

  function updatePhaseReadout() {
    const rate = phaseFrameRate();
    const rateNote = phaseUsesInterpolation()
      ? " The portrait updates at " + (rate < 1 ? rate.toFixed(2) : rate < 10 ? rate.toFixed(1) : Math.round(rate)) + " fps and interpolates between computed portraits."
      : " Automatic phase-portrait updates are paused.";
    phaseReadout.textContent = phaseCurveCount() + " uniform initial conditions on x = 0.5, each followed for 2,000 iterates; y ∈ [−0.30, 0.30]. Colour follows the initial y: red, through plum, to deep blue." + rateNote + " Scroll to zoom; drag to move the view.";
  }

  function makeIconButton(symbol, label) {
    const button = document.createElement("button");
    button.className = "text-button standard-map-icon-button";
    button.type = "button";
    button.setAttribute("aria-label", label);
    button.title = label;
    const icon = document.createElement("span");
    icon.className = "standard-map-symbol";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = symbol;
    button.append(icon);
    return button;
  }

  function updateModeOutput(mode) {
    const control = modeControls.get(mode);
    if (control) control.output.textContent = formatCoefficient(modes.get(mode));
  }

  function orderModeRows() {
    [...modeControls.values()]
      .sort((left, right) => left.mode - right.mode)
      .forEach((control) => addedModes.append(control.row));
  }

  function setPressed(button, pressed) {
    button.classList.toggle("is-active", pressed);
    button.setAttribute("aria-pressed", String(pressed));
  }

  function setModePlaybackAppearance(control, playing) {
    setPressed(control.playButton, playing);
    setPressed(control.pauseButton, !playing);
  }

  function setGlobalPlayback(playing) {
    globalPlayback = playing;
    setPressed(playAllButton, playing);
    setPressed(pauseAllButton, !playing);
  }

  function renderStaticControl(control) {
    const { mode, inputArea } = control;
    const slider = document.createElement("input");
    slider.id = "standard-map-k-" + mode;
    slider.className = "standard-map-parameter-slider";
    slider.type = "range";
    slider.min = "-0.1";
    slider.max = "0.1";
    slider.step = "0.0005";
    slider.value = String(modes.get(mode));
    slider.setAttribute("aria-label", "Fourier coefficient K " + mode);
    const sliderBox = document.createElement("div");
    sliderBox.className = "standard-map-slider-with-zero";
    const zeroMark = document.createElement("span");
    zeroMark.className = "standard-map-zero-mark";
    zeroMark.setAttribute("aria-hidden", "true");
    sliderBox.append(slider, zeroMark);
    inputArea.replaceChildren(sliderBox);
    control.slider = slider;
    setModePlaybackAppearance(control, false);
    slider.addEventListener("input", () => {
      modes.set(mode, snapToZero(slider));
      updateModeOutput(mode);
      parameterChanged();
    });
  }

  function renderOscillationControls(control) {
    const oscillator = oscillators.get(control.mode);
    if (!oscillator) return;
    const controls = document.createElement("div");
    controls.className = "standard-map-oscillation-controls";

    const speedLabel = document.createElement("label");
    speedLabel.htmlFor = "standard-map-speed-" + control.mode;
    speedLabel.append("Frequency = ");
    const speedOutput = document.createElement("output");
    speedOutput.textContent = oscillator.frequency.toFixed(3);
    speedLabel.append(speedOutput, " Hz");
    const speed = document.createElement("input");
    speed.id = "standard-map-speed-" + control.mode;
    speed.className = "standard-map-frequency-slider";
    speed.type = "range";
    speed.min = "0";
    speed.max = "0.1";
    speed.step = "0.0001";
    speed.value = String(oscillator.frequency);
    speed.setAttribute("aria-label", "Oscillation frequency for K " + control.mode);

    const amplitudeLabel = document.createElement("label");
    amplitudeLabel.htmlFor = "standard-map-amplitude-" + control.mode;
    amplitudeLabel.append("Amplitude = ");
    const amplitudeOutput = document.createElement("output");
    amplitudeOutput.textContent = oscillator.amplitude.toFixed(4);
    amplitudeLabel.append(amplitudeOutput);
    const amplitude = document.createElement("input");
    amplitude.id = "standard-map-amplitude-" + control.mode;
    amplitude.className = "standard-map-amplitude-slider";
    amplitude.type = "range";
    amplitude.min = "0";
    amplitude.max = "0.1";
    amplitude.step = "0.0001";
    amplitude.value = String(oscillator.amplitude);
    amplitude.setAttribute("aria-label", "Oscillation amplitude for K " + control.mode);

    speed.addEventListener("input", () => {
      oscillator.frequency = Number(speed.value);
      speedOutput.textContent = oscillator.frequency.toFixed(3);
      parameterChanged();
    });
    amplitude.addEventListener("input", () => {
      oscillator.amplitude = Number(amplitude.value);
      amplitudeOutput.textContent = oscillator.amplitude.toFixed(4);
      parameterChanged();
    });
    controls.append(speedLabel, speed, amplitudeLabel, amplitude);
    control.inputArea.replaceChildren(controls);
    control.slider = null;
    setModePlaybackAppearance(control, true);
  }

  function registerModeControl({ mode, row, inputArea, output, playButton, pauseButton, resetButton }) {
    const control = { mode, row, inputArea, output, playButton, pauseButton, resetButton, slider: null, initialFrequency: null, initialPhase: null, initialAmplitude: null };
    modeControls.set(mode, control);
    playButton.addEventListener("click", () => playMode(mode));
    pauseButton.addEventListener("click", () => pauseMode(mode));
    resetButton.addEventListener("click", () => resetMode(mode));
    renderStaticControl(control);
    updateModeOutput(mode);
    return control;
  }

  function createModeRow(mode) {
    const row = document.createElement("div");
    row.className = "standard-map-mode-row";
    const label = document.createElement("label");
    label.htmlFor = "standard-map-k-" + mode;
    label.append("Parameter K");
    const subscript = document.createElement("sub");
    subscript.textContent = String(mode);
    const output = document.createElement("output");
    output.textContent = "0";
    label.append(subscript, " = ", output);
    const inputArea = document.createElement("div");
    const actions = document.createElement("div");
    actions.className = "standard-map-mode-actions";
    actions.setAttribute("aria-label", "Fourier mode " + mode + " controls");
    const playButton = makeIconButton("▶", "Play K " + mode);
    const pauseButton = makeIconButton("⏸", "Pause K " + mode);
    const resetButton = makeIconButton("↻", "Reset K " + mode);
    const removeButton = makeIconButton("×", "Remove Fourier mode " + mode);
    removeButton.classList.add("standard-map-remove-mode");
    actions.append(playButton, pauseButton, resetButton, removeButton);
    row.append(label, inputArea, actions);
    addedModes.append(row);
    const control = registerModeControl({ mode, row, inputArea, output, playButton, pauseButton, resetButton });
    orderModeRows();
    removeButton.addEventListener("click", () => {
      pauseMode(mode, false);
      modes.delete(mode);
      modeControls.delete(mode);
      row.remove();
      refreshSuggestedMode();
      if (automaticDecay) applyAutomaticDecay();
      parameterChanged();
    });
    return control;
  }

  function addMode() {
    const mode = Number(newModeInput.value);
    if (!Number.isInteger(mode) || mode < 1 || mode > 99) {
      status.textContent = "Choose an integer Fourier mode between 1 and 99.";
      return;
    }
    if (modes.has(mode)) {
      status.textContent = "K" + mode + " is already available.";
      return;
    }
    modes.set(mode, 0);
    createModeRow(mode);
    refreshSuggestedMode();
    if (automaticDecay) applyAutomaticDecay();
    status.textContent = "K" + mode + " was added; move its slider or play it.";
    if (globalPlayback) playMode(mode);
    else if (automaticDecay) parameterChanged();
    else schedulePhase();
  }

  function setCanvasSize(canvas) {
    const width = Math.max(260, Math.floor(canvas.clientWidth || 640));
    const height = Math.max(240, Math.floor(canvas.clientHeight || 352));
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    const context = canvas.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { context, width, height, ratio };
  }

  function drawFrame(context, width, height, margins, xLabel, yLabel) {
    const plot = {
      left: margins.left,
      right: width - margins.right,
      top: margins.top,
      bottom: height - margins.bottom
    };
    context.fillStyle = "#fffdf9";
    context.fillRect(0, 0, width, height);
    context.strokeStyle = "#d8d1e7";
    context.lineWidth = 1;
    context.strokeRect(plot.left, plot.top, plot.right - plot.left, plot.bottom - plot.top);
    context.fillStyle = "#645f73";
    context.font = "12px Figtree, Arial, sans-serif";
    context.textAlign = "center";
    context.fillText(xLabel, (plot.left + plot.right) / 2, height - 11);
    context.save();
    context.translate(14, (plot.top + plot.bottom) / 2);
    context.rotate(-Math.PI / 2);
    context.fillText(yLabel, 0, 0);
    context.restore();
    return plot;
  }

  function paletteRgb(position) {
    const stops = [
      [0, [196, 39, 69]],
      [0.5, [106, 36, 91]],
      [1, [27, 55, 133]]
    ];
    const t = Math.max(0, Math.min(1, position));
    let start = stops[0];
    let end = stops[stops.length - 1];
    for (let index = 0; index < stops.length - 1; index += 1) {
      if (t <= stops[index + 1][0]) {
        start = stops[index];
        end = stops[index + 1];
        break;
      }
    }
    const proportion = (t - start[0]) / (end[0] - start[0] || 1);
    return start[1].map((value, index) => Math.round(value + proportion * (end[1][index] - value)));
  }

  function computePhaseData() {
    const numericalModes = activeModes();
    const alpha = normalisationExponent();
    const curves = [];
    const curveCount = phaseCurveCount();
    for (let curve = 0; curve < curveCount; curve += 1) {
      let x = 0.5;
      let y = PHASE_WINDOW[0] + (curve / (curveCount - 1)) * (PHASE_WINDOW[1] - PHASE_WINDOW[0]);
      const points = [];
      for (let iterate = 0; iterate < PHASE_ITERATIONS; iterate += 1) {
        const impulse = core.force(x, numericalModes, alpha);
        y += impulse;
        x += y;
        x -= Math.floor(x);
        points.push(Number.isFinite(x) && Number.isFinite(y) && Math.abs(y) <= PHASE_DATA_BOUND ? { x, y } : null);
      }
      const colour = paletteRgb(curve / (curveCount - 1));
      curves.push({ colour: "rgb(" + colour.join(",") + ")", points });
    }
    return curves;
  }

  function drawPhase(data = phaseDisplayed || phaseData) {
    if (!data) return;
    const width = 640;
    const height = 352;
    const plot = { left: 64, right: width - 15, top: 15, bottom: height - 38 };
    const { xMin, xMax, yMin, yMax } = phaseViewWindow();
    const xToPixel = (x) => plot.left + ((x - xMin) / (xMax - xMin)) * (plot.right - plot.left);
    const yToPixel = (y) => plot.bottom - ((y - yMin) / (yMax - yMin)) * (plot.bottom - plot.top);
    const contents = document.createDocumentFragment();

    contents.append(
      svgElement("rect", { x: 0, y: 0, width, height, fill: "#fffdf9" }),
      svgElement("rect", {
        x: plot.left, y: plot.top, width: plot.right - plot.left, height: plot.bottom - plot.top,
        fill: "#fff", stroke: "#d8d1e7", "stroke-width": 1
      })
    );

    if (yMin <= 0 && yMax >= 0) {
      contents.append(svgElement("line", {
        x1: plot.left, x2: plot.right, y1: yToPixel(0), y2: yToPixel(0),
        stroke: "#e7e1f1", "stroke-width": 0.8
      }));
    }

    data.forEach(({ colour, points }) => {
      const commands = [];
      points.forEach((point) => {
        if (!point || point.x < xMin || point.x > xMax || point.y < yMin || point.y > yMax) return;
        commands.push("M", xToPixel(point.x).toFixed(2), " ", yToPixel(point.y).toFixed(2), "h0.15");
      });
      if (commands.length === 0) return;
      contents.append(svgElement("path", {
        d: commands.join(""), fill: "none", stroke: colour, "stroke-width": 1.15, "stroke-linecap": "round"
      }));
    });

    [xMin, (xMin + xMax) / 2, xMax].forEach((x) => {
      const label = svgElement("text", {
        x: xToPixel(x), y: plot.bottom + 16, fill: "#645f73", "font-size": 11, "text-anchor": "middle"
      });
      label.textContent = formatAxisValue(x, 2);
      contents.append(label);
    });
    [...new Set([yMin, 0, yMax].filter((y) => y >= yMin && y <= yMax))].forEach((y) => {
      const label = svgElement("text", {
        x: plot.left - 6, y: yToPixel(y) + 4, fill: "#645f73", "font-size": 11, "text-anchor": "end"
      });
      label.textContent = formatAxisValue(y, 2);
      contents.append(label);
    });
    const xLabel = svgElement("text", {
      x: (plot.left + plot.right) / 2, y: height - 11, fill: "#645f73", "font-size": 12, "text-anchor": "middle"
    });
    xLabel.textContent = "x mod 1";
    const yLabel = svgElement("text", {
      x: 14, y: (plot.top + plot.bottom) / 2, fill: "#645f73", "font-size": 12, "text-anchor": "middle",
      transform: "rotate(-90 14 " + (plot.top + plot.bottom) / 2 + ")"
    });
    yLabel.textContent = "y";
    contents.append(xLabel, yLabel);

    phaseSvg.setAttribute("viewBox", "0 0 " + width + " " + height);
    phaseSvg.replaceChildren(contents);
  }

  function betaDifferenceValues(omega, value) {
    return value.map((entry, index) => entry - 0.5 * omega[index] * omega[index]);
  }

  function betaInterpolationSegments(omega, value) {
    const secants = value.slice(1).map((entry, index) => (
      (entry - value[index]) / (omega[index + 1] - omega[index])
    ));
    const poleKnots = new Set(betaDerivativePoleIndices(secants));
    return secants.map((secant, index) => {
      const neighbouringCurvatures = [];
      if (index > 0) neighbouringCurvatures.push(secant - secants[index - 1]);
      if (index < secants.length - 1) neighbouringCurvatures.push(secants[index + 1] - secant);
      // This is local rather than global smoothing. The factor 1/2 exactly
      // recovers beta_0(omega) = omega^2/2 on the uniform rotation grid.
      const curvature = neighbouringCurvatures.length
        ? 0.5 * Math.max(0, Math.min(...neighbouringCurvatures))
        : 0;
      return {
        start: omega[index],
        end: omega[index + 1],
        width: omega[index + 1] - omega[index],
        value: value[index],
        secant,
        curvature,
        poleAfter: poleKnots.has(index + 1)
      };
    });
  }

  function betaDifferenceAt(segment, proportion) {
    const t = clamp(proportion, 0, 1);
    const omega = segment.start + segment.width * t;
    const beta = segment.value + segment.width * (
      segment.secant * t + segment.curvature * t * (t - 1)
    );
    return beta - 0.5 * omega * omega;
  }

  function betaDifferenceDerivativeAt(segment, proportion) {
    const t = clamp(proportion, 0, 1);
    const omega = segment.start + segment.width * t;
    return segment.secant + segment.curvature * (2 * t - 1) - omega;
  }

  function betaDifferenceCurveValues(omega, value) {
    const samples = [];
    betaInterpolationSegments(omega, value).forEach((segment) => {
      for (let sample = 0; sample <= BETA_INTERPOLATION_SAMPLES; sample += 1) {
        samples.push(betaDifferenceAt(segment, sample / BETA_INTERPOLATION_SAMPLES));
      }
    });
    return samples;
  }

  function betaDifferenceDerivativeValues(omega, value) {
    return betaInterpolationSegments(omega, value)
      .flatMap((segment) => [
        betaDifferenceDerivativeAt(segment, 0),
        betaDifferenceDerivativeAt(segment, 1)
      ]);
  }

  function median(values) {
    if (!values.length) return 0;
    const sorted = values.slice().sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function betaDerivativePoleIndices(secants) {
    // A finite grid forces a tiny slope jump at almost every knot, even for a
    // smooth beta function. A marked corner must therefore be a robust local
    // outlier of this discrete curvature, rather than merely a non-zero jump.
    const slopeJumps = secants.slice(1).map((secant, index) => Math.max(0, secant - secants[index]));
    const positiveJumps = slopeJumps.filter((jump) => jump > 1e-12);
    if (!positiveJumps.length) return [];

    const globalBaseline = median(positiveJumps);
    const secantScale = Math.abs(secants[secants.length - 1] - secants[0]);
    const numericalFloor = Math.max(1e-8, secantScale / Math.max(400, 40 * slopeJumps.length));

    return slopeJumps.flatMap((jump, index) => {
      const neighbours = slopeJumps.filter((_, candidate) => (
        candidate !== index && Math.abs(candidate - index) <= 2
      ));
      const localBaseline = neighbours.length ? median(neighbours) : globalBaseline;
      // This filters the ordinary, evenly spread curvature of a smooth
      // numerical graph while retaining an isolated central corner.
      const baseline = Math.max(numericalFloor, globalBaseline * 0.5, localBaseline);
      if (jump < 1.5 * baseline) return [];
      return [index + 1];
    });
  }

  function betaDerivativePoleCandidates(segments) {
    return segments.slice(0, -1).flatMap((segment, index) => {
      if (!segment.poleAfter) return [];
      const previous = betaDifferenceDerivativeAt(segment, 1);
      const next = betaDifferenceDerivativeAt(segments[index + 1], 0);
      return Math.abs(next - previous) > 1e-10
        ? [{ omega: segment.end, previous, next }]
        : [];
    });
  }

  function traceBetaDifferenceCurve(context, omega, value, xToPixel, yToPixel) {
    const segments = betaInterpolationSegments(omega, value);
    context.beginPath();
    segments.forEach((segment, index) => {
      for (let sample = 0; sample <= BETA_INTERPOLATION_SAMPLES; sample += 1) {
        const t = sample / BETA_INTERPOLATION_SAMPLES;
        const omegaAtSample = segment.start + segment.width * t;
        const point = [xToPixel(omegaAtSample), yToPixel(betaDifferenceAt(segment, t))];
        if (index === 0 && sample === 0) context.moveTo(...point);
        else context.lineTo(...point);
      }
    });
  }

  function traceBetaDifferenceDerivativeCurve(context, omega, value, xToPixel, yToPixel) {
    const segments = betaInterpolationSegments(omega, value);
    context.beginPath();
    segments.forEach((segment) => {
      // Each interval has an affine derivative. Restarting at each knot keeps
      // its two one-sided values separate when the derivative has a pole.
      context.moveTo(xToPixel(segment.start), yToPixel(betaDifferenceDerivativeAt(segment, 0)));
      context.lineTo(xToPixel(segment.end), yToPixel(betaDifferenceDerivativeAt(segment, 1)));
    });
    return segments;
  }

  function traceBetaDerivativePoles(context, segments, xToPixel, yToPixel) {
    context.beginPath();
    betaDerivativePoleCandidates(segments).forEach(({ omega, previous, next }) => {
      context.moveTo(xToPixel(omega), yToPixel(previous));
      context.lineTo(xToPixel(omega), yToPixel(next));
    });
  }

  function autoCenterBetaView() {
    const data = betaDisplayed || betaData;
    if (!data) return;
    const target = betaAutoCenterTarget(data);
    if (!target) return;
    betaYBounds[betaDisplayMode] = [target.yMin, target.yMax];
    betaView = target;
    betaViews[betaDisplayMode] = { ...betaView };
    drawBeta();
  }

  function betaAutoCenterTarget(data, sourceView = betaView) {
    const values = betaDisplayMode === "derivative"
      ? betaDifferenceDerivativeValues(data.omega, data.value)
      : betaDifferenceCurveValues(data.omega, data.value);
    const finiteValues = values.filter(Number.isFinite);
    if (!finiteValues.length) return null;
    const minimum = Math.min(...finiteValues);
    const maximum = Math.max(...finiteValues);
    const [defaultMinimum, defaultMaximum] = betaDefaultYWindow();
    const minimumSpan = (defaultMaximum - defaultMinimum) / 64;
    const span = Math.max(maximum - minimum, minimumSpan);
    const padding = Math.max(0.16 * span, minimumSpan / 2);
    const yMin = minimum - padding;
    const yMax = maximum + padding;
    return { ...sourceView, yMin, yMax };
  }

  function drawBeta(data = betaDisplayed || betaData) {
    if (!data) return;
    const { context, width, height } = setCanvasSize(betaCanvas);
    const yLabel = betaDisplayMode === "derivative" ? "∂ω(βV(ω) − β0(ω))" : "βV(ω) − β0(ω)";
    const plot = drawFrame(context, width, height, { left: 64, right: 15, top: 15, bottom: 38 }, "rotation number ω", yLabel);
    const view = betaViewWindow();
    const xToPixel = (x) => plot.left + ((x - view.xMin) / (view.xMax - view.xMin)) * (plot.right - plot.left);
    const yToPixel = (y) => plot.bottom - ((y - view.yMin) / (view.yMax - view.yMin)) * (plot.bottom - plot.top);

    context.font = "11px Figtree, Arial, sans-serif";
    context.fillStyle = "#645f73";
    context.textAlign = "center";
    [view.xMin, (view.xMin + view.xMax) / 2, view.xMax].forEach((x) => {
      context.fillText(formatAxisValue(x, 2), xToPixel(x), plot.bottom + 16);
    });
    context.textAlign = "right";
    [view.yMin, 0, view.yMax]
      .filter((y) => y >= view.yMin && y <= view.yMax)
      .filter((y, index, values) => values.indexOf(y) === index)
      .forEach((y) => {
        context.fillText(y === 0 ? "0" : formatBetaBoundaryValue(y), plot.left - 6, yToPixel(y) + 4);
      });

    if (view.yMin <= 0 && view.yMax >= 0) {
      context.save();
      context.setLineDash([5, 4]);
      context.strokeStyle = "#8a819d";
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(plot.left, yToPixel(0));
      context.lineTo(plot.right, yToPixel(0));
      context.stroke();
      context.restore();
    }

    const gradient = context.createLinearGradient(plot.left, 0, plot.right, 0);
    gradient.addColorStop(0, "rgb(196, 39, 69)");
    gradient.addColorStop(0.5, "rgb(106, 36, 91)");
    gradient.addColorStop(1, "rgb(27, 55, 133)");
    context.save();
    context.beginPath();
    context.rect(plot.left, plot.top, plot.right - plot.left, plot.bottom - plot.top);
    context.clip();
    context.strokeStyle = gradient;
    context.lineWidth = 2;
    let derivativeSegments = null;
    if (betaDisplayMode === "derivative") {
      derivativeSegments = traceBetaDifferenceDerivativeCurve(context, data.omega, data.value, xToPixel, yToPixel);
    } else {
      traceBetaDifferenceCurve(context, data.omega, data.value, xToPixel, yToPixel);
    }
    context.stroke();
    if (derivativeSegments) {
      context.save();
      context.setLineDash([4, 3]);
      context.strokeStyle = "#7c5a76";
      context.lineWidth = 1.25;
      traceBetaDerivativePoles(context, derivativeSegments, xToPixel, yToPixel);
      context.stroke();
      context.restore();
    }
    context.restore();
    betaCanvas.dataset.plot = JSON.stringify({
      left: plot.left, right: plot.right, top: plot.top, bottom: plot.bottom,
      xMin: view.xMin, xMax: view.xMax, yMin: view.yMin, yMax: view.yMax, width, height
    });
  }

  function schedulePhase(recompute = false) {
    if (recompute) phaseNeedsRecompute = true;
    if (phaseFrame) return;
    phaseFrame = window.requestAnimationFrame(() => {
      phaseFrame = 0;
      const shouldRecompute = phaseNeedsRecompute;
      phaseNeedsRecompute = false;
      if (shouldRecompute || !phaseData) displayPhaseResult(computePhaseData());
      else drawPhase();
    });
  }

  function canInterpolatePhaseData(from, to) {
    return from.length === to.length && from.every((curve, index) => (
      curve.points.length === to[index].points.length
    ));
  }

  function interpolatePhaseData(from, to, progress) {
    return to.map((targetCurve, curveIndex) => ({
      ...targetCurve,
      points: targetCurve.points.map((targetPoint, pointIndex) => {
        const sourcePoint = from[curveIndex].points[pointIndex];
        if (!sourcePoint || !targetPoint) return targetPoint;
        let horizontalDifference = targetPoint.x - sourcePoint.x;
        if (horizontalDifference > 0.5) horizontalDifference -= 1;
        if (horizontalDifference < -0.5) horizontalDifference += 1;
        const x = sourcePoint.x + progress * horizontalDifference;
        return { x: x - Math.floor(x), y: sourcePoint.y + progress * (targetPoint.y - sourcePoint.y) };
      })
    }));
  }

  function phaseInterpolationProgress(progress) {
    const elapsed = clamp(progress, 0, 1);
    const remaining = 1 - elapsed;
    return 1 - remaining * remaining * Math.exp(-2 * elapsed);
  }

  function animatePhaseTransition(now) {
    if (!phaseTransition) {
      phaseTransitionFrame = 0;
      return;
    }
    const progress = clamp((now - phaseTransition.startedAt) / phaseTransition.duration, 0, 1);
    phaseDisplayed = interpolatePhaseData(
      phaseTransition.from,
      phaseTransition.to,
      phaseInterpolationProgress(progress)
    );
    drawPhase(phaseDisplayed);
    if (progress < 1) {
      phaseTransitionFrame = window.requestAnimationFrame(animatePhaseTransition);
      return;
    }
    phaseDisplayed = phaseTransition.to;
    phaseTransition = null;
    phaseTransitionFrame = 0;
  }

  function displayPhaseResult(result) {
    const current = phaseDisplayed || phaseData;
    phaseData = result;
    window.cancelAnimationFrame(phaseTransitionFrame);
    if (!phaseUsesInterpolation() || !current || !canInterpolatePhaseData(current, result)) {
      phaseTransition = null;
      phaseDisplayed = result;
      drawPhase(result);
      return;
    }
    phaseTransition = {
      from: current,
      to: result,
      duration: phaseUpdateInterval(),
      startedAt: currentTime()
    };
    phaseDisplayed = current;
    phaseTransitionFrame = window.requestAnimationFrame(animatePhaseTransition);
  }

  function interpolateBetaData(from, to, progress) {
    return {
      ...to,
      value: to.value.map((value, index) => from.value[index] + progress * (value - from.value[index]))
    };
  }

  function animateBetaTransition(now) {
    if (!betaTransition) {
      betaTransitionFrame = 0;
      return;
    }
    const progress = clamp((now - betaTransition.startedAt) / BETA_TRANSITION_DURATION, 0, 1);
    betaDisplayed = interpolateBetaData(betaTransition.from, betaTransition.to, progress);
    if (betaTransition.viewTo) {
      const { viewFrom, viewTo } = betaTransition;
      betaView = {
        xMin: viewFrom.xMin + progress * (viewTo.xMin - viewFrom.xMin),
        xMax: viewFrom.xMax + progress * (viewTo.xMax - viewFrom.xMax),
        yMin: viewFrom.yMin + progress * (viewTo.yMin - viewFrom.yMin),
        yMax: viewFrom.yMax + progress * (viewTo.yMax - viewFrom.yMax)
      };
      betaViews[betaDisplayMode] = { ...betaView };
    }
    drawBeta(betaDisplayed);
    if (progress < 1) {
      betaTransitionFrame = window.requestAnimationFrame(animateBetaTransition);
      return;
    }
    betaDisplayed = betaTransition.to;
    if (betaTransition.viewTo) {
      betaView = { ...betaTransition.viewTo };
      betaViews[betaDisplayMode] = { ...betaView };
    }
    betaTransition = null;
    betaTransitionFrame = 0;
  }

  function displayBetaResult(result) {
    const current = betaDisplayed || betaData;
    betaData = result;
    window.cancelAnimationFrame(betaTransitionFrame);
    const targetView = betaAutoCenterLocked ? betaAutoCenterTarget(result) : null;
    if (targetView) betaYBounds[betaDisplayMode] = [targetView.yMin, targetView.yMax];
    if (!current || current.value.length !== result.value.length) {
      betaTransition = null;
      betaDisplayed = result;
      if (targetView) {
        betaView = targetView;
        betaViews[betaDisplayMode] = { ...betaView };
      }
      drawBeta(result);
      return;
    }
    betaTransition = {
      from: current,
      to: result,
      viewFrom: { ...betaView },
      viewTo: targetView,
      startedAt: currentTime()
    };
    betaDisplayed = current;
    betaTransitionFrame = window.requestAnimationFrame(animateBetaTransition);
  }

  function finishBeta(requestId, result) {
    if (requestId !== betaRequest) return;
    betaIsComputing = false;
    status.textContent = "";
    displayBetaResult(result);
  }

  function failBeta(requestId, message) {
    if (requestId !== betaRequest) return;
    betaIsComputing = false;
    status.textContent = "The numerical β computation did not finish: " + message;
  }

  function startBetaComputation(requestId, payload) {
    betaTimer = 0;
    betaIsComputing = true;
    if (window.Worker && window.location.protocol !== "file:") {
      const worker = new Worker("assets/scripts/standard-map-worker.js");
      betaWorker = worker;
      worker.addEventListener("message", (event) => {
        if (event.data.error) failBeta(event.data.requestId, event.data.error);
        else finishBeta(event.data.requestId, event.data.beta);
        worker.terminate();
        if (betaWorker === worker) betaWorker = null;
      }, { once: true });
      worker.addEventListener("error", () => {
        failBeta(requestId, "worker error");
        worker.terminate();
        if (betaWorker === worker) betaWorker = null;
      }, { once: true });
      worker.postMessage({ requestId, modes: payload.modes, options: payload.options });
      return;
    }

    window.setTimeout(() => {
      try {
        finishBeta(requestId, core.computeBeta(payload.modes, payload.options));
      } catch (error) {
        failBeta(requestId, error instanceof Error ? error.message : String(error));
      }
    }, 0);
  }

  function scheduleBeta(immediate = false) {
    window.clearTimeout(betaTimer);
    betaTimer = 0;
    if (betaWorker) {
      betaWorker.terminate();
      betaWorker = null;
    }
    betaIsComputing = false;
    const requestId = ++betaRequest;
    const payload = { modes: activeModes(), options: betaComputationOptions() };
    betaTimer = window.setTimeout(() => startBetaComputation(requestId, payload), immediate ? 0 : 160);
  }

  function setModeValue(mode, value) {
    const coefficient = clamp(value, -0.1, 0.1);
    modes.set(mode, coefficient);
    const control = modeControls.get(mode);
    if (control?.slider) control.slider.value = String(coefficient);
    updateModeOutput(mode);
  }

  function normalisedRandomModeCount() {
    const requested = Number(randomModeCountInput.value);
    const count = Number.isInteger(requested)
      ? clamp(requested, 1, RANDOM_MODE_MAX)
      : RANDOM_MODE_DEFAULT_COUNT;
    randomModeCountInput.value = String(count);
    return count;
  }

  function chooseRandomModes(count) {
    const candidates = Array.from({ length: RANDOM_MODE_MAX }, (_, index) => index + 1);
    for (let index = candidates.length - 1; index > 0; index -= 1) {
      const choice = Math.floor(Math.random() * (index + 1));
      [candidates[index], candidates[choice]] = [candidates[choice], candidates[index]];
    }
    return candidates.slice(0, count).sort((left, right) => left - right);
  }

  function currentTime() {
    return window.performance?.now?.() ?? Date.now();
  }

  function stopOscillationLoopIfIdle() {
    if (oscillators.size || !oscillationFrame) return;
    window.cancelAnimationFrame(oscillationFrame);
    oscillationFrame = 0;
  }

  function updateOscillators(now) {
    oscillators.forEach((oscillator, mode) => {
      const elapsed = (now - oscillator.startedAt) / 1000;
      setModeValue(mode, oscillator.amplitude * Math.sin(TWO_PI * oscillator.frequency * elapsed + oscillator.phase));
    });
  }

  function animateOscillators(now) {
    if (!oscillators.size) {
      oscillationFrame = 0;
      return;
    }
    updateOscillators(now);
    if (now - oscillationLastPhase >= phaseUpdateInterval()) {
      oscillationLastPhase = now;
      schedulePhase(true);
    }
    if (!betaIsComputing && !betaTimer && now - oscillationLastBeta >= OSCILLATION_BETA_INTERVAL) {
      oscillationLastBeta = now;
      scheduleBeta(true);
    }
    oscillationFrame = window.requestAnimationFrame(animateOscillators);
  }

  function ensureOscillationLoop() {
    if (!oscillators.size || oscillationFrame) return;
    oscillationFrame = window.requestAnimationFrame(animateOscillators);
  }

  function playMode(mode, recompute = true) {
    if (oscillators.has(mode)) return false;
    const now = currentTime();
    const currentValue = modes.get(mode) || 0;
    const control = modeControls.get(mode);
    const amplitude = Number.isFinite(control.initialAmplitude)
      ? control.initialAmplitude
      : clamp(Math.max(0.05, Math.abs(currentValue)), 0, 0.1);
    const phase = Number.isFinite(control.initialPhase)
      ? control.initialPhase
      : Math.asin(clamp(currentValue / amplitude, -1, 1));
    const frequency = Number.isFinite(control.initialFrequency) ? control.initialFrequency : 0.01;
    control.initialFrequency = null;
    control.initialPhase = null;
    control.initialAmplitude = null;
    oscillators.set(mode, { frequency, amplitude, phase, startedAt: now });
    renderOscillationControls(control);
    updateOscillators(now);
    ensureOscillationLoop();
    if (recompute) parameterChanged();
    return true;
  }

  function pauseMode(mode, recompute = true) {
    if (!oscillators.delete(mode)) return false;
    const control = modeControls.get(mode);
    if (control) renderStaticControl(control);
    stopOscillationLoopIfIdle();
    if (recompute) parameterChanged();
    return true;
  }

  function resetMode(mode, recompute = true) {
    oscillators.delete(mode);
    const control = modeControls.get(mode);
    if (control) {
      control.initialFrequency = null;
      control.initialPhase = null;
      control.initialAmplitude = null;
      renderStaticControl(control);
    }
    setModeValue(mode, 0);
    stopOscillationLoopIfIdle();
    if (recompute) parameterChanged();
  }

  function playAllModes(updateDefault = true, recompute = true) {
    if (updateDefault) setGlobalPlayback(true);
    let changed = false;
    [...modes.keys()].forEach((mode) => {
      changed = playMode(mode, false) || changed;
    });
    if (changed && recompute) parameterChanged();
  }

  function pauseAllModes(recompute = true, updateDefault = false) {
    if (updateDefault) setGlobalPlayback(false);
    let changed = false;
    [...oscillators.keys()].forEach((mode) => {
      changed = pauseMode(mode, false) || changed;
    });
    if (changed && recompute) parameterChanged();
    return changed;
  }

  function resetAllModes() {
    setGlobalPlayback(false);
    pauseAllModes(false);
    [...modes.keys()].forEach((mode) => resetMode(mode, false));
    status.textContent = "All Fourier coefficients were reset to 0.";
    parameterChanged();
  }

  function selectRandomModes() {
    const count = normalisedRandomModeCount();
    pauseAllModes(false);
    modeControls.clear();
    addedModes.replaceChildren();
    modes.clear();
    chooseRandomModes(count).forEach((mode) => {
      modes.set(mode, 0);
      const control = createModeRow(mode);
      control.initialFrequency = Math.round((0.001 + 0.099 * Math.random()) * 10000) / 10000;
      control.initialPhase = TWO_PI * Math.random();
      control.initialAmplitude = 0.01 + 0.09 * Math.random();
    });
    refreshSuggestedMode();
    if (automaticDecay) applyAutomaticDecay();
    if (globalPlayback) playAllModes(false, false);
    status.textContent = globalPlayback
      ? "Selected " + count + " new random Fourier modes with random frequencies, phases, and amplitudes."
      : "Selected " + count + " new random Fourier modes with random frequencies, phases, and amplitudes; none is playing.";
    parameterChanged();
  }

  function parameterChanged() {
    schedulePhase(true);
    scheduleBeta();
  }

  addModeButton.addEventListener("click", addMode);
  newModeInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") addMode();
  });
  samplingQuality.addEventListener("change", () => {
    updatePhaseReadout();
    schedulePhase(true);
    scheduleBeta(true);
  });
  displayRate.addEventListener("input", () => {
    oscillationLastPhase = -Infinity;
    updateDisplayRateOutput();
    updatePhaseReadout();
    if (!phaseUsesInterpolation()) {
      window.cancelAnimationFrame(phaseTransitionFrame);
      phaseTransition = null;
      phaseDisplayed = phaseData;
      drawPhase();
    } else if (phaseTransition && phaseData) {
      window.cancelAnimationFrame(phaseTransitionFrame);
      phaseTransition = {
        from: phaseDisplayed || phaseData,
        to: phaseData,
        duration: phaseUpdateInterval(),
        startedAt: currentTime()
      };
      phaseTransitionFrame = window.requestAnimationFrame(animatePhaseTransition);
    }
  });
  alphaInput.addEventListener("input", () => {
    setAutomaticDecay(false);
    updateAlphaOutput();
    parameterChanged();
  });
  autoDecayButton.addEventListener("click", autoDecay);
  playAllButton.addEventListener("click", () => playAllModes());
  pauseAllButton.addEventListener("click", () => pauseAllModes(true, true));
  resetAllButton.addEventListener("click", resetAllModes);
  randomModeCountInput.addEventListener("input", () => {
    if (Number(randomModeCountInput.value) > RANDOM_MODE_MAX) {
      randomModeCountInput.value = String(RANDOM_MODE_MAX);
    }
  });
  randomModeCountInput.addEventListener("change", normalisedRandomModeCount);
  randomModeButton.addEventListener("click", selectRandomModes);
  phaseResetViewButton.addEventListener("click", () => {
    phaseView = { xMin: 0, xMax: 1, yMin: PHASE_WINDOW[0], yMax: PHASE_WINDOW[1] };
    drawPhase();
  });
  betaResetViewButton.addEventListener("click", () => {
    const [yMin, yMax] = betaDefaultYWindow();
    betaYBounds[betaDisplayMode] = [yMin, yMax];
    betaView = { xMin: BETA_X_WINDOW[0], xMax: BETA_X_WINDOW[1], yMin, yMax };
    betaViews[betaDisplayMode] = { ...betaView };
    drawBeta();
  });
  betaAutocenterViewButton.addEventListener("click", autoCenterBetaView);
  betaAutocenterLockButton.addEventListener("click", () => {
    setBetaAutoCenterLocked(!betaAutoCenterLocked);
  });
  betaDerivativeButton.addEventListener("click", () => {
    selectBetaDisplay(betaDisplayMode === "derivative" ? "value" : "derivative");
  });
  phaseSvg.addEventListener("wheel", (event) => {
    event.preventDefault();
    const plot = { left: 64, right: 625, top: 15, bottom: 314 };
    const pointer = pointerFractions(event, phaseSvg, plot, 640, 352);
    const factor = wheelFactor(event.deltaY);
    const oldXSpan = phaseView.xMax - phaseView.xMin;
    const oldYSpan = phaseView.yMax - phaseView.yMin;
    const x = phaseView.xMin + pointer.x * oldXSpan;
    const y = phaseView.yMax - pointer.y * oldYSpan;
    const xSpan = clamp(oldXSpan / factor, PHASE_MIN_X_SPAN, 1);
    const ySpan = (PHASE_WINDOW[1] - PHASE_WINDOW[0]) * xSpan;
    const [xMin, xMax] = boundedInterval(x - pointer.x * xSpan, xSpan, 0, 1);
    const [yMin, yMax] = boundedInterval(y - (1 - pointer.y) * ySpan, ySpan, PHASE_WINDOW[0], PHASE_WINDOW[1]);
    phaseView = { xMin, xMax, yMin, yMax };
    drawPhase();
  }, { passive: false });

  phaseSvg.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    phaseDrag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, view: { ...phaseView } };
    phaseSvg.dataset.dragging = "true";
    phaseSvg.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });
  phaseSvg.addEventListener("pointermove", (event) => {
    if (!phaseDrag || event.pointerId !== phaseDrag.pointerId) return;
    const bounds = phaseSvg.getBoundingClientRect();
    const xSpan = phaseDrag.view.xMax - phaseDrag.view.xMin;
    const ySpan = phaseDrag.view.yMax - phaseDrag.view.yMin;
    const xShift = ((event.clientX - phaseDrag.x) / bounds.width) * xSpan;
    const yShift = ((event.clientY - phaseDrag.y) / bounds.height) * ySpan;
    const [xMin, xMax] = boundedInterval(phaseDrag.view.xMin - xShift, xSpan, 0, 1);
    const [yMin, yMax] = boundedInterval(phaseDrag.view.yMin + yShift, ySpan, PHASE_WINDOW[0], PHASE_WINDOW[1]);
    phaseView = { xMin, xMax, yMin, yMax };
    drawPhase();
  });
  function endPhaseDrag(event) {
    if (!phaseDrag || event.pointerId !== phaseDrag.pointerId) return;
    phaseSvg.releasePointerCapture?.(event.pointerId);
    delete phaseSvg.dataset.dragging;
    phaseDrag = null;
  }
  phaseSvg.addEventListener("pointerup", endPhaseDrag);
  phaseSvg.addEventListener("pointercancel", endPhaseDrag);

  betaCanvas.addEventListener("wheel", (event) => {
    if (!betaData || !betaCanvas.dataset.plot) return;
    event.preventDefault();
    const plot = JSON.parse(betaCanvas.dataset.plot);
    const pointer = pointerFractions(event, betaCanvas, plot, plot.width, plot.height);
    const oldXSpan = betaView.xMax - betaView.xMin;
    const oldYSpan = betaView.yMax - betaView.yMin;
    const x = betaView.xMin + pointer.x * oldXSpan;
    const y = betaView.yMax - pointer.y * oldYSpan;
    const factor = wheelFactor(event.deltaY);
    const xSpan = clamp(oldXSpan / factor, BETA_MIN_X_SPAN, BETA_X_WINDOW[1] - BETA_X_WINDOW[0]);
    const yWindow = betaYWindow();
    const minYSpan = (yWindow[1] - yWindow[0]) / 64;
    const ySpan = clamp(oldYSpan / factor, minYSpan, yWindow[1] - yWindow[0]);
    const [xMin, xMax] = boundedInterval(x - pointer.x * xSpan, xSpan, BETA_X_WINDOW[0], BETA_X_WINDOW[1]);
    const [yMin, yMax] = boundedInterval(y - (1 - pointer.y) * ySpan, ySpan, yWindow[0], yWindow[1]);
    betaView = { xMin, xMax, yMin, yMax };
    betaViews[betaDisplayMode] = { ...betaView };
    drawBeta();
  }, { passive: false });

  betaCanvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !betaData) return;
    betaDrag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, view: { ...betaView } };
    betaCanvas.dataset.dragging = "true";
    betaCanvas.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });
  betaCanvas.addEventListener("pointermove", (event) => {
    if (!betaDrag || event.pointerId !== betaDrag.pointerId) return;
    const bounds = betaCanvas.getBoundingClientRect();
    const xSpan = betaDrag.view.xMax - betaDrag.view.xMin;
    const ySpan = betaDrag.view.yMax - betaDrag.view.yMin;
    const xShift = ((event.clientX - betaDrag.x) / bounds.width) * xSpan;
    const yShift = ((event.clientY - betaDrag.y) / bounds.height) * ySpan;
    const [xMin, xMax] = boundedInterval(betaDrag.view.xMin - xShift, xSpan, BETA_X_WINDOW[0], BETA_X_WINDOW[1]);
    const yWindow = betaYWindow();
    const [yMin, yMax] = boundedInterval(betaDrag.view.yMin + yShift, ySpan, yWindow[0], yWindow[1]);
    betaView = { xMin, xMax, yMin, yMax };
    betaViews[betaDisplayMode] = { ...betaView };
    drawBeta();
  });
  function endBetaDrag(event) {
    if (!betaDrag || event.pointerId !== betaDrag.pointerId) return;
    betaCanvas.releasePointerCapture?.(event.pointerId);
    delete betaCanvas.dataset.dragging;
    betaDrag = null;
  }
  betaCanvas.addEventListener("pointerup", endBetaDrag);
  betaCanvas.addEventListener("pointercancel", endBetaDrag);

  betaCanvas.addEventListener("mousemove", (event) => {
    const displayed = betaDisplayed || betaData;
    if (!displayed || !betaCanvas.dataset.plot) return;
    const plot = JSON.parse(betaCanvas.dataset.plot);
    const bounds = betaCanvas.getBoundingClientRect();
    const proportion = Math.max(0, Math.min(1, (event.clientX - bounds.left - plot.left) / (plot.right - plot.left)));
    const hoveredOmega = plot.xMin + proportion * (plot.xMax - plot.xMin);
    let index = 0;
    for (let candidate = 1; candidate < displayed.omega.length; candidate += 1) {
      if (Math.abs(displayed.omega[candidate] - hoveredOmega) < Math.abs(displayed.omega[index] - hoveredOmega)) index = candidate;
    }
    const omega = displayed.omega[index];
    if (betaDisplayMode === "derivative") {
      const segments = betaInterpolationSegments(displayed.omega, displayed.value);
      let interval = segments.length - 1;
      for (let candidate = 0; candidate < segments.length; candidate += 1) {
        if (hoveredOmega <= segments[candidate].end) {
          interval = candidate;
          break;
        }
      }
      const segment = segments[interval];
      const position = (hoveredOmega - segment.start) / segment.width;
      const quantity = betaDifferenceDerivativeAt(segment, position);
      betaReadout.textContent = "ω ∈ [" + segment.start.toFixed(4) + ", " + segment.end.toFixed(4) + "], ∂ω(βV − β0) = " + quantity.toFixed(6) + " (period " + displayed.period + ")";
    } else {
      const difference = displayed.value[index] - 0.5 * omega * omega;
      betaReadout.textContent = "ω = " + omega.toFixed(4) + ", βV − β0 = " + difference.toFixed(6) + " (period " + displayed.period + ")";
    }
  });
  betaCanvas.addEventListener("mouseleave", () => {
    betaReadout.textContent = betaDisplayMode === "derivative"
      ? "Dashes mark only robust local jump candidates, not every numerical interpolation knot. Scroll to zoom; drag to move the view."
      : "Colour runs from red at ω = −0.5, through plum, to deep blue at ω = 0.5. Scroll to zoom; drag to move the view.";
  });
  window.addEventListener("resize", () => {
    schedulePhase();
    drawBeta();
  });

  createModeRow(1);
  updateBetaDisplayButtons();
  setBetaAutoCenterLocked(true);
  refreshSuggestedMode();
  setAutomaticDecay(true);
  applyAutomaticDecay();
  setGlobalPlayback(false);
  updateDisplayRateOutput();
  updatePhaseReadout();
  displayPhaseResult(computePhaseData());
  scheduleBeta(true);
})();
