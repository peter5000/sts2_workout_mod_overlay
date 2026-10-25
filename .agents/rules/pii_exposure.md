# PII & Privacy Protection Policy: Steam IDs, Personal Names, and Local Paths

> **CRITICAL REPOSITORY DIRECTIVE**: Real Steam IDs, personal account numbers, local filesystem usernames, and real player names are Personally Identifiable Information (PII). They must NEVER be committed to version control, referenced in commit messages, or exposed in public-facing documentation.

---

## 1. Zero-Exposure Mandate
Under no circumstances should sensitive personal identifiers be committed or exposed anywhere in this repository:
- **Source Code**: No real Steam IDs, personal names, or local filesystem paths in `.ts`, `.tsx`, `.js`, or `.json` source files under `src/`.
- **Comments & Docstrings**: No real IDs, personal paths, or player names in code comments, inline explanations, or function headers.
- **Commit Messages**: Never mention real Steam IDs, real player names, or personal paths in `git commit -m` messages or pull request descriptions.
- **Documentation**: `README.md`, files in `docs/`, `CHANGELOG.md`, and walkthroughs must only use generic placeholders, synthetic IDs, and relative repository links. Never use absolute filesystem links (`file:///...`).
- **Sample Files & Fixtures**: Never check in raw `.run` or `.save` files containing real Steam community IDs or personal usernames.

---

## 2. Standardized Synthetic Identifiers for Tests & Examples
When authoring unit tests, mock fixtures, or documentation examples, use the following standardized placeholders:

| Identifier Type | Approved Synthetic Mock / Placeholder | Forbidden Patterns |
| :--- | :--- | :--- |
| **Steam ID (Host)** | `10000000000000001` or `mock_steam_id_1` | Real 17-digit Steam64 IDs |
| **Steam ID (Guest)** | `10000000000000002` or `mock_steam_id_2` | Real player friend IDs |
| **Steam ID (Rounding Test)** | `10000009900000001` | Specific identifiable accounts |
| **Player Name** | `HostPlayer`, `AllyPlayer`, `PlayerOne`, `PlayerTwo`, `Hero` | Real names or personal Steam nicknames |
| **Local File Paths** | `C:\Users\<YOUR_PC_NAME_HERE>\AppData\...` or `%APPDATA%\...` | Specific local Windows user directories (`C:\Users\username\...`) |
| **Path Placeholders** | `<YOUR_PC_NAME_HERE>`, `<YOUR_STEAM_ID_HERE>` | Personal PC or Steam usernames/IDs |
| **Markdown Links** | Relative links (e.g. `../src/daemon/parser.ts`) | Absolute filesystem links (`file:///...`) |
| **Net IDs** | `1`, `2`, `100`, `200` | Real networked session seeds |

---

## 3. Local Player Name Mapping via `.env`
Personal player name mappings belong **exclusively** in the local `.env` configuration file, which is permanently ignored by `.gitignore`:

```env
# In local .env (never committed to git):
PLAYER_NAME_10000000000000001=CustomName
PLAYER_NAME_0=MyDisplayName
```

The daemon automatically reads these mappings at runtime without requiring any sensitive data to be committed to the codebase.

---

## 4. Pre-Commit Verification Checklist
Before staging or committing any changes:
1. Run `git diff` and search for 17-digit numbers starting with `1000000...`. Verify that only approved mock numbers (`...000000001`) appear in test files.
2. Verify that commit messages summarize features and bug fixes without mentioning specific individuals, personal Steam IDs, or local paths.
3. Verify that scratch scripts in test directories do not log or leak real player information into tracked files.
4. Verify that all markdown links in `docs/` and `README.md` use relative repository paths, and that any sample Windows paths use `<YOUR_PC_NAME_HERE>` and `<YOUR_STEAM_ID_HERE>`.
