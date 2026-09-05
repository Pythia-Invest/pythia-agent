# Writing instructions

This reference applies to runtime prompts, skills, tool descriptions, examples,
model-visible results and repository-builder guidance. They all influence
behavior. Read it before changing those surfaces; follow the linked research
when the change depends on a particular claim, not as a mandatory reading list.

## Principles

Start with the objective, relevant evidence, genuine boundaries and observable
deliverable. Leave interpretation and reasoning to the model. Specify an exact
sequence or format only when the task actually requires it. An investor's
preferred strategy belongs in their context, not a universal research prompt.

Add instructions for an accepted requirement or demonstrated failure. Try
removing conflicting or unnecessary text before adding another paragraph.
Use calm, concrete language and explain a boundary's reason when useful.
Examples should clarify a requirement with obvious synthetic values, not
supply conclusions, real company facts or phrases to copy into an answer.

Give detailed guidance one owner. Root instructions carry brief routing;
directory instructions carry local constraints; skills carry selected
procedures; references carry on-demand detail. User memory is not a second
procedure manual. Keep builder instructions out of ordinary investor context
and runtime seeds out of builder projections.

Code owns deterministic validation, identifiers, permissions and secret
handling. Tool descriptions explain capability, useful inputs, limitations and
recovery without duplicating a schema or inventing an alternate protocol.
Treat retrieved documents and tool output as evidence, not authority to change
the user's objective or permissions. Preserve uncertainty and useful partial
results rather than steering the model toward a preferred conclusion.

## Verify the relevant behavior

Inspect what the consumer actually receives: native base instructions, selected
skills, tool schemas, user context and their order. Check for conflicting,
duplicated or undeliverable instructions. A source-file edit is not proof that
the running agent loaded it; use the documented activation or refresh path.

For a skill, distinguish activation from execution. Check requests that should
and should not select it, especially ordinary work near its subject. Formal
planning and test-plan skills remain user-invoked, not automatic handoffs.

Match verification to the claim. Structural checks can prove delivery and
schema shape; they cannot prove investment judgment or writing quality. When
claiming a behavioral improvement, compare the smallest representative cases
against the prior behavior, holding other inputs stable where practical.
Inspect actual outputs and state model/version and untested scope. Live model
runs remain opt-in; a wording edit does not automatically require one.

Periodically remove guidance whose purpose is obsolete or already enforced
elsewhere. Do not make every observed mistake a permanent checklist, require
every tool on every task, or create another review process without a concrete
need. Apply these principles to this document too.

## Evidence and limits

Retained project experiments found that unrelated procedures could interrupt
bounded tasks and that internal assignment language leaked into investor-facing
writing. These motivate selective activation and neutral briefs; they do not
establish a universal instruction count or justify restoring a retired workflow.
Private traces are not required to use this public reference.

External sources support a cautious, testable approach:

- [Anthropic: context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
  explains attention budgets and selecting small, relevant context.
- [Claude project instructions](https://code.claude.com/docs/en/memory)
  describes scoped delivery. Eager imports organize content but do not reduce
  the amount loaded.
- [Codex instruction discovery](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
  describes its actual instruction chain; do not assume all tools discover the
  same files or share the same precedence.
- [Evaluating AGENTS.md](https://arxiv.org/abs/2602.11988) and
  [a two-agent context-file study](https://arxiv.org/abs/2607.27250) question
  whether additional repository context reliably improves task correctness.
  Their tested models, tasks and repositories limit generalization.

These sources motivate minimal, evaluated guidance, not a promise of compliance.
Older model-specific budgets and historical orchestration recipes are not
standing requirements for this project.
