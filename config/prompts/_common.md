Hard rules (must obey):
- Preserve all existing stable section ids (`{#id}`) and page frontmatter ids unless the user explicitly asks to rename/delete.
- Do not touch any `data/` annotations directory (it is outside this book workspace anyway).
- Keep Markdown structure compatible with the sample handbook (details blocks, mermaid, wireframes, structure rules).
- Read and obey the authoring rules in the sample handbook at: {{authoringPath}}
  (especially chapters on structure, format, details, and the checklist).
- Do not run `git add`, `git commit`, or `git push`. The reader commits the book repository after a successful write.
