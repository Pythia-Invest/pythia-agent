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

Tests and test helpers live outside production `src/` trees. Explain every
`@ts-expect-error` on the same line; do not use `@ts-ignore`. The mechanical
structure checker is authoritative for exact scope and exclusions.
