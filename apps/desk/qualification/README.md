# Explicit browser contract probes

These probes are excluded from ordinary Desk tests. They launch a short-lived
headless Chromium process with isolated temporary state and no listening socket.
They do not start Desk or Hermes. All HTTP requests are intercepted; only the
installed browser's own PDF extension and `chrome://resources` files pass through.

From the repository root:

```sh
pnpm --filter @pythia/desk exec tsc --noEmit --project qualification/tsconfig.json
pnpm --filter @pythia/desk exec vitest run --config qualification/vitest.config.mts
```

The PDF probe uses actual workspace file-serving responses and a valid synthetic
PDF. It uses the installed Next route matcher and response sender to compose global
headers with actual workspace response headers, then checks rendered PDF pixels
at 900px and 390px widths. Adjacent routes must retain their framing denial. It requires an already installed Playwright
Chromium binary and does not install one. Set `PYTHIA_PDF_PROBE_OUTPUT` to an
ignored private directory to retain PNG screenshots and JSON observations;
otherwise temporary state is deleted.

This qualifies Chromium's embedded PDF renderer and the response CSP. It does
not qualify the full Desk application, mobile browser engines, Tailscale
admission, or a browser's choice to issue PDF byte-range requests.
