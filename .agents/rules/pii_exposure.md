# PII & Privacy Protection Policy: Steam IDs and Personal Names

> **CRITICAL REPOSITORY DIRECTIVE**: Real Steam IDs, personal account numbers, local filesystem usernames, and real player names are Personally Identifiable Information (PII). They must NEVER be committed to version control, referenced in commit messages, or exposed in public-facing documentation.

---

## 1. Zero-Exposure Mandate
Under no circumstances should sensitive personal identifiers be committed or exposed anywhere in this repository:
- **Source Code**: No real Steam IDs or personal names in `.ts`, `.tsx`, `.js`, or `.json` source files under `src/`.
- **Comments & Docstrings**: No real IDs or player names in code comments, inline explanations, or function headers.
- **Commit Messages**: Never mention real Steam IDs, real player names, or personal paths in `git commit -m` messages or pull request descriptions.
- **Documentation**: `README.md`, files in `docs/`, `CHANGELOG.md`, and walkthroughs must only use generic placeholders or synthetic IDs.
- **Sample Files & Fixtures**: Never check in raw `.run` or `.save` files containing real Steam community IDs or personal usernames.

---

## 2. Standardized Synthetic Identifiers for Tests & Examples
When authoring unit tests, mock fixtures, or documentation examples, use the following standardized placeholders:

| Identifier Type | Approved Synthetic Mock / Placeholder | Forbidden Patterns |
| :--- | :--- | :--- |
| **Steam ID (Host)** | `10000000000000001` or `mock_steam_id_1` | Real 17-digit Steam64 IDs |
| **Steam ID (Guest)** | `10000000000000002` or `mock_steam_id_2` | Real player friend IDs |
| **Player Name** | `HostPlayer`, `AllyPlayer`, `PlayerOne`, `PlayerTwo`, `Hero` | Real names or personal Steam nicknames |
| **Local File Paths** | `C:\Users\<YOUR_PC_NAME_HERE>\AppData\...` or `C:\Users\<YOUR_PC_NAME_HERE>\AppData\...` | Specific local Windows user directories |
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
2. Verify that commit messages summarize features and bug fixes without mentioning specific individuals or personal Steam IDs.
3. Verify that scratch scripts in test directories do not log or leak real player information into tracked files.
