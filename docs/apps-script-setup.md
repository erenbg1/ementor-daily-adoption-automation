# Apps Script setup

## Files

Copy these files into the Apps Script project attached to your adoption workbook:

- `apps-script/ementor.gs`
- `apps-script/adoption.gs`

Keep any existing manually used menu functions in `ementor.gs`. The adoption endpoint calls the matcher headlessly but does not replace the manual workflow.

## Script properties

Set these properties in Apps Script project settings:

| Property | Required | Description |
| --- | --- | --- |
| `EMENTOR_ADOPTION_SPREADSHEET_ID` | Yes | Google Sheet ID for the adoption workbook |
| `EMENTOR_ADOPTION_SHARED_SECRET` | Yes | Long random secret shared with Railway |
| `EMENTOR_ADOPTION_PER_RECIPIENT_EMAIL_ENABLED` | Production email only | Set to `true` only after delivery tests pass |
| `EMENTOR_ADOPTION_EMAIL_RECIPIENTS` | Production email only | Comma- or newline-separated recipients, for example `Operations Lead <ops-lead@example.com>` |

Do not store these values in git.

## Web App deployment

1. Open Apps Script.
2. Deploy as a Web App.
3. Execute as the account that owns the Gmail/Workspace mailbox used for reports.
4. Grant required scopes for Sheets and Gmail.
5. Copy the Web App URL into Railway as `EMENTOR_ADOPTION_WEB_APP_URL`.

The Web App endpoint validates a shared-secret HMAC signature before changing workbook data.

## Gmail authorization

The production email path uses `GmailApp.sendEmail()`. The executing Apps Script account must authorize Gmail access before production email can work.

Verify:

- The executing account is the intended sender.
- A test report appears in Sent.
- Test recipients receive the email.
- No bounce is generated.

## Run modes

| Mode | Replaces raw report | Runs matcher | Writes history | Sends production recipients |
| --- | --- | --- | --- | --- |
| `test` | Yes | Yes | No | No |
| `manual` | Yes | Yes | No | No |
| `production` | Yes | Yes | Yes, once per service date | Yes, when enabled and not Sunday |
