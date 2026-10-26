/* Exact finite-grid Gaussian simulation via the Cholesky factor of fBm increments. */
((root) => {
  "use strict";

  function incrementCovariance(h, lag) {
    const power = 2 * h;
    return 0.5 * (Math.pow(lag + 1, power) - 2 * Math.pow(lag, power) + Math.pow(Math.abs(lag - 1), power));
  }

  function factorIncrements(h, count, duration = 1) {
    if (!(h > 0 && h < 1) || !Number.isInteger(count) || count < 1 || !(Number.isFinite(duration) && duration > 0)) throw new RangeError("Invalid Hurst parameter, grid size, or duration.");
    const cov = Float64Array.from({ length: count }, (_, lag) => incrementCovariance(h, lag));
    const factor = [];
    for (let i = 0; i < count; i += 1) {
      const row = new Float64Array(i + 1);
      for (let j = 0; j <= i; j += 1) {
        let value = cov[i - j];
        for (let k = 0; k < j; k += 1) value -= row[k] * (i === j ? row[k] : factor[j][k]);
        if (i === j) {
          if (value <= 0) throw new Error("The covariance factorisation failed.");
          row[j] = Math.sqrt(value);
        } else {
          row[j] = value / factor[j][j];
        }
      }
      factor.push(row);
    }
    return { h, count, factor, scale: Math.pow(duration / count, h) };
  }

  function normalGenerator(random = Math.random) {
    let spare = null;
    return () => {
      if (spare !== null) { const result = spare; spare = null; return result; }
      let u = 0;
      while (u === 0) u = random();
      const radius = Math.sqrt(-2 * Math.log(u));
      const angle = 2 * Math.PI * random();
      spare = radius * Math.sin(angle);
      return radius * Math.cos(angle);
    };
  }

  function samplePath(model, normal = normalGenerator()) {
    const { count, factor, scale } = model;
    const normals = Float64Array.from({ length: count }, () => normal());
    const path = new Float64Array(count + 1);
    for (let i = 0; i < count; i += 1) {
      let increment = 0;
      for (let j = 0; j <= i; j += 1) increment += factor[i][j] * normals[j];
      path[i + 1] = path[i] + increment * scale;
    }
    return path;
  }

  function insideTube(path, reference, epsilon) {
    if (path.length !== reference.length) throw new RangeError("Paths must use the same grid.");
    for (let i = 0; i < path.length; i += 1) {
      if (Math.abs(path[i] - reference[i]) > epsilon) return false;
    }
    return true;
  }

  function graphValue(hits, count, epsilon) {
    if (!(epsilon > 0 && epsilon < 1) || !Number.isInteger(count) || count < 2 || !Number.isInteger(hits) || hits < 0 || hits > count) return null;
    const proportion = hits / count;
    if (!(proportion > 0 && proportion < 1)) return null;
    return Math.log(-Math.log(proportion)) / -Math.log(epsilon);
  }

  // log P(sup_{0 <= s <= duration} |X_s| <= radius) for a Brownian bridge
  // pinned at zero at both endpoints. The two theta-series forms avoid
  // cancellation respectively for small and large radius / sqrt(duration).
  function brownianBridgeLogSurvival(radius, duration) {
    if (!(radius > 0) || !(duration > 0)) throw new RangeError("Invalid bridge radius or duration.");
    const x = radius / Math.sqrt(duration);
    if (x < 1) {
      const scale = Math.PI * Math.PI / (8 * x * x);
      let relativeSum = 1;
      for (let k = 2; k < 10000; k += 1) {
        const exponent = -(((2 * k - 1) ** 2 - 1) * scale);
        if (exponent < -40) break;
        relativeSum += Math.exp(exponent);
      }
      return 0.5 * Math.log(2 * Math.PI) - Math.log(x) - scale + Math.log(relativeSum);
    }
    const scale = 2 * x * x;
    let tail = 0;
    for (let k = 1; k < 10000; k += 1) {
      const term = 2 * Math.exp(-scale * k * k);
      tail += k % 2 ? term : -term;
      if (term < 1e-16) break;
    }
    if (!(tail >= 0 && tail < 1)) throw new Error("Brownian bridge survival calculation lost precision.");
    return Math.log1p(-tail);
  }

  // Gauss-Legendre integration of the one-step Brownian transition kernels.
  // This computes a finite-time-grid tube probability, not the continuous one.
  function brownianTubeQuadrature(reference, epsilon, duration, order) {
    if (!reference || reference.length < 2 || reference[0] !== 0 || !Array.from(reference).every(Number.isFinite) ||
        !(epsilon > 0) || !(duration > 0) || !Number.isInteger(order) || order < 2) throw new RangeError("Invalid Brownian quadrature parameters.");
    const nodes = new Float64Array(order); const logWeights = new Float64Array(order);
    for (let i = 0; i < Math.ceil(order / 2); i += 1) {
      let z = Math.cos(Math.PI * (i + 0.75) / (order + 0.5)); let derivative = 0;
      for (let iter = 0; iter < 100; iter += 1) {
        let p = 1; let previous = 0;
        for (let j = 1; j <= order; j += 1) { const next = ((2 * j - 1) * z * p - (j - 1) * previous) / j; previous = p; p = next; }
        derivative = order * (z * p - previous) / (z * z - 1);
        const nextZ = z - p / derivative;
        if (Math.abs(nextZ - z) < 1e-15) { z = nextZ; break; }
        z = nextZ;
        if (iter === 99) throw new Error("Quadrature nodes did not converge.");
      }
      const weight = 2 * epsilon / ((1 - z * z) * derivative * derivative);
      nodes[i] = -epsilon * z; nodes[order - 1 - i] = epsilon * z;
      logWeights[i] = Math.log(weight); logWeights[order - 1 - i] = Math.log(weight);
    }
    const variance = duration / (reference.length - 1);
    const logConstant = -0.5 * Math.log(2 * Math.PI * variance);
    let logMass = new Float64Array(order); let step = 0; let logTotal = 0;
    const terms = new Float64Array(order);
    function normalise(values) {
      let max = -Infinity;
      for (const value of values) max = Math.max(max, value);
      if (!Number.isFinite(max)) throw new Error("Quadrature lost numerical precision.");
      let sum = 0;
      for (const value of values) sum += Math.exp(value - max);
      const normalizer = max + Math.log(sum);
      for (let i = 0; i < values.length; i += 1) values[i] -= normalizer;
      return normalizer;
    }
    return {
      advance(maxSteps = 16) {
        const end = Math.min(reference.length - 1, step + maxSteps);
        while (step < end) {
          step += 1;
          const next = new Float64Array(order);
          if (step === 1) {
            for (let i = 0; i < order; i += 1) { const d = nodes[i] + reference[1]; next[i] = logWeights[i] + logConstant - d * d / (2 * variance); }
          } else {
            const delta = reference[step] - reference[step - 1];
            for (let i = 0; i < order; i += 1) {
              let max = -Infinity;
              for (let j = 0; j < order; j += 1) {
                const d = nodes[i] - nodes[j] + delta;
                terms[j] = logMass[j] - d * d / (2 * variance);
                max = Math.max(max, terms[j]);
              }
              let sum = 0;
              for (let j = 0; j < order; j += 1) sum += Math.exp(terms[j] - max);
              next[i] = logWeights[i] + logConstant + max + Math.log(sum);
            }
          }
          logTotal += normalise(next); logMass = next;
        }
        return step === reference.length - 1;
      },
      result() {
        if (step !== reference.length - 1) throw new Error("Quadrature is incomplete.");
        return logTotal;
      }
    };
  }

  const api = { incrementCovariance, factorIncrements, normalGenerator, samplePath, insideTube, graphValue, brownianBridgeLogSurvival, brownianTubeQuadrature };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.FBmCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
