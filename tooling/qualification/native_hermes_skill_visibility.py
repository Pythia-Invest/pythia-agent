"""Assertions for Hermes-native skill precedence and toolset filtering."""

from __future__ import annotations

from pathlib import Path


def verify_skill_visibility(
    *,
    profile_home: Path,
    managed_skills: Path,
    local_skills: Path,
    local_description: str,
    managed_description: str,
    memory_description: str,
    build_skills_system_prompt,
    clear_skills_system_prompt_cache,
) -> None:
    finance_toolsets = {"pythia-eodhd", "pythia-sec"}
    all_toolsets = {*finance_toolsets, "mcp-basic-memory"}
    clear_skills_system_prompt_cache(clear_snapshot=True)
    complete_prompt = build_skills_system_prompt(
        available_tools=set(),
        available_toolsets=all_toolsets,
        skills_dir_override=local_skills,
    )
    if local_description not in complete_prompt:
        raise RuntimeError("Hermes did not select the profile-local skill.")
    if managed_description in complete_prompt:
        raise RuntimeError("Hermes exposed the shadowed managed skill description.")
    if "eodhd-market-data" not in complete_prompt:
        raise RuntimeError("Hermes hid EODHD despite its toolset being present.")
    if memory_description not in complete_prompt:
        raise RuntimeError(
            "Hermes hid Basic Memory guidance despite its toolset being present."
        )

    (profile_home / "config.yaml").write_text(
        "skills:\n"
        f'  external_dirs: ["{managed_skills}"]\n'
        "  disabled: [eodhd-market-data]\n",
        encoding="utf-8",
    )
    clear_skills_system_prompt_cache(clear_snapshot=True)
    disabled_prompt = build_skills_system_prompt(
        available_tools=set(),
        available_toolsets=all_toolsets,
        skills_dir_override=local_skills,
    )
    if "eodhd-market-data" in disabled_prompt:
        raise RuntimeError("Hermes exposed a globally disabled managed skill.")

    (profile_home / "config.yaml").write_text(
        "skills:\n"
        f'  external_dirs: ["{managed_skills}"]\n'
        "  disabled: []\n",
        encoding="utf-8",
    )
    clear_skills_system_prompt_cache(clear_snapshot=True)
    no_memory_prompt = build_skills_system_prompt(
        available_tools=set(),
        available_toolsets=finance_toolsets,
        skills_dir_override=local_skills,
    )
    if memory_description in no_memory_prompt or "investment-memory" in no_memory_prompt:
        raise RuntimeError(
            "Hermes exposed Basic Memory-specific guidance without its toolset."
        )
    if (
        local_description not in no_memory_prompt
        or "eodhd-market-data" not in no_memory_prompt
    ):
        raise RuntimeError(
            "Hermes removed unrelated finance guidance with Basic Memory."
        )

    (profile_home / "config.yaml").write_text(
        "skills:\n"
        f'  external_dirs: ["{managed_skills}"]\n'
        "  disabled: []\n",
        encoding="utf-8",
    )
    clear_skills_system_prompt_cache(clear_snapshot=True)
    no_toolsets_prompt = build_skills_system_prompt(
        available_tools=set(),
        available_toolsets=set(),
        skills_dir_override=local_skills,
    )
    if "eodhd-market-data" in no_toolsets_prompt:
        raise RuntimeError("Hermes exposed EODHD without its required toolset.")
    if "sec-edgar-research" in no_toolsets_prompt:
        raise RuntimeError("Hermes exposed SEC without its required toolset.")
    if "investment-memory" in no_toolsets_prompt:
        raise RuntimeError(
            "Hermes exposed Basic Memory without its required toolset."
        )

    clear_skills_system_prompt_cache(clear_snapshot=True)
    unknown_inventory_prompt = build_skills_system_prompt(
        available_tools=None,
        available_toolsets=None,
        skills_dir_override=local_skills,
    )
    if "eodhd-market-data" not in unknown_inventory_prompt:
        raise RuntimeError("Hermes did not preserve native fail-open semantics.")
    if memory_description not in unknown_inventory_prompt:
        raise RuntimeError(
            "Hermes did not preserve Basic Memory's native fail-open semantics."
        )
