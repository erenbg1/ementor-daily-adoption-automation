# Apps Script setup

Copy these files into an Apps Script project attached to your workbook:

- `apps-script/ementor.gs`
- `apps-script/adoption.gs`

The public matcher keeps the production-style workflow visible while avoiding private workbook details. Adapt workbook ranges and tab names through script properties instead of hardcoding deployment-specific details.

## Required properties

| Property | Required | Description |
| --- | --- | --- |
| `ADOPTION_SPREADSHEET_ID` | Yes | Target workbook ID |
| `ADOPTION_SHARED_SECRET` | Yes | Shared secret used by the worker |

## Optional properties

| Property | Description |
| --- | --- |
| `ADOPTION_RAW_IMPORT_SHEET` | Raw shift-report tab. Default: `Adoption_Check` |
| `ADOPTION_EXPECTED_SHEET` | Expected workers tab. Default: `EXPECTED_DRIVERS` |
| `ADOPTION_ALIAS_SHEET` | Alias table tab. Default: `ALIAS_TABLE` |
| `ADOPTION_TIME_ZONE` | Reporting timezone. Default example: `Etc/UTC` |
| `ADOPTION_RUN_HOUR` | Reporting run hour. Default example: `18` |
| `ADOPTION_SKIP_WEEKDAYS` | Comma-separated weekday numbers to skip |
| `ADOPTION_PER_RECIPIENT_EMAIL_ENABLED` | Enables production report email |
| `ADOPTION_EMAIL_RECIPIENTS` | Approved recipient allowlist |

## Web App deployment

1. Create or open an Apps Script project.
2. Add the two `.gs` files.
3. Set script properties.
4. Deploy as a Web App.
5. Execute as the account intended to own workbook and Gmail actions.
6. Store the Web App URL outside git.

## Run modes

| Mode | Replaces raw report | Runs matcher | Writes history | Sends configured recipients |
| --- | --- | --- | --- | --- |
| `test` | Yes | Yes | No | No |
| `manual` | Yes | Yes | No | No |
| `production` | Yes | Yes | Yes, once per service date | Yes, when enabled and not skipped by schedule config |
