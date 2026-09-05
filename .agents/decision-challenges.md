# Decision challenge protocol

Use this only when implementation or evidence shows that faithfully applying an
accepted decision may itself be materially wrong. An implementation defect or
preference is not a decision challenge.

1. Record a `DC-*` item in the private implementation record and pause only the
   affected path.
2. Capture the ruling, expected and observed behavior, inspectable evidence,
   affected work, and at most three credible options.
3. Ask the user for an explicit ruling; do not work around the current ruling.
4. Reconcile the private record and distill the accepted result into its public
   documentation or ADR with context, ruling, rationale, consequences, and
   rejected alternatives.
5. Invalidate and rerun only affected tests, qualification, and review.
