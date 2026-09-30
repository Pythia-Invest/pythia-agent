"""Pythia host support registered through the native Hermes extension point."""
from __future__ import annotations

from typing import Any

from .desk_view import SCHEMA as DESK_VIEW_SCHEMA, desk_view
from .operating import operating_context, routing_context


def register(ctx: Any) -> None:
    from . import platform

    platform.register(ctx)
    from . import identity_ops

    identity_ops.register(ctx)
    from . import agent_tools

    agent_tools.register(ctx)

    from . import markets_ops

    markets_ops.register(ctx, identity_ops.CURRENT)
    from . import documents

    documents.register(ctx, identity_ops.CURRENT)
    from . import ingest_ops

    ingest_ops.register(ctx, identity_ops.CURRENT)
    from . import plugin_effect

    plugin_effect.register(ctx, identity_ops.CURRENT)
    ctx.register_tool(
        name="pythia_desk_view",
        toolset=agent_tools.TOOLSET,
        schema=DESK_VIEW_SCHEMA,
        handler=desk_view,
        description="Current Pythia Desk page and observable selection",
    )
    ctx.register_system_prompt_section(
        "pythia.operating",
        operating_context,
        position="after_memory",
        max_chars=4000,
    )
    # Hermes renders sections by id, so this follows the operating section.
    ctx.register_system_prompt_section(
        "pythia.routing",
        routing_context,
        position="after_memory",
        max_chars=4000,
    )
    platform.publish(ctx)  # last: plugins find `pythia_platform` only once core registered in full
