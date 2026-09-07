---
description: "Keep hand-authored source cohesive and structural exceptions explicit."
paths:
  - "apps/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts,css,py}"
  - "packages/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts,css,py}"
  - "runtime/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts,css,py}"
  - "scripts/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts,css,py}"
  - "test/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts,css,py}"
  - "tooling/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts,css,py}"
globs:
  - "apps/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts,css,py}"
  - "packages/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts,css,py}"
  - "runtime/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts,css,py}"
  - "scripts/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts,css,py}"
  - "test/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts,css,py}"
  - "tooling/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts,css,py}"
---

# Source structure

Keep a hand-authored production file within 400 lines and a test file within
600 lines. Split by ownership rather than moving unrelated helpers into a
generic `shared/` or `utils/` directory. A cohesive exception needs a concrete
reason near the start of the file and should remain unusual.

The checker walks the working tree by directory name, not by Git's ignore
rules, so tool-owned state inside the tree (`.venv`, `venv`, `node_modules`,
`.next`, Python and lint caches) is skipped only when its name is in the
checker's ignored set. When a tool starts leaving new state in the tree, add
its directory to `.gitignore` and to that set together; never satisfy the
check by annotating or splitting third-party files.

Tests and test helpers live outside production `src/` trees. Explain every
`@ts-expect-error` on the same line; do not use `@ts-ignore`. The mechanical
structure checker is authoritative for exact scope and exclusions.
