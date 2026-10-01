# Reference builder guidance

Read the repository-root `AGENTS.md` first. Adding a source, a field use or a
judgement question type, or widening what a source may confirm, follows
[source onboarding](../../docs/architecture/source-onboarding.md): read each field
in the one meaning its specification gives, count unexpected input, and turn
disagreements into conflicts or questions rather than hand lists, tie-breaks or
name matches. Each source's record is in `docs/sources/`.

A name never creates a link. An exact full-name equality may break a tie only
among candidates the identifiers already name, and never picks a retired LEI; a name
may veto a rule (a receipt whose name disagrees with its issuer's stays a question).
A shared word only raises a review flag.
