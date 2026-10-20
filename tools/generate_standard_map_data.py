#!/usr/bin/env python3
"""Generate static numerical data for standard-map.html.

The browser only reads these files and redraws plots. It never iterates the
standard map or solves the variational problem. The beta values are explicitly
finite-period numerical approximations, not certified values.
"""

from __future__ import annotations

import json
import math
import os
import argparse
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image


OUT_DIR = Path(__file__).resolve().parents[1] / "assets" / "data" / "standard-map"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# These ranges show the passage from visible KAM curves through resonant
# layers to clear breakup, without spending most of the slider in broad chaos.
# A 49 by 49 grid fits into 99 assets: one data file and one portrait sheet
# for each epsilon value, plus the manifest.
GRID_SIZE = 49
K_VALUES = [round(index * 0.32 / (GRID_SIZE - 1), 7) for index in range(GRID_SIZE)]
EPSILON_VALUES = [round(index * 0.024 / (GRID_SIZE - 1), 7) for index in range(GRID_SIZE)]
PERIOD = 32
P_VALUES = list(range(-PERIOD // 2, PERIOD // 2 + 1))
TWO_PI = 2 * math.pi
SOLVER_TOLERANCE = 1e-7
# The numerical minimisation is carried out independently at each sampled
# rotation number. This small positive floor makes the displayed discrete
# curve strictly convex while moving it as little as possible in L2.
STRICT_CONVEX_CURVATURE = 1e-8

# Phase portraits follow one fixed vertical section, as in the original
# five-panel renderer. They are rasterised once into static image sheets.
PHASE_ITERATIONS = 6_000
PHASE_TOTAL_CURVES = 64
PHASE_OUTER_SEED = 0.30
PHASE_R_MIN = -0.30
PHASE_R_MAX = 0.30
PHASE_PANEL_WIDTH = 512
PHASE_PANEL_HEIGHT = 512
PHASE_SPRITE_COLUMNS = 7
PHASE_COLOURS = np.array(
    (
        (196, 39, 69),
        (170, 35, 80),
        (106, 36, 91),
        (68, 39, 95),
        (27, 55, 133),
    ),
    dtype=np.uint8,
)


def rounded(value: float, digits: int = 7) -> float:
    return round(value, digits)


def potential_scale(k: float) -> float:
    return k / TWO_PI


def high_frequency_potential_scale(epsilon: float) -> float:
    return epsilon / (10 * math.pi)


def action_and_gradient(x: list[float], p: int, k: float, epsilon: float) -> tuple[float, list[float], float]:
    q = len(x)
    gradient = [0.0] * q
    action = 0.0
    max_gradient = 0.0
    force_scale = k
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


def second_difference(values: list[float], index: int) -> float:
    return values[index] - 2 * values[index + 1] + values[index + 2]


def second_difference_gram(left: int, right: int) -> float:
    """Inner product of two consecutive-second-difference rows."""
    left_row = {left: 1.0, left + 1: -2.0, left + 2: 1.0}
    right_row = {right: 1.0, right + 1: -2.0, right + 2: 1.0}
    return sum(left_row.get(index, 0.0) * right_row.get(index, 0.0) for index in left_row)


def strictly_convex_projection(values: list[float]) -> list[float]:
    """Return the closest sampled curve with a positive second difference.

    This is the Euclidean projection onto
    ``value[i] - 2 value[i + 1] + value[i + 2] >= STRICT_CONVEX_CURVATURE``.
    The small positive lower bound gives a concrete, closed version of
    "strictly convex", for which a closest point exists.
    """
    active: list[int] = []
    count = len(values)

    for _ in range(4 * count):
        while active:
            gram = [[second_difference_gram(left, right) for right in active] for left in active]
            rhs = [STRICT_CONVEX_CURVATURE - second_difference(values, index) for index in active]
            multipliers = solve_linear_system(gram, rhs)
            if multipliers is None:
                raise RuntimeError("The strictly convex fitting system became singular.")
            negative = [position for position, multiplier in enumerate(multipliers) if multiplier < -1e-12]
            if not negative:
                break
            del active[negative[0]]

        fitted = values[:]
        if active:
            for index, multiplier in zip(active, multipliers):
                fitted[index] += multiplier
                fitted[index + 1] -= 2 * multiplier
                fitted[index + 2] += multiplier

        violated = [
            index
            for index in range(count - 2)
            if second_difference(fitted, index) < STRICT_CONVEX_CURVATURE - 1e-12
        ]
        if not violated:
            return fitted

        most_violated = min(violated, key=lambda index: second_difference(fitted, index))
        if most_violated in active:
            raise RuntimeError("The strictly convex fitting system did not converge.")
        active.append(most_violated)
        active.sort()

    raise RuntimeError("The strictly convex fitting system exceeded its iteration limit.")


def newton_refine(x: list[float], p: int, k: float, epsilon: float) -> tuple[list[float], float, list[float], float]:
    """Refine a descent result without relaxing the action-minimising criterion."""
    action, gradient, residual = action_and_gradient(x, p, k, epsilon)
    q = len(x)
    for _ in range(35):
        if residual < 1e-10:
            break
        hessian = [[0.0] * q for _ in range(q)]
        for i in range(q):
            hessian[i][i] = 2 + TWO_PI * k * math.cos(TWO_PI * x[i]) + 5 * TWO_PI * epsilon * math.cos(5 * TWO_PI * x[i])
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


def continue_descent(
    x: list[float],
    action: float,
    gradient: list[float],
    residual: float,
    p: int,
    k: float,
    epsilon: float,
) -> tuple[list[float], float, list[float], float]:
    """Resolve an exceptional near-flat direction before exporting a value."""
    step = 0.2
    for _ in range(100_000):
        if residual < SOLVER_TOLERANCE:
            break
        accepted = False
        local_step = step
        for _ in range(30):
            candidate = [value - local_step * derivative for value, derivative in zip(x, gradient)]
            candidate_action, candidate_gradient, candidate_residual = action_and_gradient(candidate, p, k, epsilon)
            if candidate_action < action:
                x = candidate
                action = candidate_action
                gradient = candidate_gradient
                residual = candidate_residual
                step = min(local_step * 1.1, 0.2)
                accepted = True
                break
            local_step *= 0.5
        if not accepted:
            break
    return x, action, gradient, residual


def minimise_action_reference(p: int, k: float, epsilon: float) -> tuple[float, float]:
    """Reference implementation of the finite-period minimisation."""
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
        if residual > SOLVER_TOLERANCE:
            x, action, gradient, residual = continue_descent(x, action, gradient, residual, p, k, epsilon)
            x, action, gradient, residual = newton_refine(x, p, k, epsilon)
        if residual <= SOLVER_TOLERANCE and action < best_action:
            best_action = action
            best_residual = residual

    if not math.isfinite(best_action):
        raise RuntimeError(
            f"No residual-qualified minimiser for p={p}, K={k}, epsilon={epsilon}; "
            f"best residual was {best_residual:.3e}."
        )
    return best_action / PERIOD, best_residual


def array_action_and_gradient(
    x: np.ndarray,
    p: int,
    k: float,
    epsilon: float,
) -> tuple[float, np.ndarray, float]:
    """Vectorised action and gradient for the same finite-period problem."""
    following = np.roll(x, -1)
    following[-1] += p
    previous = np.roll(x, 1)
    previous[0] -= p
    difference = following - x
    angle = TWO_PI * x
    action = float(
        np.sum(
            0.5 * difference * difference
            - potential_scale(k) * np.cos(angle)
            - high_frequency_potential_scale(epsilon) * np.cos(5 * angle)
        )
    )
    gradient = (
        x - previous - difference
        + k * np.sin(angle)
        + epsilon * np.sin(5 * angle)
    )
    return action, gradient, float(np.max(np.abs(gradient)))


def vectorised_newton_minimum(
    initial: np.ndarray,
    p: int,
    k: float,
    epsilon: float,
) -> tuple[np.ndarray, float, float]:
    """Damped Newton descent using the exact cyclic Hessian."""
    x = initial.copy()
    action, gradient, residual = array_action_and_gradient(x, p, k, epsilon)
    q = len(x)
    for _ in range(80):
        if residual <= SOLVER_TOLERANCE:
            break
        angle = TWO_PI * x
        hessian = np.zeros((q, q), dtype=np.float64)
        hessian[np.arange(q), np.arange(q)] = (
            2
            + TWO_PI * k * np.cos(angle)
            + 5 * TWO_PI * epsilon * np.cos(5 * angle)
        )
        hessian[np.arange(q), np.roll(np.arange(q), 1)] = -1
        hessian[np.arange(q), np.roll(np.arange(q), -1)] = -1
        try:
            direction = np.linalg.solve(hessian, -gradient)
        except np.linalg.LinAlgError:
            direction = -gradient
        if float(np.dot(gradient, direction)) >= -1e-14:
            direction = -gradient

        accepted = False
        damping = 1.0
        for _ in range(24):
            candidate = x + damping * direction
            candidate_action, candidate_gradient, candidate_residual = array_action_and_gradient(
                candidate,
                p,
                k,
                epsilon,
            )
            if candidate_action < action:
                x, action, gradient, residual = candidate, candidate_action, candidate_gradient, candidate_residual
                accepted = True
                break
            damping *= 0.5
        if not accepted:
            break
    return x, action, residual


def minimise_action(p: int, k: float, epsilon: float) -> tuple[float, float]:
    """Multi-start, vectorised minimisation of the finite-period action."""
    if k == 0 and epsilon == 0:
        omega = p / PERIOD
        return 0.5 * omega * omega, 0.0
    if p == 0:
        return -potential_scale(k) - high_frequency_potential_scale(epsilon), 0.0

    starts = 10
    indices = np.arange(PERIOD, dtype=np.float64)
    best_action = float("inf")
    best_residual = float("inf")
    for seed in range(starts):
        x = (
            indices * p / PERIOD
            + seed / starts
            + 0.04 * np.sin(TWO_PI * (indices / PERIOD + seed / (starts * 3)))
        )
        _, action, residual = vectorised_newton_minimum(x, p, k, epsilon)
        if residual <= SOLVER_TOLERANCE and action < best_action:
            best_action = action
            best_residual = residual

    if not math.isfinite(best_action):
        # Preserve the reference implementation as a conservative fallback for
        # an exceptional parameter value where Newton did not settle.
        return minimise_action_reference(p, k, epsilon)
    return best_action / PERIOD, best_residual


def phase_palette(count: int) -> np.ndarray:
    """Red through plum to deep blue, indexed by the starting momentum."""
    positions = np.linspace(0, 1, count)
    colour_positions = np.linspace(0, 1, len(PHASE_COLOURS))
    return np.column_stack(
        [np.interp(positions, colour_positions, PHASE_COLOURS[:, channel]) for channel in range(3)]
    ).astype(np.uint8)


def rasterize_phase_panel(k: float, epsilon: float) -> Image.Image:
    """Render a dense KAM portrait from one uniform family of initial points."""
    theta = np.full(PHASE_TOTAL_CURVES, 0.5, dtype=np.float64)
    r = np.linspace(-PHASE_OUTER_SEED, PHASE_OUTER_SEED, PHASE_TOTAL_CURVES)
    theta_history = np.empty((PHASE_ITERATIONS, PHASE_TOTAL_CURVES), dtype=np.float32)
    r_history = np.empty((PHASE_ITERATIONS, PHASE_TOTAL_CURVES), dtype=np.float32)

    for iteration in range(PHASE_ITERATIONS):
        force = k * np.sin(TWO_PI * theta) + epsilon * np.sin(5 * TWO_PI * theta)
        theta = np.mod(theta + r + force, 1.0)
        r += force
        theta_history[iteration] = theta
        r_history[iteration] = r

    canvas = np.full((PHASE_PANEL_HEIGHT, PHASE_PANEL_WIDTH, 3), 255, dtype=np.uint8)
    visible = (r_history >= PHASE_R_MIN) & (r_history <= PHASE_R_MAX)
    theta_visible = theta_history[visible]
    r_visible = r_history[visible]
    colour_history = np.broadcast_to(
        phase_palette(PHASE_TOTAL_CURVES), (PHASE_ITERATIONS, PHASE_TOTAL_CURVES, 3)
    )[visible]

    columns = np.floor(theta_visible * PHASE_PANEL_WIDTH).astype(np.int64) % PHASE_PANEL_WIDTH
    rows = PHASE_PANEL_HEIGHT - 1 - np.floor(
        (r_visible - PHASE_R_MIN) / (PHASE_R_MAX - PHASE_R_MIN) * PHASE_PANEL_HEIGHT
    ).astype(np.int64)
    rows = np.clip(rows, 0, PHASE_PANEL_HEIGHT - 1)

    # A 3-by-3 subpixel stamp gives the same dense, point-based look as the
    # former shader-style renderer without joining across the cylinder seam.
    for dx in (-1, 0, 1):
        stamped_columns = (columns + dx) % PHASE_PANEL_WIDTH
        for dy in (-1, 0, 1):
            stamped_rows = np.clip(rows + dy, 0, PHASE_PANEL_HEIGHT - 1)
            for channel in range(3):
                np.minimum.at(
                    canvas[:, :, channel],
                    (stamped_rows, stamped_columns),
                    colour_history[:, channel],
                )

    return Image.fromarray(canvas, "RGB")


def phase_sprite_filename(epsilon: float) -> str:
    return f"phase-e-{epsilon:.4f}.png"


def render_phase_sheet(epsilon: float) -> str:
    """Render all K-panels for one epsilon into one square sprite sheet."""
    rows = math.ceil(len(K_VALUES) / PHASE_SPRITE_COLUMNS)
    sheet = Image.new(
        "RGB",
        (PHASE_PANEL_WIDTH * PHASE_SPRITE_COLUMNS, PHASE_PANEL_HEIGHT * rows),
        "white",
    )
    for index, k in enumerate(K_VALUES):
        column = index % PHASE_SPRITE_COLUMNS
        row = index // PHASE_SPRITE_COLUMNS
        sheet.paste(
            rasterize_phase_panel(k, epsilon),
            (column * PHASE_PANEL_WIDTH, row * PHASE_PANEL_HEIGHT),
        )
    filename = phase_sprite_filename(epsilon)
    # The drawings contain a fixed, small palette.  Palette PNG preserves the
    # appearance while keeping the 49-sheet collection practical to publish.
    sheet.quantize(colors=128, method=Image.Quantize.MEDIANCUT).save(
        OUT_DIR / filename,
        optimize=True,
    )
    return filename


def phase_metadata(sprite: str, index: int) -> dict[str, object]:
    return {
        "sprite": sprite,
        "spriteIndex": index,
        "spriteColumns": PHASE_SPRITE_COLUMNS,
        "spritePanelWidth": PHASE_PANEL_WIDTH,
        "spritePanelHeight": PHASE_PANEL_HEIGHT,
        "yWindow": [PHASE_R_MIN, PHASE_R_MAX],
        "iterations": PHASE_ITERATIONS,
        "trajectoryCount": PHASE_TOTAL_CURVES,
    }


def generate_epsilon_slice(epsilon: float) -> str:
    phase_sprite = render_phase_sheet(epsilon)
    slices: list[dict[str, object]] = []
    for k_index, k in enumerate(K_VALUES):
        result_by_abs_p = {abs(p): minimise_action(abs(p), k, epsilon) for p in P_VALUES}
        omega = [rounded(p / PERIOD, 8) for p in P_VALUES]
        raw_value = [rounded(result_by_abs_p[abs(p)][0], 9) for p in P_VALUES]
        value = [rounded(entry, 12) for entry in strictly_convex_projection(raw_value)]
        residual = [rounded(result_by_abs_p[abs(p)][1], 12) for p in P_VALUES]
        slices.append(
            {
                "k": k,
                "beta": {
                    "omega": omega,
                    "rawValue": raw_value,
                    "value": value,
                    "curvatureFloor": STRICT_CONVEX_CURVATURE,
                    "residual": residual,
                    "period": PERIOD,
                },
                "phase": phase_metadata(phase_sprite, k_index),
            }
        )
    data = {"epsilon": epsilon, "slices": slices}
    filename = OUT_DIR / f"e-{epsilon:.4f}.json"
    filename.write_text(json.dumps(data, separators=(",", ":")))
    return f"wrote {filename.name} and {phase_sprite}"

def write_manifest() -> None:
    manifest = {
        "version": "0.9",
        "formula": "y' = y + K sin(2πx) + epsilon sin(10πx), x' = x + y' mod 1",
        "generatingFunction": "S_(K,epsilon)(x,X) = 1/2 (X-x)^2 - K/(2π) cos(2πx) - epsilon/(10π) cos(10πx)",
        "kValues": K_VALUES,
        "epsilonValues": EPSILON_VALUES,
        "beta": {
            "period": PERIOD,
            "solverTolerance": SOLVER_TOLERANCE,
            "method": "Multi-start gradient descent for the finite-period action; smallest action retained.",
            "displayCurve": "Least-squares projection of the sampled values onto a strictly convex discrete curve.",
            "displayRange": [-0.06, 0.005],
            "curvatureFloor": STRICT_CONVEX_CURVATURE,
            "caveat": "Finite-period numerical approximation only; not a certification of Mather's beta function.",
        },
        "phase": {
            "method": "64 uniformly spaced initial conditions on theta=1/2, each drawn for 6000 iterates.",
            "caveat": "Finite iterates in a displayed y-window; visible curves are not proofs of KAM tori.",
        },
    }
    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate standard-map data and portraits.")
    parser.add_argument(
        "--epsilon",
        action="append",
        type=float,
        help="Generate only this epsilon row; may be supplied several times.",
    )
    parser.add_argument("--serial", action="store_true", help="Disable parallel row generation.")
    arguments = parser.parse_args()
    epsilon_values = arguments.epsilon or EPSILON_VALUES

    if arguments.epsilon or arguments.serial:
        for epsilon in epsilon_values:
            print(generate_epsilon_slice(epsilon))
    else:
        workers = min(8, os.cpu_count() or 1, len(epsilon_values))
        try:
            with ProcessPoolExecutor(max_workers=workers) as executor:
                for message in executor.map(generate_epsilon_slice, epsilon_values):
                    print(message)
        except PermissionError:
            print("Parallel workers unavailable; falling back to serial generation.")
            for epsilon in epsilon_values:
                print(generate_epsilon_slice(epsilon))
    write_manifest()


if __name__ == "__main__":
    main()
