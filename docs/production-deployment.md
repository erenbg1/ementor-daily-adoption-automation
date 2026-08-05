# Production deployment

This guide describes how to deploy the eMentor Daily Adoption Automation safely. It intentionally uses placeholder values instead of production configuration.

## Services

```mermaid
flowchart LR
  Cron["Scheduler"] --> Worker["Adoption worker"]
  Worker --> Provider["Mentor adapter"]
  Worker --> AppsScript["Apps Script Web App"]
  AppsScript --> Sheet["Google Sheet"]
  AppsScript --> Gmail["GmailApp"]
```

## Worker variables

| Variable | Required | Description |
| --- | --- | --- |
| `MENTOR_USERNAME` | Yes | Mentor username |
| `MENTOR_PASSWORD` | Yes | Mentor password |
| `MENTOR_COMPANY` | If applicable | Mentor tenant/company value |
| `MENTOR_BASE_URL` | Yes | Mentor base URL |
| `MENTOR_LANGUAGE_CODE` | No | Example localization value |
| `MENTOR_REQUEST_TIMEOUT_MS` | No | Request timeout |
| `MENTOR_REQUEST_RETRY_DELAYS_MS` | No | Comma-separated retry delays |
| `ADOPTION_WEB_APP_URL` | Yes | Apps Script Web App endpoint |
| `ADOPTION_SHARED_SECRET` | Yes | Shared secret used to sign payloads |
| `REPORTING_TIME_ZONE` | No | Default: `Europe/Berlin` |
| `REPORTING_OPERATIONAL_RUN_HOUR` | No | Operational snapshot hour. Default: `18` |
| `REPORTING_OPERATIONAL_RUN_MINUTE` | No | Operational snapshot minute. Default: `15` |
| `REPORTING_FINAL_RUN_HOUR` | No | Final daily report hour. Default: `22` |
| `REPORTING_FINAL_RUN_MINUTE` | No | Final daily report minute. Default: `30` |
| `REPORTING_RUN_GRACE_MINUTES` | No | Minutes after a configured report time during which a delayed Railway cron start may still run. Default: `5` |
| `REPORTING_SKIP_WEEKDAYS` | No | Comma-separated weekday numbers, where `0` is the first day of the week in JavaScript date handling |

## Apps Script properties

| Property | Required | Description |
| --- | --- | --- |
| `ADOPTION_SPREADSHEET_ID` | Yes | Google Sheet ID |
| `ADOPTION_SHARED_SECRET` | Yes | Same shared secret used by the worker |
| `ADOPTION_RAW_IMPORT_SHEET` | No | Raw report tab name |
| `ADOPTION_EXPECTED_SHEET` | No | Expected workers tab name |
| `ADOPTION_ALIAS_SHEET` | No | Alias table tab name |
| `ADOPTION_TIME_ZONE` | No | Reporting timezone |
| `ADOPTION_RUN_HOUR` | No | Reporting hour |
| `ADOPTION_RUN_MINUTE` | No | Reporting minute |
| `ADOPTION_SKIP_WEEKDAYS` | No | Weekday skip config |
| `ADOPTION_PER_RECIPIENT_EMAIL_ENABLED` | Email only | Enable report email |
| `ADOPTION_EMAIL_RECIPIENTS` | Email only | Approved recipient allowlist |

## Commands

```bash
npm run mentor:verify
npm run adoption:run -- --run-mode=manual
npm run adoption:run -- --run-mode=production
npm run adoption:test
```

## Production schedule

The production schedule has two Monday–Saturday reports:

- **18:15 Europe/Berlin — Operational Snapshot**: sends the HTML report and does not write `ADOPTION_HISTORY`.
- **22:30 Europe/Berlin — Final Daily Report**: sends the HTML report and is the only run that writes `ADOPTION_HISTORY`.

Railway cron is configured as:

```cron
15,30 16,17,20,21 * * 1-6
```

Railway evaluates cron in UTC, so the worker also has a Berlin-time guard. Invocations proceed only when they start within the configured grace window after 18:15 or 22:30 Europe/Berlin; the extra UTC candidate invocations exit without changing data. Sundays remain skipped.

## Deployment checklist

1. Configure Mentor credentials outside git.
2. Configure Apps Script properties.
3. Deploy Apps Script as a Web App.
4. Run lint and tests.
5. Verify Mentor connectivity.
6. Run a manual adoption execution.
7. Run a controlled email test.
8. Enable scheduled production only after local and mailbox checks pass.

## Rollback

1. Disable the scheduler.
2. Disable production email.
3. Revert the worker deployment.
4. Revert the Apps Script deployment.
5. Rotate exposed secrets if any were leaked.
