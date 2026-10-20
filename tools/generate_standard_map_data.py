#!/usr/bin/env python3
"""Generate static numerical data for standard-map.html.

The browser only reads these files and redraws plots. It never iterates the
standard map or solves the variational problem. The beta values are explicitly
finite-period numerical approximations, not certified values.
"""

from __future__ import annotations

import json
import math
from pathlib import Path


OUT_DIR = Path(__file__).resolve().parents[1] / "assets" / "data" / "standard-map"
OUT_DIR.mkdir(parents=True, exist_ok=True)

K_VALUES = [0, 0.25, 0.5, 0.75, 0.9, 0.95, 0.97, 0.9716, 0.98, 1, 1.1, 1.25, 1.5, 2]
EPSILON_VALUES = [0, 0.025, 0.05, 0.075, 0.1]
PERIOD = 32
P_VALUES = list(range(-PERIOD // 2, PERIOD // 2 + 1))
TWO_PI = 2 * math.pi


def rounded(value: float, digits: int = 7) -> float:
    return round(value, digits)


def potential_scale(k: float) -> float:
    return k / (4 * math.pi * math.pi)


def high_frequency_potential_scale(epsilon: float) -> float:
    return epsilon / (10 * math.pi)


def action_and_gradient(x: list[float], p: int, k: float, epsilon: float) -> tuple[float, list[float], float]:
    q = len(x)
    gradient = [0.0] * q
    action = 0.0
    max_gradient = 0.0
    force_scale = k / TWO_PI
    potential = potential_scale(k)
    high_frequency_potential = high_frequency_potential_scale(epsilon)

    for i in range(q):
        previous = x[q - 1] - p if i == 0 else x[i - 1]
        following = x[0] + p if i == q - 1 else x[i + 1]
        left_difference = x[i] - previous
        right_difference = following - x[i]
        action += (
            0.5 * right_difference * right_difference
            - potential * math.cos(TWO_PI * x[i])
            - high_frequency_potential * math.cos(5 * TWO_PI * x[i])
        )
        value = (
            left_difference
            - right_difference
            + force_scale * math.sin(TWO_PI * x[i])
            + epsilon * math.sin(5 * TWO_PI * x[i])
        )
        gradient[i] = value
        max_gradient = max(max_gradient, abs(value))

    return action, gradient, max_gradient


def solve_linear_system(matrix: list[list[float]], rhs: list[float]) -> list[float] | None:
    """Gaussian elimination with pivoting; matrices are only 32 by 32 here."""
    n = len(rhs)
    augmented = [row[:] + [rhs[index]] for index, row in enumerate(matrix)]
    for column in range(n):
        pivot = max(range(column, n), key=lambda row: abs(augmented[row][column]))
        if abs(augmented[pivot][column]) < 1e-12:
            return None
        augmented[column], augmented[pivot] = augmented[pivot], augmented[column]
        pivot_value = augmented[column][column]
        for row in range(column + 1, n):
            factor = augmented[row][column] / pivot_value
            for entry in range(column, n + 1):
                augmented[row][entry] -= factor * augmented[column][entry]

    result = [0.0] * n
    for row in range(n - 1, -1, -1):
        value = augmented[row][n]
        for column in range(row + 1, n):
            value -= augmented[row][column] * result[column]
        result[row] = value / augmented[row][row]
    return result


def newton_refine(x: list[float], p: int, k: float, epsilon: float) -> tuple[list[float], float, list[float], float]:
    """Refine a descent result without relaxing the action-minimising criterion."""
    action, gradient, residual = action_and_gradient(x, p, k, epsilon)
    q = len(x)
    for _ in range(35):
        if residual < 1e-10:
            break
        hessian = [[0.0] * q for _ in range(q)]
        for i in range(q):
            hessian[i][i] = 2 + k * math.cos(TWO_PI * x[i]) + 5 * TWO_PI * epsilon * math.cos(5 * TWO_PI * x[i])
            hessian[i][(i - 1) % q] = -1
            hessian[i][(i + 1) % q] = -1
        direction = solve_linear_system(hessian, [-value for value in gradient])
        if direction is None:
            break
        directional_derivative = sum(left * right for left, right in zip(gradient, direction))
        if directional_derivative >= 0:
            break
        damping = 1.0
        accepted = False
        for _ in range(24):
            candidate = [value + damping * delta for value, delta in zip(x, direction)]
            candidate_action, candidate_gradient, candidate_residual = action_and_gradient(candidate, p, k, epsilon)
            if candidate_action < action:
                x, action, gradient, residual = candidate, candidate_action, candidate_gradient, candidate_residual
                accepted = True
                break
            damping *= 0.5
        if not accepted:
            break
    return x, action, gradient, residual


def minimise_action(p: int, k: float, epsilon: float) -> tuple[float, float]:
    """Multi-start gradient descent for the finite-period discrete action."""
    if k == 0 and epsilon == 0:
        omega = p / PERIOD
        return 0.5 * omega * omega, 0.0
    if p == 0 and epsilon >= 0:
        return -potential_scale(k) - high_frequency_potential_scale(epsilon), 0.0

    starts = 10
    best_action = float("inf")
    best_residual = float("inf")
    for seed in range(starts):
        shift = seed / starts
        x = [
            i * p / PERIOD
            + shift
            + 0.04 * math.sin(TWO_PI * (i / PERIOD + seed / (starts * 3)))
            for i in range(PERIOD)
        ]
        action, gradient, residual = action_and_gradient(x, p, k, epsilon)
        step = 0.16

        for _ in range(600):
            if residual < 1e-9:
                break
            accepted = False
            local_step = step
            for _ in range(24):
                candidate = [value - local_step * derivative for value, derivative in zip(x, gradient)]
                candidate_action, candidate_gradient, candidate_residual = action_and_gradient(candidate, p, k, epsilon)
                if candidate_action < action:
                    x = candidate
                    action = candidate_action
                    gradient = candidate_gradient
                    residual = candidate_residual
                    step = min(local_step * 1.15, 0.2)
                    accepted = True
                    break
                local_step *= 0.5
            if not accepted:
                break

        x, action, gradient, residual = newton_refine(x, p, k, epsilon)
        if action < best_action:
            best_action = action
            best_residual = residual

    return best_action / PERIOD, best_residual


def phase_portrait(k: float, epsilon: float) -> dict[str, object]:
    points: list[float] = []
    y_window = [-1.25, 1.25]
    x_seeds = 10
    y_seeds = [-0.6, -0.3, 0, 0.3, 0.6]
    transient = 50
    displayed_iterations = 220

    for x_index in range(x_seeds):
        for initial_y in y_seeds:
            x = (x_index + 0.5) / x_seeds
            y = initial_y
            for n in range(transient + displayed_iterations):
                y += (k / TWO_PI) * math.sin(TWO_PI * x) + epsilon * math.sin(5 * TWO_PI * x)
                x %= 1
                x = (x + y) % 1
                if n >= transient and y_window[0] <= y <= y_window[1]:
                    points.extend((rounded(x, 6), rounded(y, 6)))

    return {
        "points": points,
        "yWindow": y_window,
        "transient": transient,
        "displayedIterations": displayed_iterations,
        "seedCount": x_seeds * len(y_seeds),
    }


for epsilon in EPSILON_VALUES:
    for k in K_VALUES:
        result_by_abs_p = {abs(p): minimise_action(abs(p), k, epsilon) for p in P_VALUES}
        omega = [rounded(p / PERIOD, 8) for p in P_VALUES]
        value = [rounded(result_by_abs_p[abs(p)][0], 9) for p in P_VALUES]
        residual = [rounded(result_by_abs_p[abs(p)][1], 12) for p in P_VALUES]
        data = {
            "k": k,
            "epsilon": epsilon,
            "beta": {"omega": omega, "value": value, "residual": residual, "period": PERIOD},
            "phase": phase_portrait(k, epsilon),
        }
        filename = OUT_DIR / f"k-{k:.4f}-e-{epsilon:.4f}.json"
        filename.write_text(json.dumps(data, separators=(",", ":")))
        print(f"wrote {filename.name}")

manifest = {
    "version": "0.1",
  "formula": "y' = y + K/(2π) sin(2πx) + epsilon sin(10πx), x' = x + y' mod 1",
  "generatingFunction": "S_(K,epsilon)(x,X) = 1/2 (X-x)^2 - K/(4π²) cos(2πx) - epsilon/(10π) cos(10πx)",
  "kValues": K_VALUES,
  "epsilonValues": EPSILON_VALUES,
    "beta": {
        "period": PERIOD,
        "method": "Multi-start gradient descent for the finite-period action; smallest action retained.",
        "caveat": "Finite-period numerical approximation only; not a certification of Mather's beta function.",
    },
    "phase": {
        "caveat": "Finite iterates of fixed seeds in a displayed y-window; visible curves are not proofs of KAM tori.",
    },
}
(OUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
