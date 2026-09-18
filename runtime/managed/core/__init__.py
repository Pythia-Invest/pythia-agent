"""Pythia host support registered through the native Hermes extension point."""
from __future__ import annotations

from typing import Any

from .desk_view import SCHEMA as DESK_VIEW_SCHEMA, desk_view
from .operating import OPERATING_CONTEXT


def register(ctx: Any) -> None:
    from . import platform

    platform.register(ctx)
    ctx.register_tool(
        name="pythia_desk_view",
        toolset="pythia-desk",
        schema=DESK_VIEW_SCHEMA,
        handler=desk_view,
        description="Current Pythia Desk page and observable selection",
    )
    ctx.register_system_prompt_section(
        "pythia.operating",
        OPERATING_CONTEXT,
        position="after_memory",
        max_chars=4000,
    )
