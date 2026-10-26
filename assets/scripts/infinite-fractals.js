(() => {
  "use strict";

  const LN10 = Math.LN10;
  const DEFAULTS = { s: 1, p: 0.5, q: 0.5, u: 1.4 };
  const U_MIN = 0.4;
  const U_MAX = 2.5;
  const SAMPLE_COUNT = 100;
  const PREFIX_LENGTH = 60;

  const controls = {
    s: document.getElementById("metric-s"),
    p: document.getElementById("measure-p"),
    q: document.getElementById("centre-q"),
    u: document.getElementById("radius-u"),
    reset: document.getElementById("product-reset")
  };
  const outputs = {
    s: document.getElementById("metric-s-value"),
    p: document.getElementById("measure-p-value"),
    q: document.getElementById("centre-q-value"),
    u: document.getElementById("radius-u-value"),
    n: document.getElementById("stat-n"),
    negativeLog: document.getElementById("stat-negative-log"),
    log10Mass: document.getElementById("stat-log10-mass"),
    order: document.getElementById("stat-order"),
    target: document.getElementById("stat-target"),
    prefix: document.getElementById("prefix-visual"),
    prefixCaption: document.getElementById("prefix-caption"),
    typeReadout: document.getElementById("type-readout")
  };
  const massCanvas = document.getElementById("mass-canvas");
  const orderCanvas = document.getElementById("order-canvas");

  function parameters() {
    return {
      s: Number(controls.s.value),
      p: Number(controls.p.value),
      q: Number(controls.q.value),
      u: Number(controls.u.value)
    };
  }

  function entropy(q) {
    if (q <= 0 || q >= 1) return 0;
    return -q * Math.log(q) - (1 - q) * Math.log1p(-q);
  }

  function frozenCoordinates(s, u) {
    return Math.max(1, Math.floor(10 ** (u / s)));
  }

  function bitAt(position, q) {
    return Math.floor(position * q + 1e-10) - Math.floor((position - 1) * q + 1e-10);
  }

  function modelAt(params, u) {
    const n = frozenCoordinates(params.s, u);
    const ones = Math.floor(n * params.q + 1e-10);
    const logMass = ones * Math.log(params.p) + (n - ones) * Math.log1p(-params.p);
    const negativeLogMass = -logMass;
    const logEpsilon = -u * LN10;
    return {
      u,
      n,
      ones,
      logMass,
      negativeLogMass,
      log10Mass: logMass / LN10,
      order: Math.log(negativeLogMass) / (-logEpsilon),
      ordinaryDimensionProxy: logMass / logEpsilon,
      coefficient: negativeLogMass / n,
      asymptoticCoefficient: -params.q * Math.log(params.p) - (1 - params.q) * Math.log1p(-params.p)
    };
  }

  function fmt(value, digits = 2) {
    if (!Number.isFinite(value)) return "—";
    if (Math.abs(value) >= 1e4 || (Math.abs(value) > 0 && Math.abs(value) < 1e-3)) return value.toExponential(digits);
    return value.toFixed(digits);
  }

  function fmtInteger(value) {
    return new Intl.NumberFormat("en-GB").format(value);
  }

  function drawPrefix(params, current) {
    outputs.prefix.replaceChildren();
    const count = Math.min(PREFIX_LENGTH, current.n);
    const fragment = document.createDocumentFragment();
    for (let position = 1; position <= count; position += 1) {
      const bit = bitAt(position, params.q);
      const cell = document.createElement("span");
      cell.className = `prefix-bit ${bit ? "prefix-one" : "prefix-zero"}`;
      cell.textContent = String(bit);
      cell.setAttribute("aria-label", `coordinate ${position}: ${bit}`);
      fragment.append(cell);
    }
    if (current.n > count) {
      const ellipsis = document.createElement("span");
      ellipsis.className = "prefix-ellipsis";
      ellipsis.textContent = "…";
      fragment.append(ellipsis);
    }
    outputs.prefix.append(fragment);
    outputs.prefixCaption.textContent = current.n > count
      ? `The first ${count} of ${fmtInteger(current.n)} frozen coordinates are shown. In all, this prefix contains ${fmtInteger(current.ones)} ones.`
      : `All ${fmtInteger(current.n)} frozen coordinates are shown; ${fmtInteger(current.ones)} of them are ones.`;
  }

  function setCanvasSize(canvas) {
    const width = Math.max(300, Math.floor(canvas.clientWidth || 640));
    const height = Math.max(255, Math.floor(canvas.clientHeight || 330));
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    const context = canvas.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { context, width, height };
  }

  function numberLabel(value) {
    if (Math.abs(value) >= 10000) return value.toExponential(1);
    if (Math.abs(value) >= 100) return value.toFixed(0);
    if (Math.abs(value) >= 10) return value.toFixed(1);
    return value.toFixed(2);
  }

  function frame(context, width, height, xLabel, yLabel, yMin, yMax) {
    const plot = { left: 58, right: width - 18, top: 19, bottom: height - 48 };
    context.fillStyle = "#fffdf9";
    context.fillRect(0, 0, width, height);
    context.strokeStyle = "#d9d1d2";
    context.lineWidth = 1;
    context.strokeRect(plot.left, plot.top, plot.right - plot.left, plot.bottom - plot.top);
    context.font = "12px Figtree, Arial, sans-serif";
    context.fillStyle = "#625960";
    context.textAlign = "right";
    for (let index = 0; index <= 4; index += 1) {
      const fraction = index / 4;
      const y = plot.bottom - fraction * (plot.bottom - plot.top);
      const value = yMin + fraction * (yMax - yMin);
      context.strokeStyle = "rgba(217, 209, 210, 0.58)";
      context.beginPath();
      context.moveTo(plot.left, y);
      context.lineTo(plot.right, y);
      context.stroke();
      context.fillStyle = "#625960";
      context.fillText(numberLabel(value), plot.left - 8, y + 4);
    }
    context.textAlign = "center";
    context.fillText(xLabel, (plot.left + plot.right) / 2, height - 12);
    context.save();
    context.translate(15, (plot.top + plot.bottom) / 2);
    context.rotate(-Math.PI / 2);
    context.fillText(yLabel, 0, 0);
    context.restore();
    return plot;
  }

  function samples(params) {
    return Array.from({ length: SAMPLE_COUNT + 1 }, (_, index) => {
      const u = U_MIN + ((U_MAX - U_MIN) * index) / SAMPLE_COUNT;
      return modelAt(params, u);
    });
  }

  function xPixel(value, plot) {
    return plot.left + ((value - U_MIN) / (U_MAX - U_MIN)) * (plot.right - plot.left);
  }

  function line(context, values, plot, yMin, yMax, getY, colour) {
    const yPixel = (value) => plot.bottom - ((value - yMin) / (yMax - yMin)) * (plot.bottom - plot.top);
    context.strokeStyle = colour;
    context.lineWidth = 2.4;
    context.beginPath();
    values.forEach((entry, index) => {
      const method = index === 0 ? "moveTo" : "lineTo";
      context[method](xPixel(entry.u, plot), yPixel(getY(entry)));
    });
    context.stroke();
    return yPixel;
  }

  function dot(context, x, y, colour) {
    context.fillStyle = "#fffdf9";
    context.beginPath();
    context.arc(x, y, 5.3, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = colour;
    context.lineWidth = 2.4;
    context.beginPath();
    context.arc(x, y, 4.5, 0, Math.PI * 2);
    context.stroke();
  }

  function drawMass(params, current) {
    const values = samples(params);
    const yValues = values.map((entry) => -entry.log10Mass);
    const yMin = 0;
    const yMax = Math.max(1, ...yValues) * 1.08;
    const { context, width, height } = setCanvasSize(massCanvas);
    const plot = frame(context, width, height, "u = −log₁₀ ε", "−log₁₀ μₚ(B)", yMin, yMax);
    const yPixel = line(context, values, plot, yMin, yMax, (entry) => -entry.log10Mass, "#744155");
    dot(context, xPixel(current.u, plot), yPixel(-current.log10Mass), "#744155");
  }

  function drawOrder(params, current) {
    const values = samples(params);
    const yValues = values.map((entry) => entry.order);
    const target = 1 / params.s;
    const yMin = Math.min(-0.2, ...yValues, target) - 0.08;
    const yMax = Math.max(1, ...yValues, target) + 0.16;
    const { context, width, height } = setCanvasSize(orderCanvas);
    const plot = frame(context, width, height, "u = −log₁₀ ε", "log(−log μₚ(B)) / −log ε", yMin, yMax);
    const yPixel = (value) => plot.bottom - ((value - yMin) / (yMax - yMin)) * (plot.bottom - plot.top);
    context.strokeStyle = "#285b9b";
    context.lineWidth = 1.6;
    context.setLineDash([6, 5]);
    context.beginPath();
    context.moveTo(plot.left, yPixel(target));
    context.lineTo(plot.right, yPixel(target));
    context.stroke();
    context.setLineDash([]);
    line(context, values, plot, yMin, yMax, (entry) => entry.order, "#744155");
    dot(context, xPixel(current.u, plot), yPixel(current.order), "#744155");
    context.fillStyle = "#285b9b";
    context.font = "12px Figtree, Arial, sans-serif";
    context.textAlign = "right";
    context.fillText(`limit 1/s = ${target.toFixed(2)}`, plot.right - 5, yPixel(target) - 7);
  }

  function render() {
    const params = parameters();
    const current = modelAt(params, params.u);
    outputs.s.textContent = params.s.toFixed(2);
    outputs.p.textContent = params.p.toFixed(2);
    outputs.q.textContent = params.q.toFixed(2);
    outputs.u.textContent = params.u.toFixed(2);
    outputs.n.textContent = fmtInteger(current.n);
    outputs.negativeLog.textContent = fmt(current.negativeLogMass, 3);
    outputs.log10Mass.textContent = fmt(current.log10Mass, 3);
    outputs.order.textContent = fmt(current.order, 3);
    outputs.target.textContent = `1/s = ${(1 / params.s).toFixed(3)}`;
    drawPrefix(params, current);
    outputs.typeReadout.textContent = `For the selected centre type, Iₚ(q) = ${fmt(current.asymptoticCoefficient, 4)} and h(q) = ${fmt(entropy(params.q), 4)}. At the current scale the exact coefficient −log μₚ(B)/N is ${fmt(current.coefficient, 4)}; the small difference comes only from replacing qN by the integer ⌊qN⌋.`;
    drawMass(params, current);
    drawOrder(params, current);
  }

  Object.values(controls).forEach((control) => {
    if (control && control.type === "range") control.addEventListener("input", render);
  });
  controls.reset.addEventListener("click", () => {
    controls.s.value = String(DEFAULTS.s);
    controls.p.value = String(DEFAULTS.p);
    controls.q.value = String(DEFAULTS.q);
    controls.u.value = String(DEFAULTS.u);
    render();
  });
  window.addEventListener("resize", render);
  render();
})();
