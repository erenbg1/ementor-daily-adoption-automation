# Local development

## Setup

```bash
npm install
cp .env.example .env.local
```

Edit `.env.local` with private values for your own demo or deployment. Do not commit it.

## Checks

```bash
npm run lint
npm test
npm audit --audit-level=moderate
```

## Mentor verification

```bash
npm run mentor:verify
```

This command uses safe placeholder endpoint paths in the public repository. Real private endpoint paths should be configured or implemented outside the public repo.

## Worker modes

```bash
npm run adoption:run -- --run-mode=manual
npm run adoption:run -- --run-mode=production
npm run adoption:test
```

Only use production mode against a correctly configured workbook and Web App.
