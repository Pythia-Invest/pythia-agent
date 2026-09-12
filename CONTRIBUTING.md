# Contributing

Pythia Agent is in technical preview. Small, well-scoped fixes and discussions
are welcome. For a substantial change, open an issue first so the product and
ownership boundaries are clear before implementation.

Search existing issues before opening a bug report or feature request. Include
reproduction steps and your revision for bugs, or a concrete user need for
features. Use synthetic examples and redact private information. Keep discussion
respectful and on topic; spam, harassment, and malicious submissions may be
removed or blocked. This is a small project with no guaranteed response time.

External contributions use fork pull requests. Maintainers can push directly to
`main`; the branch rules block deletion and force pushes without requiring a PR
or passing checks before each push. This keeps solo development lightweight;
maintainers remain responsible for checking changes and following up on CI.

GitHub Actions uses read-only default tokens and requires approval for all
outside contributors' fork workflows. Inspect the proposed code, scripts, and
workflow changes before approving a run. Secret scanning, push protection, and
dependency vulnerability alerts provide repository-level signals; private
vulnerability reporting is the security intake. These settings live on GitHub
and must be configured separately for forks. We do not require review counts or
automated dependency-update PRs for routine solo work.

## Set up and check a change

Start with [AGENTS.md](AGENTS.md) for shared working boundaries and topic-specific
reading. See [supported environments](docs/support.md) before changing platform
behavior and [prompting guidance](docs/prompting.md) before changing any
model-visible instructions, including skills and builder rules. Formal plans
and test-plan workflows are optional, explicitly requested tools; ordinary
contributions can be developed and tested directly.

Development is supported on macOS and Ubuntu. Follow
[docs/development.md](docs/development.md), then run the repository gates from
the root:

```sh
just check
just test
just audit
```

`just check` is deterministic and does not contact a registry. `just audit` is
the explicit network/registry dependency audit. Include the commands you ran
and their results in the pull request.

Reusable builder workflows are canonical under `.agents/`. Codex discovers
their skills there directly. Run only the adapters your local tools need, or
all of them together:

```sh
just ai-sync
just sync-agents
just sync-rules
just builder-sync
just check-ai-workspace
```

Generated Claude/Codex/Cursor files are ignored local copies. Run
`just setup-hooks` once to have them refreshed by Git hooks after checkouts and
merges. The check uses disposable destinations and does not require generated
files, existing tool configuration, or active hooks.

Use the Design Lab for reusable interface work. Keep applications dependent on
`@pythia/ui`; they must not import the Lab or its synthetic fixtures.

## Keep the repository public and small

- Do not commit credentials, investment records, provider responses, generated
  model output, caches, databases, or device state.
- Keep working plans, interviews, runbooks, results, and raw receipts under the
  ignored `.private/plans/<branch>/` tree. Distill every accepted product or
  architecture choice into public documentation or a file under
  `docs/decisions/` with its context, ruling, rationale, consequences, and
  relevant rejected alternatives.
- Treat `AGENTS.md`, `.agents/`, tests, docs, and the Design Lab as development
  source, not ordinary runtime or model input. Explicit approved source
  maintenance may read public source.
- Do not patch or vendor Hermes or Basic Memory. Use their qualified native
  surfaces and keep the dependency seam narrow.
- Prefer a direct implementation over a new abstraction, service, registry, or
  compatibility layer.

The repository's nested `AGENTS.md` files contain scoped contributor guidance.
They are not automatically injected into the installed Pythia agent. Explicit
approved source maintenance can read public source, so this is an input-routing
boundary rather than a filesystem security boundary.

## Licensing contributions

Pythia-authored source is licensed under Apache-2.0. By submitting a
contribution for inclusion, you agree that it may be distributed under the
same license, as described by section 5 of [LICENSE](LICENSE). No contributor
license agreement is required.

Only submit work you have the right to contribute. Preserve third-party
notices, identify adapted code and its license, and do not submit market data
or other provider content unless redistribution rights are established.

Report security issues through the private route in [SECURITY.md](SECURITY.md),
not a public issue.
