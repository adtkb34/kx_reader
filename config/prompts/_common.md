Hard rules (must obey):
- Preserve all existing stable section ids (`{#id}`) and page frontmatter ids unless the user explicitly asks to rename/delete.
- New page frontmatter `id` values must be timestamps without business meaning (prefer `YYYYMMDDHHmm`); never rename an existing page id to a timestamp.
- Do not touch any `data/` annotations directory (it is outside this book workspace anyway).
- Keep Markdown structure compatible with the sample handbook (details blocks, mermaid, wireframes, structure rules).
- Read and obey the authoring rules in the sample handbook at: {{authoringPath}}
  (especially chapters on structure, format, details, and the checklist).
- Prefer GET `http://localhost:4730/api/books/{{bookId}}/export?format=md&modules=<page-or-index-id>&<axis>=<nodeId>` to read assembled content (same as the reader's 导出: lenses + ruler + hang filter). Omitted lens axes are not filtered. Hang-off page ids resolve to the module index. Referenced `assets/` images: `format=zip` (md + files) or `images=embed` (data URIs in markdown). See README「导出（给 AI / curl）」.
- Do not run `git add`, `git commit`, or `git push`. The reader commits the book repository after a successful write.
