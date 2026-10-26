(() => {
  "use strict";

  const TWO_PI = 2 * Math.PI;
  const DEFAULT_ALPHA = 1.5;
  const DEFAULT_OPTIONS = { period: 32, minStarts: 6, maxStarts: 18, maxIterations: 420, alpha: DEFAULT_ALPHA };
  const CURVATURE_FLOOR = 1e-8;

  function computationOptions(options = {}) {
    const period = Number.isInteger(options.period) && options.period >= 4 && options.period % 2 === 0
      ? options.period
      : DEFAULT_OPTIONS.period;
    const minStarts = Number.isInteger(options.minStarts) && options.minStarts >= 1
      ? options.minStarts
      : DEFAULT_OPTIONS.minStarts;
    const maxStarts = Number.isInteger(options.maxStarts) && options.maxStarts >= minStarts
      ? options.maxStarts
      : DEFAULT_OPTIONS.maxStarts;
    const maxIterations = Number.isInteger(options.maxIterations) && options.maxIterations >= 20
      ? options.maxIterations
      : DEFAULT_OPTIONS.maxIterations;
    const alpha = Number.isFinite(options.alpha) ? Math.max(0, Math.min(4, options.alpha)) : DEFAULT_OPTIONS.alpha;
    return { period, minStarts, maxStarts, maxIterations, alpha };
  }

  function normaliseModes(entries) {
    const combined = new Map();
    for (const entry of entries || []) {
      const mode = Number(entry.mode);
      const value = Number(entry.value);
      if (!Number.isInteger(mode) || mode < 1 || !Number.isFinite(value)) continue;
      combined.set(mode, (combined.get(mode) || 0) + value);
    }
    return [...combined]
      .filter(([, value]) => Math.abs(value) > 1e-14)
      .sort(([left], [right]) => left - right)
      .map(([mode, value]) => ({ mode, value }));
  }

  function potential(x, modes, alpha = DEFAULT_ALPHA) {
    let value = 0;
    for (const term of modes) {
      const scale = TWO_PI * term.mode;
      value -= term.value * Math.cos(scale * x) / (scale ** alpha);
    }
    return value;
  }

  function force(x, modes, alpha = DEFAULT_ALPHA) {
    let value = 0;
    for (const term of modes) {
      const scale = TWO_PI * term.mode;
      value += term.value * Math.sin(scale * x) * (scale ** (1 - alpha));
    }
    return value;
  }

  function potentialCurvature(x, modes, alpha = DEFAULT_ALPHA) {
    let value = 0;
    for (const term of modes) {
      const scale = TWO_PI * term.mode;
      value += term.value * (scale ** (2 - alpha)) * Math.cos(scale * x);
    }
    return value;
  }

  function curvatureBound(modes, alpha) {
    return modes.reduce((total, term) => total + Math.abs(term.value) * ((TWO_PI * term.mode) ** (2 - alpha)), 0);
  }

  function actionAndGradient(x, numerator, modes, options) {
    const period = x.length;
    const gradient = new Array(period);
    let action = 0;
    let residual = 0;

    for (let index = 0; index < period; index += 1) {
      const previous = index === 0 ? x[period - 1] - numerator : x[index - 1];
      const following = index === period - 1 ? x[0] + numerator : x[index + 1];
      const leftDifference = x[index] - previous;
      const rightDifference = following - x[index];
      action += 0.5 * rightDifference * rightDifference + potential(x[index], modes, options.alpha);
      const derivative = leftDifference - rightDifference + force(x[index], modes, options.alpha);
      gradient[index] = derivative;
      residual = Math.max(residual, Math.abs(derivative));
    }
    return { action, gradient, residual };
  }

  function descend(initial, numerator, modes, options) {
    let x = initial.slice();
    let state = actionAndGradient(x, numerator, modes, options);
    let step = Math.min(0.16, 0.32 / (2 + curvatureBound(modes, options.alpha)));

    for (let iteration = 0; iteration < options.maxIterations; iteration += 1) {
      if (state.residual < 1e-8) break;
      let localStep = step;
      let accepted = false;
      for (let trial = 0; trial < 22; trial += 1) {
        const candidate = x.map((value, index) => value - localStep * state.gradient[index]);
        const candidateState = actionAndGradient(candidate, numerator, modes, options);
        if (candidateState.action < state.action - 1e-14) {
          x = candidate;
          state = candidateState;
          step = Math.min(localStep * 1.12, 0.2);
          accepted = true;
          break;
        }
        localStep *= 0.5;
      }
      if (!accepted) break;
    }
    return state;
  }

  function minimumPotential(modes, options) {
    const highestMode = modes.reduce((maximum, term) => Math.max(maximum, term.mode), 1);
    const samples = Math.min(8192, Math.max(1024, highestMode * 512));
    let x = 0;
    let best = Infinity;
    for (let index = 0; index < samples; index += 1) {
      const candidate = index / samples;
      const value = potential(candidate, modes, options.alpha);
      if (value < best) {
        best = value;
        x = candidate;
      }
    }

    for (let iteration = 0; iteration < 20; iteration += 1) {
      const curvature = potentialCurvature(x, modes, options.alpha);
      if (Math.abs(curvature) < 1e-10) break;
      let damping = 1;
      let improved = false;
      for (let trial = 0; trial < 16; trial += 1) {
        const candidate = x - damping * force(x, modes, options.alpha) / curvature;
        const value = potential(candidate, modes, options.alpha);
        if (value < best) {
          x = candidate;
          best = value;
          improved = true;
          break;
        }
        damping *= 0.5;
      }
      if (!improved) break;
    }
    return best;
  }

  function minimiseAction(numerator, modes, options) {
    if (modes.length === 0) {
      const omega = numerator / options.period;
      return 0.5 * omega * omega;
    }
    if (numerator === 0) return minimumPotential(modes, options);

    const highestMode = modes.reduce((maximum, term) => Math.max(maximum, term.mode), 1);
    const starts = Math.min(options.maxStarts, Math.max(options.minStarts, 2 * highestMode + 2));
    let best = Infinity;
    let bestResidual = Infinity;

    for (let seed = 0; seed < starts; seed += 1) {
      const shift = seed / starts;
      const initial = Array.from({ length: options.period }, (_, index) => (
        index * numerator / options.period
        + shift
        + 0.025 * Math.sin(TWO_PI * (index / options.period + seed / (3 * starts)))
      ));
      const result = descend(initial, numerator, modes, options);
      if (
        (result.residual < 1e-5 && result.action < best)
        || (!Number.isFinite(best) && result.residual < bestResidual)
      ) {
        best = result.action;
        bestResidual = result.residual;
      }
    }

    if (!Number.isFinite(best)) {
      throw new Error("The finite-period minimisation did not settle for p = " + numerator + ".");
    }
    return best / options.period;
  }

  function solveLinearSystem(matrix, rightHandSide) {
    const size = rightHandSide.length;
    const augmented = matrix.map((row, index) => [...row, rightHandSide[index]]);
    for (let column = 0; column < size; column += 1) {
      let pivot = column;
      for (let row = column + 1; row < size; row += 1) {
        if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
      }
      if (Math.abs(augmented[pivot][column]) < 1e-12) return null;
      [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
      for (let row = column + 1; row < size; row += 1) {
        const factor = augmented[row][column] / augmented[column][column];
        for (let entry = column; entry <= size; entry += 1) {
          augmented[row][entry] -= factor * augmented[column][entry];
        }
      }
    }
    const result = new Array(size).fill(0);
    for (let row = size - 1; row >= 0; row -= 1) {
      let value = augmented[row][size];
      for (let column = row + 1; column < size; column += 1) value -= augmented[row][column] * result[column];
      result[row] = value / augmented[row][row];
    }
    return result;
  }

  function secondDifference(values, index) {
    return values[index] - 2 * values[index + 1] + values[index + 2];
  }

  function secondDifferenceGram(left, right) {
    const distance = Math.abs(left - right);
    if (distance === 0) return 6;
    if (distance === 1) return -4;
    if (distance === 2) return 1;
    return 0;
  }

  function monotoneSlopeFallback(values) {
    const slopes = values.slice(1).map((value, index) => value - values[index]);
    for (let index = 1; index < slopes.length; index += 1) {
      slopes[index] = Math.max(slopes[index], slopes[index - 1] + CURVATURE_FLOOR);
    }
    const fitted = [values[0]];
    for (const slope of slopes) fitted.push(fitted[fitted.length - 1] + slope);
    return fitted;
  }

  function strictlyConvexProjection(values) {
    const active = [];
    const count = values.length;
    for (let iteration = 0; iteration < 4 * count; iteration += 1) {
      let multipliers = [];
      while (active.length > 0) {
        const gram = active.map((left) => active.map((right) => secondDifferenceGram(left, right)));
        const rhs = active.map((index) => CURVATURE_FLOOR - secondDifference(values, index));
        multipliers = solveLinearSystem(gram, rhs);
        if (!multipliers) return monotoneSlopeFallback(values);
        const negative = multipliers.findIndex((value) => value < -1e-12);
        if (negative === -1) break;
        active.splice(negative, 1);
      }

      const fitted = values.slice();
      active.forEach((index, position) => {
        const multiplier = multipliers[position];
        fitted[index] += multiplier;
        fitted[index + 1] -= 2 * multiplier;
        fitted[index + 2] += multiplier;
      });
      let mostViolated = -1;
      for (let index = 0; index < count - 2; index += 1) {
        if (
          secondDifference(fitted, index) < CURVATURE_FLOOR - 1e-12
          && (mostViolated === -1 || secondDifference(fitted, index) < secondDifference(fitted, mostViolated))
        ) {
          mostViolated = index;
        }
      }
      if (mostViolated === -1) return fitted;
      if (active.includes(mostViolated)) return monotoneSlopeFallback(values);
      active.push(mostViolated);
      active.sort((left, right) => left - right);
    }
    return monotoneSlopeFallback(values);
  }

  function computeBeta(rawModes, rawOptions) {
    const modes = normaliseModes(rawModes);
    const options = computationOptions(rawOptions);
    const maxRotationNumerator = options.period / 2;
    const positive = new Map();
    for (let numerator = 0; numerator <= maxRotationNumerator; numerator += 1) {
      positive.set(numerator, minimiseAction(numerator, modes, options));
    }
    const omega = [];
    const raw = [];
    for (let numerator = -maxRotationNumerator; numerator <= maxRotationNumerator; numerator += 1) {
      omega.push(numerator / options.period);
      raw.push(positive.get(Math.abs(numerator)));
    }
    return {
      omega,
      raw,
      value: strictlyConvexProjection(raw),
      period: options.period,
      curvatureFloor: CURVATURE_FLOOR
    };
  }

  globalThis.StandardMapCore = {
    PERIOD: DEFAULT_OPTIONS.period,
    normaliseModes,
    potential,
    force,
    computeBeta,
    strictlyConvexProjection
  };
})();
