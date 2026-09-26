"""Isolation for the Hermes wire capture: no network, reproducible clock.

Imported by ``hermes-wire-capture.py``; also runs the pinned ``hermes`` CLI
under the same network guard (``python hermes_capture_guard.py <args>``).
"""

from __future__ import annotations

import atexit
import socket
import sys
import threading
import time
from typing import Any

BLOCKED_NETWORK: list[str] = []
BLOCKED_MARKER = "HERMES_CAPTURE_BLOCKED_NETWORK:"
LOOPBACK = {"127.0.0.1", "::1", "localhost"}


def block_network() -> None:
    """Refuse every non-loopback connection so nothing can reach a provider."""
    real_connect = socket.socket.connect
    real_connect_ex = socket.socket.connect_ex
    real_getaddrinfo = socket.getaddrinfo

    def allowed(address: Any) -> bool:
        return not isinstance(address, tuple) or address[0] in LOOPBACK

    def connect(sock, address):
        if not allowed(address):
            BLOCKED_NETWORK.append(repr(address))
            raise ConnectionRefusedError("Hermes capture blocks network access.")
        return real_connect(sock, address)

    def connect_ex(sock, address):
        if not allowed(address):
            BLOCKED_NETWORK.append(repr(address))
            return 111
        return real_connect_ex(sock, address)

    def getaddrinfo(host, *args, **kwargs):
        if host is not None and host not in LOOPBACK:
            BLOCKED_NETWORK.append(str(host))
            raise socket.gaierror("Hermes capture blocks name resolution.")
        return real_getaddrinfo(host, *args, **kwargs)

    socket.socket.connect = connect
    socket.socket.connect_ex = connect_ex
    socket.getaddrinfo = getaddrinfo


def strictly_increasing_clock() -> None:
    """Break equal wall-clock readings so ranked times are reproducible."""
    real_time = time.time
    lock = threading.Lock()
    last = [0.0]

    def unique_time() -> float:
        with lock:
            last[0] = max(real_time(), last[0] + 1e-6)
            return last[0]

    time.time = unique_time


def run_cli() -> int:
    """Run the pinned ``hermes`` entry point with the network guard active."""
    block_network()

    def report() -> None:
        if BLOCKED_NETWORK:
            print(BLOCKED_MARKER, ", ".join(sorted(set(BLOCKED_NETWORK))), file=sys.stderr)

    atexit.register(report)
    from hermes_cli.main import main

    sys.argv = ["hermes", *sys.argv[1:]]
    return main()


if __name__ == "__main__":
    raise SystemExit(run_cli())
