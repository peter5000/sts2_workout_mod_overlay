# Repository Instructions & Agent Guidelines

## 1. PII & Privacy Protection Policy: Steam IDs, Personal Names, and Local Paths

> **CRITICAL DIRECTIVE**: Real Steam IDs, personal account numbers, local filesystem usernames, and real player names are Personally Identifiable Information (PII). They must **NEVER** be committed to version control, referenced in commit messages, or exposed anywhere in code, comments, or documentation.

### Rules of Engagement
1. **Never Commit PII**: Do not hardcode, expose, or commit real Steam community IDs (64-bit integers e.g. `1000000...`), personal names, or local filesystem paths (e.g. `C:\Users\<username>\...`) anywhere in `src/`, `test/`, `scripts/`, or `docs/`.
2. **Never Use Absolute File Links**: Markdown links in documentation must use relative repository paths (e.g. `../src/daemon/parser.ts`), never local machine `file:///` URLs or absolute paths containing personal user directories.
3. **Approved Placeholders**: When referencing local save paths or configuration examples, strictly use standardized placeholders:
   - PC User directory placeholder: `<YOUR_PC_NAME_HERE>` (e.g. `C:\Users\<YOUR_PC_NAME_HERE>\AppData\Roaming\...`)
   - Steam ID placeholder: `<YOUR_STEAM_ID_HERE>`
4. **Never Mention in Commit Messages**: Git commit messages and PR descriptions must be professional and generic. Never mention real player names, real nicknames, Steam IDs, or personal filesystem paths in commit logs.
5. **No Real IDs in Comments**: Never use real IDs, paths, or names in code comments, docstrings, or debug prints.
6. **Mock Placeholders for Tests**: Unit tests and fixtures must exclusively use synthetic mock IDs and generic role names:
   - Approved Mock IDs: `10000000000000001`, `10000000000000002`, `10000009900000001`
   - Approved Mock Names: `HostPlayer`, `AllyPlayer`, `PlayerOne`, `PlayerTwo`, `Hero`
7. **Local Environment Only**: Real Steam IDs, personal paths, and custom player display names belong strictly in the local untracked `.env` file (e.g. `PLAYER_NAME_<SteamID>=CustomName`), which is excluded from git tracking via `.gitignore`.
8. **Pre-Commit Diff Check**: Always review `git diff` before staging to verify that no personal identifiers, real Steam IDs, or absolute filesystem paths have been introduced.

See detailed policy in [.agents/rules/pii_exposure.md](.agents/rules/pii_exposure.md).

---

## 2. Coding Guidelines & Architecture Conventions
- **TypeScript & Node.js**: Use modern, clean TypeScript. Keep modules focused and testable.
- **Unit Testing**: All engine rules, room/floor parsing, debt calculations, and lifecycle events must be validated with deterministic unit tests under `test/`. Run `npm test` before any commit.
- **Overlay State**: Keep Electron overlay and React UI reactive to WebSocket state broadcasts from the daemon.
- **Formatting & Style**: Maintain consistent code formatting, preserve documentation integrity, and keep documentation in `README.md` and `docs/` accurate and synchronized with the latest mechanics.
