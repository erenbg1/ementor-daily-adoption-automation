# Security and public-release checklist

## Never commit

- `.env`, `.env.local`, or hosting-provider variable exports
- provider usernames or passwords
- Google OAuth secrets
- Apps Script shared secrets
- Apps Script Web App URLs
- Google Sheet IDs
- real worker names, driver names, employee IDs, or alias tables
- Gmail message headers containing real mailbox metadata
- logs, local databases, generated clients, or private screenshots

## Before publishing

1. Run secret and identifier scans.
2. Inspect git history, not just the current tree.
3. Rotate any credential that may have appeared in local output or commits.
4. Verify `.env.example` contains placeholders only.
5. Verify all examples use fictional data.

## Suggested scans

```bash
rg -n -i "password|secret|token|api[_-]?key|private[_-]?key|deployment url|spreadsheet id" .
rg -n -i "real-company-domain.example|employee name|customer name|internal site" .
```

If a secret was committed, remove it from history and rotate it at the provider.
