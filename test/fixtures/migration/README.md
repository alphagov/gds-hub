<!-- SYNTHETIC FIXTURE: every file in this folder is invented. -->

# Migration test fixtures

Hand-written, synthetic samples for the Phase 5 migration tests. They copy the
**structure** of the current Hub (a shared page layout, the URL patterns and the
YAML file shapes) with invented names and values. Nothing here is copied from
the current Hub.

- `hub-build/` stands in for `HUB_BUILD_DIR`: built pages in a fake copy of the
  shared layout, with the content in `<main>`.
- `hub-data/` stands in for `HUB_DATA_DIR`: the YAML data files.

Every file must contain the text `SYNTHETIC FIXTURE`, or
`npm run check:no-migration-data` fails. Never add real Hub files, exports or
copies of real content here.
