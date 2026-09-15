# Accessing Desk

Desk listens on `127.0.0.1`. Local browser access needs no Tailscale account,
proxy, or additional authentication setup. An SSH tunnel is another way to
reach that same localhost interface from your own computer.

## Optional Tailscale Serve

Tailscale Serve provides HTTPS access on your tailnet. Pythia neither installs
nor manages Tailscale. Configure it separately, leave Desk bound to loopback,
and set these non-secret environment variables on the Desk process:

```text
PYTHIA_DESK_TAILSCALE_ORIGIN=https://your-machine.your-tailnet.ts.net:9443
PYTHIA_DESK_TAILSCALE_LOGIN=you@example.com
```

Use the exact HTTPS origin, without a trailing slash, and the permitted
Tailscale login. Both settings are required; omitting both keeps remote access
disabled. This works with either `next dev` or the production Desk server.
For development commands and hot reload, see [development](development.md#optional-tailscale-access).

On an installed Ubuntu device, use an ordinary user-service override:

```sh
systemctl --user edit pythia-agent-desk.service
```

```ini
[Service]
Environment="PYTHIA_DESK_TAILSCALE_ORIGIN=https://your-machine.your-tailnet.ts.net:9443"
Environment="PYTHIA_DESK_TAILSCALE_LOGIN=you@example.com"
```

Restart Desk with `systemctl --user restart pythia-agent-desk.service`. Do not
edit Pythia's generated service environment file; the drop-in is operator-owned.
Inspect `tailscale serve status` first to avoid replacing an existing route,
then forward an unused HTTPS port to the installed Desk port:

```sh
tailscale serve --https=9443 http://127.0.0.1:8644
```

This runs in the foreground; Ctrl-C removes that temporary forwarding. To keep
it running, use Tailscale's native `--bg` option. Remove that specific background
listener with `tailscale serve --https=9443 off`, not `tailscale serve reset`.
To disable Desk's Tailscale access, remove the two environment settings from
your drop-in and restart Desk. Do not remove unrelated overrides or routes.

Desk checks the Serve-provided login, exact host and browser origin before
privileged API access. Mutations still require JSON and a browser-session CSRF
token. The browser never receives the Hermes bearer. Tagged Tailscale clients
have no user login and cannot use this access mode.

This trusts the local Serve proxy and local OS user; it is not protection
against another process running as that user. During development, public Next
assets and hot reload are not covered by Desk's API identity check. Use a
trusted tailnet with appropriate ACLs. Do not expose the underlying HTTP port,
use Funnel, or trust client-supplied identity headers from a different proxy.

Other hosting mechanisms are not automatically supported by these settings.
Public internet hosting would require its own authentication and security
review; Tailscale support does not make Desk a public multi-user web service.

Workspace files stay on the Hermes host. Configured remote Desk clients browse,
preview, download and reference them through the same admitted host reads as local
clients; browser-local file paths are not workspace paths. Initial workspace HTML
and RSC responses apply the same host and Serve identity checks before embedding
file metadata. Subsequent reads and preview contents use the admitted API. Current-view context
is bound to the submitting tab and native session and expires when publication
stops. This design does not imply Workspace-specific cross-device/Tailscale
acceptance has been exercised; see [support](support.md).
