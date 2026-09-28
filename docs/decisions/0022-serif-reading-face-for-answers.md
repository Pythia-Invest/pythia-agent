# 0022: A serif reading face for Pythia's answers

## Context

[ADR 0009](0009-chat-surface-on-ai-sdk-transport.md) set all conversation
text — what the person types, Pythia's answers and the composer — in Inter at
the compact 14px reading size, as the one typeface exception to IBM Plex Sans.
In the redesigned chat, Pythia's answers read as short research notes beside a
lot of interface: activity lines, tool details, sources and controls. A
neutral grotesque for both sides of the exchange made the answer and the chrome
around it look alike, and it matched neither side of the brand: the public
site sets its prose in IBM Plex Serif.

## Ruling

Pythia's answer prose uses **IBM Plex Serif** through the `font-reading` role:
the Markdown of an assistant turn, including headings and lists inside that
answer, and the reported work of a delegated agent. What the person types —
the composer and their own messages — and all interface chrome stay in IBM
Plex Sans. Headings in interface chrome never use the serif.

The size stays the 14px Product reading baseline with its existing line
height. `@pythia/ui` self-hosts four Plex Serif files (regular, italic,
semibold, bold) under the existing SIL Open Font License notice. Inter stays
only as a comparison in the Design Lab.

## Rationale and consequences

A serif answer separates Pythia's voice from the person's words and from the
controls around it, without adding colour or weight. Plex Serif shares the
proportions of the Plex Sans interface, so the two sit together without a
second design language, and it is the brand's own reading face.

The fonts are about 290 KB and load with `font-display: swap` only when answer
text renders. There is no semibold or bold italic, so `***text***` in an
answer uses a browser-synthesised face. If 14px proves too small for the serif
in use, the reading size changes for the answer role only, not for chrome.

This revises only ADR 0009's typeface choice; its transport and rendering
decisions are unchanged.

## Rejected alternatives

Keeping Inter everywhere kept the exchange neutral but left answers
indistinguishable from chrome. Source Serif 4, compared in the Design Lab, is
not part of the brand family. Setting the person's own messages in the serif
as well would blur who is speaking.
