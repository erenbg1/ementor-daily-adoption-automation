# Contributing

Contributions are welcome when they preserve the existing matching behavior.

## Development rules

- Do not commit real credentials, workbook IDs, deployment URLs, driver names, or recipient lists.
- Keep production configuration in environment variables or Apps Script properties.
- Add or update tests when changing worker behavior or Apps Script endpoint behavior.
- Do not rewrite the matcher unless the change is explicitly scoped and covered by regression tests.
- Keep public examples generic.

## Local checks

```bash
npm test -- tests/mentor
npm run lint
```

## Pull request checklist

- [ ] No secrets or private identifiers are committed.
- [ ] `.env.example` is still placeholder-only.
- [ ] Apps Script manual menu behavior is preserved.
- [ ] Adoption run modes still behave correctly.
- [ ] Tests pass.
