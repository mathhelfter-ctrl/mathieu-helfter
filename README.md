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
    infinite-fractals.js
  data/
    standard-map/
    infinite-fractals/
tools/
  generate_standard_map_data.py
  generate_multifractal_data.py
```

Keep the existing `pp_mh.jpg` and `CV.pdf` in that same root folder. The home-page learning buttons now lead to working, data-driven modules.

Both modules load precomputed data only: changing a control redraws an already generated data slice rather than running an orbit calculation, variational minimisation, random sampling, or spectrum calculation in the visitor's browser. The generation scripts are included for provenance and later refinement; they require only Python's standard library.
