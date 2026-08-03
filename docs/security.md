# Security and public-release checklist

## Never commit

- `.env`, `.env.local`, or Railway variable exports
- Mentor usernames or passwords
- Google OAuth secrets
- Apps Script shared secrets
- Apps Script Web App URLs for production deployments
- Google Sheet IDs for production workbooks
- Driver names, employee IDs, or alias tables from production
- Gmail message headers containing real mailbox metadata
- Logs, build output, local SQLite databases, or generated Prisma clients

## Before publishing

1. Run a repository audit command such as the examples below.
2. Confirm there is no git history containing secrets. If history exists and contains secrets, rotate them and rewrite/remove the history before publishing.
3. Rotate any credential that may have appeared in local output, screenshots, or commits.
4. Verify `.env.example` contains placeholders only.
5. Verify production recipients are configured outside git.

## Suggested audit commands

```bash
rg -n "password|secret|token|api[_-]?key|private[_-]?key|spreadsheet/d/|script.google.com/macros" \
  --glob '!node_modules/**' \
  --glob '!.next/**' \
  --glob '!*.lock' .
```

Then separately search for organization-specific domains, workbook IDs, and individual names used in your production deployment.

## If a secret was committed

Removing the value from the current tree is not enough. Rotate the secret at the provider, then remove it from git history before publishing.
