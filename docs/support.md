# Supported environments

Support is specific to a surface. Do not infer installed-device support from
a successful development run, or browser coverage from one screenshot.

| Surface | Current scope | Evidence boundary |
| --- | --- | --- |
| Git preview installation | Ubuntu x86-64 | Installation, service readiness, rebuild and interrupted-update recovery exercised on Ubuntu 26.04; whole-host reboot remains untested. |
| Local development | macOS and Ubuntu with the pinned toolchain | Foreground stacks; no systemd or network provisioning. |
| Desk browser | Chromium is the currently exercised browser family | Firefox, Safari and mobile-browser qualification remains pending; no all-browser claim. |
| Remote access | Optional native Tailscale Serve, or an SSH tunnel to localhost | HTTPS development and installed-service access exercised through native Serve. |

Installed Chromium checks cover browser admission, missing-account setup,
provider/model inventory, independent skill/tool toggles, and Hermes restart
readback. Basic Memory's installed MCP passed synthetic note write, read, text
search and deletion. These are mechanical checks, not evidence of investment
research quality or successful live-provider authentication on a fresh device.

Exact prerequisites live in [development](development.md) and
[installation](install.md); access choices live in [hosting](hosting.md).
Windows installation and additional architectures are not currently supported.

Keep portable application logic independent of the OS. Put necessary
platform-specific behavior in its existing lifecycle owner. Avoid personal
paths, shell assumptions and browser-specific APIs without a supported fallback
or explicit limitation. Expand this matrix when adding support, with evidence
from the affected surface; do not build speculative portability layers.

UI work should preserve keyboard access and usable narrow layouts even while
the browser matrix is limited. Select checks by the changed behavior rather
than running every environment for every edit. Keep intended support and actual
qualification distinct when updating this page.
