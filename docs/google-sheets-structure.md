# Google Sheets structure

The workbook schema is configurable. These are safe public defaults used by the demo implementation.

## `Adoption_Check`

Raw daily eMentor Shift Report import. The worker maps report rows to twelve columns:

1. First Name
2. Last Name
3. Vehicle Identifier
4. Begin Route Time
5. End Route Time
6. Total Worker Hours
7. Total Distance
8. Trip Count
9. Short Trip
10. Device
11. Is Supported?
12. Site

## `EXPECTED_DRIVERS`

Expected workers for the service date. A deployment can populate this tab from any planning source.

Typical demo columns:

- service date
- employee/person ID
- worker name
- site/site
- shift/status
- normalized key

## `ALIAS_TABLE`

Manual mapping between eMentor names and planning-system names.

## `ADOPTION_HISTORY`

Immutable daily production snapshots. Test and manual runs do not write history.

## `ADOPTION_EMAIL_DELIVERY`

One row per email submission attempt. This is a submission log, not definitive mailbox-delivery proof.

## Privacy rule

Do not commit workbook exports, real names, employee IDs, alias mappings, or screenshots with personal data.
