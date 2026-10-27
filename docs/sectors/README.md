# Sectors

One folder per sector. A sector is a D2C market we research company by company.

Status: candidate | active | rejected.

Each folder holds:

- README.md: the sector's status and notes.
- profile.json: the sector's settings (categories, scope, tiering, prompt hints).
- decisions.md: pointers to the business decisions that concern this sector.
- results.md: what the research found, in counts.
- log.md: dated working notes.

Load a profile into the database with:

    npm run mcp -- sector_profile_set --sectorId <id> --json-file docs/sectors/<slug>/profile.json

No prospect names, people, emails or phones in this folder. They stay in the database.
