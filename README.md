# Website files

Upload this complete folder to the root of the GitHub repository, replacing the existing `index.html` and preserving its directory structure:

```text
index.html
research.html
contact.html
standard-map.html
infinite-fractals.html
styles.css
assets/
  scripts/
    standard-map.js
    mathjax-config.js
    infinite-fractals.js
  data/
    standard-map/
    infinite-fractals/
tools/
  generate_standard_map_data.py
  generate_multifractal_data.py
```

Keep the existing `pp_mh.jpg` and `CV.pdf` in that same root folder. The home-page learning buttons now lead to working, data-driven modules.

Both modules load generated data: changing a control redraws an already generated data slice rather than running an orbit calculation, variational minimisation, random sampling, or spectrum calculation in the visitor's browser. The standard-map module uses 49 values of \(K\) from \(0\) to \(0.05\), and 49 values of \(\varepsilon\) from \(0\) to \(0.05\); its map is \(y'=y+K\sin(2\pi x)+\varepsilon\sin(10\pi x)\). Its 99 assets comprise 49 data files, 49 phase-portrait sheets, and one manifest. Each portrait uses 64 uniformly spaced initial conditions followed for 6,000 iterates. The site first fits a strictly convex numerical \(\beta_V\), then displays \(\beta_V-\omega^2/2\) on one fixed vertical scale. The standard-map generator requires NumPy and Pillow; install the packages listed in tools/requirements.txt before rerunning it.

Equations use MathJax. Write inline mathematics as `\( ... \)` and displayed mathematics as `\[ ... \]`; the pages load MathJax from its CDN when viewed online.
