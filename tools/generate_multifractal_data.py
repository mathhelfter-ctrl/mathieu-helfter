#!/usr/bin/env python3
"""Generate static data for the infinite-dimensional multifractal module.

The model is K_gamma = {(n^-gamma epsilon_n): epsilon_n in {0,1}} in c_0,
equipped with the product measure having Bernoulli parameter p. The website only
displays the data tables written by this script.
"""

from __future__ import annotations

import json
import math
import random
from pathlib import Path

OUT_FILE = Path(__file__).resolve().parents[1] / "assets" / "data" / "infinite-fractals" / "data.json"
OUT_FILE.parent.mkdir(parents=True, exist_ok=True)

P_VALUES = [0.1, 0.125, 0.15, 0.175, 0.2, 0.225, 0.25, 0.275, 0.3, 0.325, 0.35, 0.375, 0.4, 0.425, 0.45, 0.475, 0.5]
GAMMA_VALUES = [0.5, 1, 1.5, 2]
N_VALUES = [4, 8, 12, 16, 24, 32, 48, 64]
SAMPLES = 192
PHI = (math.sqrt(5) - 1) / 2


def p_key(p: float) -> str:
    return f"{p:.3f}"


def gamma_key(gamma: float) -> str:
    return f"{gamma:.1f}"


def entropy(q: float) -> float:
    if q == 0 or q == 1:
        return 0.0
    return -q * math.log(q) - (1 - q) * math.log(1 - q)


def spectrum(p: float) -> dict[str, object]:
    if p == 0.5:
        point = math.log(2)
        return {"isPoint": True, "alpha": [point], "f": [point], "typical": [point, point]}

    alpha = []
    values = []
    for index in range(161):
        q = index / 160
        alpha.append(round(-q * math.log(p) - (1 - q) * math.log(1 - p), 8))
        values.append(round(entropy(q), 8))
    typical_q = p
    typical_alpha = -typical_q * math.log(p) - (1 - typical_q) * math.log(1 - p)
    return {
        "isPoint": False,
        "alpha": alpha,
        "f": values,
        "typical": [round(typical_alpha, 8), round(entropy(typical_q), 8)],
    }


def cloud_slices(p: float, gamma: float) -> dict[str, list[float]]:
    result = {str(n): [] for n in N_VALUES}
    max_n = max(N_VALUES)
    for sample in range(SAMPLES):
        seed = int(1_000_000 * p) + int(10_000 * gamma) + sample * 97
        rng = random.Random(seed)
        x_coordinate = 0.0
        y_coordinate = 0.0
        for n in range(1, max_n + 1):
            epsilon = 1 if rng.random() < p else 0
            amplitude = n ** (-gamma) * epsilon
            probe_weight = n ** (-2)
            x_coordinate += amplitude * probe_weight * math.cos(2 * math.pi * n * PHI)
            y_coordinate += amplitude * probe_weight * math.sin(2 * math.pi * n * PHI)
            if n in N_VALUES:
                result[str(n)].extend((round(x_coordinate, 7), round(y_coordinate, 7)))
    return result


clouds: dict[str, dict[str, dict[str, list[float]]]] = {}
for p in P_VALUES:
    p_data: dict[str, dict[str, list[float]]] = {}
    for gamma in GAMMA_VALUES:
        p_data[gamma_key(gamma)] = cloud_slices(p, gamma)
    clouds[p_key(p)] = p_data

summaries = {
    gamma_key(gamma): {
        str(n): {
            "radius": round((n + 1) ** (-gamma), 10),
            "cylinderLabel": f"2^{n}",
        }
        for n in N_VALUES
    }
    for gamma in GAMMA_VALUES
}

data = {
    "version": "0.1",
    "model": "K_gamma = {(n^-gamma epsilon_n)_n : epsilon_n in {0,1}} in c_0 with the sup norm",
    "measure": "mu_p = product_n (p delta_1 + (1-p) delta_0)",
    "projection": "Chosen finite-coordinate 2D linear image using n^-2 cos(2πnφ) and n^-2 sin(2πnφ), with φ=(sqrt(5)-1)/2.",
    "pValues": P_VALUES,
    "gammaValues": GAMMA_VALUES,
    "nValues": N_VALUES,
    "sampleCount": SAMPLES,
    "spectra": {p_key(p): spectrum(p) for p in P_VALUES},
    "summaries": summaries,
    "clouds": clouds,
}
OUT_FILE.write_text(json.dumps(data, separators=(",", ":")))
print(f"wrote {OUT_FILE}")
