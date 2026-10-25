# Repository Instructions & Agent Guidelines

## 1. PII & Privacy Protection Policy: Steam IDs and Personal Names

> **CRITICAL DIRECTIVE**: Real Steam IDs, personal account numbers, local filesystem usernames, and real player names are Personally Identifiable Information (PII). They must **NEVER** be committed to version control, referenced in commit messages, or exposed anywhere in code, comments, or documentation.

### Rules of Engagement
1. **Never Commit PII**: Do not hardcode, expose, or commit real Steam community IDs (64-bit integers e.g. `1000000...`) or personal names anywhere in `src/`, `test/`, `scripts/`, or `docs/`.
2. **Never Mention in Commit Messages**: Git commit messages and PR descriptions must be professional and generic. Never mention real player names, real nicknames, or Steam IDs in commit logs.
3. **No Real IDs in Comments**: Never use real IDs or names in code comments, docstrings, or debug prints.
4. **Mock Placeholders for Tests**: Unit tests and fixtures must exclusively use synthetic mock IDs and generic role names:
   - Approved Mock IDs: `10000000000000001`, `10000000000000002`
   - Approved Mock Names: `HostPlayer`, `AllyPlayer`, `PlayerOne`, `PlayerTwo`, `Hero`
5. **Local Environment Only**: Real Steam IDs and custom player display names belong strictly in the local untracked `.env` file (e.g. `PLAYER_NAME_<SteamID>=CustomName`), which is excluded from git tracking via `.gitignore`.
6. **Pre-Commit Diff Check**: Always review `git diff` before staging to verify that no personal identifiers or real Steam IDs have been introduced.

See detailed policy in [.agents/rules/pii_exposure.md](.agents/rules/pii_exposure.md).

---

## 2. Coding Guidelines & Architecture Conventions
- **TypeScript & Node.js**: Use modern, clean TypeScript. Keep modules focused and testable.
- **Unit Testing**: All engine rules, room/floor parsing, debt calculations, and lifecycle events must be validated with deterministic unit tests under `test/`. Run `npm test` before any commit.
- **Overlay State**: Keep Electron overlay and React UI reactive to WebSocket state broadcasts from the daemon.
- **Formatting & Style**: Maintain consistent code formatting, preserve documentation integrity, and keep documentation in `README.md` and `docs/` accurate and synchronized with the latest mechanics.
