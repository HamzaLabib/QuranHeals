# Candidate-mapping fixtures

`candidate-mappings.sample.json` is a **synthetic** input for
`npm run mapping:candidates`. It is **not** a reviewed or approved
emotion-to-ayah dataset and must never be treated as one.

- Every row targets a verse that already exists in the foundation seed, paired
  with a *new* Phase 5A taxonomy key.
- Running the tool against this file in its default mode performs a dry run:
  it validates and writes a report, and writes nothing to the database.
- `--apply` would insert these as lowest-trust `draft` ("candidate") mappings
  only after the target emotions are activated; a human still has to review and
  promote every one.

Regenerate or extend this file freely for local testing. Do not add real
editorial mappings here — those belong in the Phase 5B review pipeline.
