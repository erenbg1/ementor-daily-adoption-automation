# Google Sheets structure

The workbook remains the operational source of truth. This repository does not include private workbook IDs or production data.

## Required tabs

### `eMentor_Check`

Raw Mentor Shift Report import. The automation replaces columns A:L.

Expected columns:

1. First Name
2. Last Name
3. Vehicle Identifier
4. Begin Route Time
5. End Route Time
6. Total Driver Hours
7. Total Driver km
8. Trip
9. Short Trip
10. Device
11. Is Supported?
12. Station

### `EXPECTED_DRIVERS`

Expected working drivers generated from Resource Planning by the existing Apps Script trigger. The adoption endpoint only validates that the requested service date exists; it does not regenerate this sheet.

Typical fields include service date, employee/personnel ID, driver name, station, shift/status, and a normalized key.

### `ALIAS_TABLE`

Manually maintained mapping for name variations between Resource Planning and Mentor reports.

The matcher reads this table before fuzzy matching.

### `ADOPTION_HISTORY`

Immutable production snapshots. One row per service date.

Included values:

- Service date
- Generated timestamp
- Run mode
- Snapshot time
- Overall expected, checked, missing, adoption
- Station-level expected, checked, missing, adoption
- Missing driver names
- Unmatched names
- Extra Mentor drivers

Only `runMode="production"` may append to this sheet.

### `ADOPTION_EMAIL_DELIVERY`

One row per email submission attempt.

Included values:

- Service date
- Recipient name
- Recipient email
- Attempt timestamp
- GmailApp call result
- Remaining quota field
- Status
- Run mode
- Subject
- Error message

This is a submission log. Use Gmail/Workspace logs for definitive mailbox delivery confirmation.

## Station handling

The current workflow separates station results inside the existing matcher. The public sample refers to `STATION_A` and `STATION_B` as example station codes because those are part of the current matching implementation.

## Data privacy

Do not commit:

- Real workbook exports
- Driver names
- Employee IDs
- Alias tables from production
- Screenshots containing personal data
