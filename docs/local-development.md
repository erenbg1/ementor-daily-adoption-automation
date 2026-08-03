# Local Development

## Setup

```bash
npm install
cp .env.example .env.local
```

Edit `.env.local` with private values. Do not commit it.

## Run Checks

```bash
npm run lint
npm test
```

## Verify Mentor Access

```bash
npm run mentor:verify
```

The command checks login and report access using the configured Mentor environment variables.

## Run Optional Adoption Worker

Manual mode:

```bash
npm run mentor:adoption -- --run-mode=manual
```

Test mode:

```bash
npm run mentor:adoption:test
```

Production mode:

```bash
npm run mentor:adoption -- --run-mode=production
```

Only use production mode against a correctly configured Apps Script and workbook.

## Local Database

If you use SQLite locally, set:

```text
MENTOR_LOG_DATABASE_URL=file:./local-mentor-log.db
```

Database files are ignored by git and should never be committed.
