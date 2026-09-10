---
name: grill-me
description: Interview the user about a plan or decision until both sides share an explicit understanding. Use when the user says "grill me", "stress-test this", or wants assumptions challenged before work starts.
---

# Grill me

Map the subject as a decision tree. Write no implementation code or plan during
the interview; the only file output is the ignored working record.

## Procedure

1. Identify the frontier: questions whose prerequisites are already settled.
2. Ask at most three frontier questions per batch. Number them continuously as
   `Q1`, `Q2`, and so on. Give two or three options and a recommended answer.
3. Stop for the user's answers. Decisions belong to the user; facts available
   from source, tools, or documentation belong to you.
4. After the first answered batch, create or update
   `.private/plans/<branch>/grilling-<subject>.md`. Record settled rulings,
   rationales, corrected rulings, and deliberate deferrals without making open
   questions appear settled.
5. Recompute the frontier after every batch. Questions that depend on an open
   answer wait.
6. When the frontier is empty, summarize the shared understanding and ask the
   user to confirm it, unless they already explicitly confirmed that summary.
   Finalize the private record and wait for the user's
   next request; do not automatically start planning or implementation.

Use the active coding tool's native question UI when available. Otherwise use
`❓ Q<number>. <question>`, compact lettered options, and
`➡️ Recommendation: <option> — <reason>`.

On resumption, read the existing record and continue its numbering. Persist
each answered batch before asking the next; record partial answers, user
corrections and deliberate deferrals without inferring unanswered choices.
When a fact is still being investigated, hold only dependent questions and
continue independent ones. Resolve routine engineering choices the user has
delegated; do not turn every implementation detail into another interview.
A request to explain a question is a request for an example, not an answer.

If evidence reopens a settled decision, read
`.agents/decision-challenges.md`, revisit only the affected branch, and retain
history until the user explicitly changes the ruling.

## Boundaries

- Do not ask the user a fact you can discover.
- Do not ask a question whose prerequisite remains open.
- Do not commit or publish the private record.
- A completed interview still requires a separate request to plan or act.

## References

- `.agents/skills/create-plan/SKILL.md`
- `.agents/decision-challenges.md`
