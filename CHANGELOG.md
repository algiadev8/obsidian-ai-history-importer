# Changelog

## 0.1.0

### Fixed

- Prevent unrelated conversations from overwriting each other when titles, timestamps, and ID prefixes collide. Match existing notes by source and full conversation ID, preserving renamed and legacy paths.
- Preserve voice transcripts and recover image/audio asset pointers even when attachment metadata is absent.
- Recover attachment names and MIME types from export metadata, including library files with an exact conversation/message origin.
- Prevent same-name attachments from overwriting different files. Verify existing bytes before reuse and preserve changed binaries under separate paths.
- Resolve skipped conversations before copying attachments, preventing duplicates on repeated imports.
- Generate portable, Unicode-safe, byte-bounded filenames, including handling unassigned code points that can fail on APFS.
- Preserve importer identity metadata with custom templates, making reimports safe after title changes.
- Honor reasoning-recap/thinking-time exclusions without removing normal user text or ordinary assistant JSON answers.
- Report missing/ambiguous assets and malformed conversation graphs; detect unsuccessful Vault file registration and prevent overlapping imports.

### Added

- Optional import of every conversation branch, with node and parent references. Current-branch-only import remains the default.
- Offline export verification script and regression coverage for parsers, persistence, filenames, and the Obsidian Vault adapter.
- Formatting, lint, tests, builds, and plugin typechecking as release checks.

### Build

- Fix the release workflow build command and use frozen dependency installation.
- Keep production/CI builds from cloning or installing the development hot-reload plugin.
- Classify coverage tooling and the host SDK as development-only dependencies, update compatible tooling/transitives, and pin patched Vite and SDK Moment dependencies. Audit development and production dependencies before release.

### Migration notes

- Existing note paths are retained. New notes use full IDs in safe filenames.
- Existing legacy attachments are not deleted. The first upgrade can add identity-based copies; subsequent identical imports reuse verified files.
- Assets absent from the export cannot be recovered and remain explicit warnings. Unassociated library files and other services are outside the conversation importer’s scope.
