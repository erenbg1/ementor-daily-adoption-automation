const ADOPTION_SPREADSHEET_ID_PROPERTY = "ADOPTION_SPREADSHEET_ID";
const ADOPTION_TIME_ZONE_PROPERTY = "ADOPTION_TIME_ZONE";
const ADOPTION_RUN_HOUR_PROPERTY = "ADOPTION_RUN_HOUR";
const ADOPTION_RUN_MINUTE_PROPERTY = "ADOPTION_RUN_MINUTE";
const ADOPTION_SKIP_WEEKDAYS_PROPERTY = "ADOPTION_SKIP_WEEKDAYS";
const ADOPTION_RAW_IMPORT_SHEET_PROPERTY = "ADOPTION_RAW_IMPORT_SHEET";
const ADOPTION_EXPECTED_SHEET_PROPERTY = "ADOPTION_EXPECTED_SHEET";
const ADOPTION_DEFAULT_TIME_ZONE = "Europe/Berlin";
const ADOPTION_DEFAULT_OPERATIONAL_RUN_HOUR = 18;
const ADOPTION_DEFAULT_OPERATIONAL_RUN_MINUTE = 15;
const ADOPTION_DEFAULT_FINAL_RUN_HOUR = 22;
const ADOPTION_DEFAULT_FINAL_RUN_MINUTE = 30;
const ADOPTION_DEFAULT_SKIP_WEEKDAYS = "0";
const ADOPTION_FINAL_SNAPSHOT_TYPE = "final";
const ADOPTION_OPERATIONAL_SNAPSHOT_TYPE = "operational";
const ADOPTION_DEFAULT_RAW_IMPORT_SHEET = "Adoption_Check";
const ADOPTION_DEFAULT_EXPECTED_SHEET = "EXPECTED_DRIVERS";
const ADOPTION_HEADERS = [
  "First Name",
  "Last Name",
  "Vehicle Identifier",
  "Begin Route Time",
  "End Route Time",
  "Total Driver Hours",
  "Total Driver km",
  "Trip",
  "Short Trip",
  "Device",
  "Is Supported?",
  "Site"
];
const ADOPTION_HISTORY_SHEET = "ADOPTION_HISTORY";
const ADOPTION_EMAIL_DELIVERY_SHEET = "ADOPTION_EMAIL_DELIVERY";
const ADOPTION_PER_RECIPIENT_EMAIL_ENABLED_PROPERTY = "ADOPTION_PER_RECIPIENT_EMAIL_ENABLED";
const ADOPTION_EMAIL_RECIPIENTS_PROPERTY = "ADOPTION_EMAIL_RECIPIENTS";
const ADOPTION_EMAIL_RECIPIENTS = [
  "Operations Lead <ops-lead@example.com>",
  "Dispatcher <dispatcher@example.com>",
  "Site Manager <site-manager@example.com>"
];
const ADOPTION_EMAIL_DELIVERY_HEADERS = [
  "Service Date",
  "Recipient Name",
  "Recipient Email",
  "Attempted At",
  "GmailApp Call Result",
  "Remaining Quota After Send",
  "Status",
  "Run Mode",
  "Subject",
  "Error Message"
];
const ADOPTION_TEST_EMAIL_RECIPIENTS = [
  { name: "Test Recipient", email: "test-recipient@example.com" }
];
const ADOPTION_HISTORY_HEADERS = [
  "Service Date",
  "Generated At",
  "Run Mode",
  "Snapshot Time",
  "Overall Expected",
  "Overall Checked",
  "Overall Missing",
  "Overall Adoption",
  "SITE_A Expected",
  "SITE_A Checked",
  "SITE_A Missing",
  "SITE_A Adoption",
  "SITE_A Missing Drivers",
  "SITE_A Unmatched Names",
  "SITE_A Extra Mentor Drivers",
  "SITE_B Expected",
  "SITE_B Checked",
  "SITE_B Missing",
  "SITE_B Adoption",
  "SITE_B Missing Drivers",
  "SITE_B Unmatched Names",
  "SITE_B Extra Mentor Drivers"
];

function doPost(e) {
  let lock = null;

  try {
    const rawBody = e && e.postData && e.postData.contents;
    if (!rawBody) throw new Error("Request body is required.");

    const payload = JSON.parse(rawBody);
    validateAdoptionSignature_(payload);
    const action = String(payload.action || "adoption.run");

    if (action === "adoption.snapshot.get") {
      const serviceDate = validateServiceDateValue_(payload.serviceDate);
      const ss = openAdoptionSpreadsheet_();
      return jsonResponse_(getAdoptionSnapshot_(ss, serviceDate));
    }

    if (action === "email.test.sendPerRecipient") {
      const serviceDate = validateServiceDateValue_(payload.serviceDate);
      lock = LockService.getScriptLock();
      if (!lock.tryLock(30000)) {
        throw new Error("Another adoption run is already in progress.");
      }

      const ss = openAdoptionSpreadsheet_();
      const summary = getAdoptionSnapshot_(ss, serviceDate);
      const submissionSummary = sendAdoptionEmailPerRecipient_(ss, summary, ADOPTION_TEST_EMAIL_RECIPIENTS, "test");
      summary.emailSubmission = submissionSummary;
      summary.emailDelivery = getEmailDeliveryLog_(ss, serviceDate);
      return jsonResponse_(summary);
    }

    if (action !== "adoption.run") {
      throw new Error("Unsupported adoption action: " + action);
    }

    const serviceDate = String(payload.serviceDate || "");
    const runMode = String(payload.runMode || "");
    const snapshotType = validateSnapshotType_(payload.snapshotType || ADOPTION_FINAL_SNAPSHOT_TYPE);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) {
      throw new Error("serviceDate must use YYYY-MM-DD format.");
    }
    if (serviceDate !== todayReportingDate_()) {
      throw new Error("serviceDate must match today's configured reporting date.");
    }
    if (!Array.isArray(payload.rows)) {
      throw new Error("rows must be an array.");
    }
    validateRunMode_(runMode);

    lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) {
      throw new Error("Another adoption run is already in progress.");
    }

    const ss = openAdoptionSpreadsheet_();
    validateExpectedDriversDate_(ss, serviceDate);
    replaceAdoptionCheck_(ss, payload.rows);

    const summary = buildAdoptionSummary_(ss, serviceDate);
    summary.generatedAt = new Date().toISOString();
    summary.runMode = runMode;
    summary.snapshotType = snapshotType;
    summary.snapshotTime = snapshotTimeLabel_(snapshotType);
    summary.history = {
      snapshotCreated: false
    };
    if (runMode === "production") {
      if (snapshotType === ADOPTION_FINAL_SNAPSHOT_TYPE) {
        const snapshotCreated = persistAdoptionHistory_(ss, summary);
        summary.history.snapshotCreated = snapshotCreated;
        summary.emailSubmission = snapshotCreated
          ? maybeSendProductionAdoptionEmail_(ss, summary)
          : {
            action: "EMAIL_SKIPPED_EXISTING_HISTORY_SNAPSHOT",
            recipients: []
          };
      } else {
        summary.emailSubmission = maybeSendProductionAdoptionEmail_(ss, summary);
      }
    }
    attachAdoptionEmail_(summary);
    summary.emailDelivery = getEmailDeliveryLog_(ss, serviceDate);
    return jsonResponse_(summary);
  } catch (error) {
    return jsonResponse_({ error: String(error && error.message ? error.message : error) });
  } finally {
    if (lock) lock.releaseLock();
  }
}

function validateAdoptionSignature_(payload) {
  const secret = PropertiesService.getScriptProperties().getProperty("ADOPTION_SHARED_SECRET");
  if (!secret) throw new Error("ADOPTION_SHARED_SECRET is not configured.");

  const signedBody = buildAdoptionSignedBody_(payload);
  const encodedBody = Utilities.base64Encode(signedBody, Utilities.Charset.UTF_8);
  const expected = bytesToHex_(Utilities.computeHmacSha256Signature(encodedBody, secret));
  const supplied = String(payload.signature || "").toLowerCase();

  if (!constantTimeEqual_(expected, supplied)) {
    throw new Error("Invalid request signature.");
  }
}

function buildAdoptionSignedBody_(payload) {
  const action = String(payload.action || "adoption.run");
  if (action === "adoption.snapshot.get") {
    return JSON.stringify({
      action: action,
      serviceDate: payload.serviceDate
    });
  }
  if (action === "email.test.sendPerRecipient") {
    return JSON.stringify({
      action: action,
      serviceDate: payload.serviceDate
    });
  }
  return JSON.stringify({
    serviceDate: payload.serviceDate,
    runMode: payload.runMode,
    snapshotType: payload.snapshotType,
    rows: payload.rows
  });
}

function validateRunMode_(runMode) {
  if (["test", "manual", "production"].indexOf(runMode) === -1) {
    throw new Error("runMode must be test, manual or production.");
  }
}

function validateSnapshotType_(snapshotType) {
  if ([ADOPTION_OPERATIONAL_SNAPSHOT_TYPE, ADOPTION_FINAL_SNAPSHOT_TYPE].indexOf(snapshotType) === -1) {
    throw new Error("snapshotType must be operational or final.");
  }
  return snapshotType;
}

function openAdoptionSpreadsheet_() {
  const spreadsheetId = PropertiesService.getScriptProperties()
    .getProperty(ADOPTION_SPREADSHEET_ID_PROPERTY);
  if (!spreadsheetId) {
    throw new Error(ADOPTION_SPREADSHEET_ID_PROPERTY + " is not configured.");
  }
  return SpreadsheetApp.openById(spreadsheetId);
}

function validateServiceDateValue_(serviceDate) {
  const value = String(serviceDate || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("serviceDate must use YYYY-MM-DD format.");
  }
  return value;
}

function validateExpectedDriversDate_(ss, serviceDate) {
  const expectedSheetName = getScriptProperty_(ADOPTION_EXPECTED_SHEET_PROPERTY, ADOPTION_DEFAULT_EXPECTED_SHEET);
  const sheet = ss.getSheetByName(expectedSheetName);
  if (!sheet) throw new Error(expectedSheetName + " sheet is missing.");
  if (sheet.getLastRow() < 2) {
    throw new Error(expectedSheetName + " does not contain today's date: " + serviceDate);
  }

  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  const found = values.some(function(row) {
    return sheetDateKey_(row[0]) === serviceDate;
  });

  if (!found) {
    throw new Error(expectedSheetName + " does not contain today's date: " + serviceDate);
  }
}

function replaceAdoptionCheck_(ss, rows) {
  const rawImportSheetName = getScriptProperty_(ADOPTION_RAW_IMPORT_SHEET_PROPERTY, ADOPTION_DEFAULT_RAW_IMPORT_SHEET);
  const sheet = ss.getSheetByName(rawImportSheetName);
  if (!sheet) throw new Error(rawImportSheetName + " sheet is missing.");

  const normalizedRows = rows.map(function(row, index) {
    if (!Array.isArray(row)) {
      throw new Error("Shift Report row " + (index + 1) + " is not an array.");
    }
    const values = row.slice(0, 12);
    while (values.length < 12) values.push("");
    return values;
  });

  const requiredRows = normalizedRows.length + 1;
  if (requiredRows > sheet.getMaxRows()) {
    sheet.insertRowsAfter(sheet.getMaxRows(), requiredRows - sheet.getMaxRows());
  }

  sheet.getRange(1, 1, sheet.getMaxRows(), 12).clearContent();
  sheet.getRange(1, 1, 1, 12).setValues([ADOPTION_HEADERS]);
  if (normalizedRows.length) {
    sheet.getRange(2, 1, normalizedRows.length, 12).setValues(normalizedRows);
  }
}

function persistAdoptionHistory_(ss, summary) {
  let sheet = ss.getSheetByName(ADOPTION_HISTORY_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(ADOPTION_HISTORY_SHEET);
  }
  sheet.getRange(1, 1, 1, ADOPTION_HISTORY_HEADERS.length)
    .setValues([ADOPTION_HISTORY_HEADERS]);

  if (sheet.getLastRow() > 1) {
    const existingDates = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    const alreadyStored = existingDates.some(function(row) {
      return sheetDateKey_(row[0]) === summary.serviceDate;
    });
    if (alreadyStored) return false;
  }

  const siteA = summary.sites.SITE_A;
  const siteB = summary.sites.SITE_B;
  const overallExpected = siteA.expectedDrivers + siteB.expectedDrivers;
  const overallChecked = siteA.driversWithCheck + siteB.driversWithCheck;
  const overallMissing = overallExpected - overallChecked;
  const overallAdoption = overallExpected ? overallChecked / overallExpected : 0;

  sheet.appendRow([
    summary.serviceDate,
    summary.generatedAt,
    summary.runMode,
    summary.snapshotTime,
    overallExpected,
    overallChecked,
    overallMissing,
    overallAdoption,
    siteA.expectedDrivers,
    siteA.driversWithCheck,
    siteA.expectedDrivers - siteA.driversWithCheck,
    siteA.adoptionRate,
    JSON.stringify(siteA.missingDrivers || []),
    JSON.stringify(siteA.unmatchedNames || []),
    JSON.stringify(siteA.extraMentorDrivers || []),
    siteB.expectedDrivers,
    siteB.driversWithCheck,
    siteB.expectedDrivers - siteB.driversWithCheck,
    siteB.adoptionRate,
    JSON.stringify(siteB.missingDrivers || []),
    JSON.stringify(siteB.unmatchedNames || []),
    JSON.stringify(siteB.extraMentorDrivers || [])
  ]);
  return true;
}

function isSkippedServiceDate_(serviceDate) {
  const weekday = new Date(serviceDate + "T12:00:00Z").getUTCDay();
  return getSkippedWeekdays_().indexOf(weekday) !== -1;
}

function attachAdoptionEmail_(summary) {
  summary.email = {
    subject: adoptionEmailSubject_(summary),
    textBody: buildAdoptionEmailText_(summary),
    htmlBody: buildAdoptionEmailHtml_(summary),
    recipients: getAdoptionEmailRecipients_()
  };
  return summary;
}

function adoptionEmailSubject_(summary) {
  return summary.snapshotType === ADOPTION_OPERATIONAL_SNAPSHOT_TYPE
    ? "eMentor Operational Snapshot — " + summary.serviceDate + " — 18:15"
    : "eMentor Final Daily Report — " + summary.serviceDate + " — 22:30";
}

function getAdoptionEmailRecipients_() {
  const configuredRecipients = PropertiesService.getScriptProperties()
    .getProperty(ADOPTION_EMAIL_RECIPIENTS_PROPERTY);
  const recipients = configuredRecipients
    ? configuredRecipients.split(/\n|,/).map(function(recipient) { return recipient.trim(); }).filter(Boolean)
    : ADOPTION_EMAIL_RECIPIENTS;

  return recipients.map(function(recipient) {
    const value = String(recipient || "").trim();
    const match = value.match(/^(.*?)\s*<\s*([^<>]+)\s*>$/);
    if (match) {
      return {
        name: match[1].trim(),
        email: match[2].trim()
      };
    }
    return {
      name: value,
      email: value
    };
  }).filter(function(recipient) {
    return Boolean(recipient.email);
  });
}

function getAdoptionSnapshot_(ss, serviceDate) {
  const sheet = ss.getSheetByName(ADOPTION_HISTORY_SHEET);
  if (!sheet || sheet.getLastRow() < 2) {
    throw new Error("ADOPTION_HISTORY does not contain service date: " + serviceDate);
  }

  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, ADOPTION_HISTORY_HEADERS.length).getValues();
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    if (sheetDateKey_(row[0]) !== serviceDate) continue;

    const summary = {
        serviceDate: serviceDate,
        generatedAt: String(row[1] || ""),
        runMode: String(row[2] || "production"),
        snapshotType: ADOPTION_FINAL_SNAPSHOT_TYPE,
        snapshotTime: String(row[3] || snapshotTimeLabel_(ADOPTION_FINAL_SNAPSHOT_TYPE)),
        history: {
          snapshotCreated: false,
          reusedExistingSnapshot: true
        },
        sites: {
          SITE_A: {
            expectedDrivers: Number(row[8] || 0),
            driversWithCheck: Number(row[9] || 0),
            missingDrivers: parseJsonArray_(row[12]),
            unmatchedNames: parseJsonArray_(row[13]),
            extraMentorDrivers: parseJsonArray_(row[14]),
            adoptionRate: Number(row[11] || 0)
          },
          SITE_B: {
            expectedDrivers: Number(row[15] || 0),
            driversWithCheck: Number(row[16] || 0),
            missingDrivers: parseJsonArray_(row[19]),
            unmatchedNames: parseJsonArray_(row[20]),
            extraMentorDrivers: parseJsonArray_(row[21]),
            adoptionRate: Number(row[18] || 0)
          }
        }
    };
    attachAdoptionEmail_(summary);
    summary.emailDelivery = getEmailDeliveryLog_(ss, serviceDate);
    return summary;
  }

  throw new Error("ADOPTION_HISTORY does not contain service date: " + serviceDate);
}

function parseJsonArray_(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function getEmailDeliverySheet_(ss) {
  let sheet = ss.getSheetByName(ADOPTION_EMAIL_DELIVERY_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(ADOPTION_EMAIL_DELIVERY_SHEET);
  }
  sheet.getRange(1, 1, 1, ADOPTION_EMAIL_DELIVERY_HEADERS.length)
    .setValues([ADOPTION_EMAIL_DELIVERY_HEADERS]);
  return sheet;
}

function getEmailDeliveryLog_(ss, serviceDate) {
  const sheet = ss.getSheetByName(ADOPTION_EMAIL_DELIVERY_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, ADOPTION_EMAIL_DELIVERY_HEADERS.length).getValues();
  const records = [];
  values.forEach(function(row, index) {
    if (sheetDateKey_(row[0]) !== serviceDate) return;
    records.push({
      serviceDate: serviceDate,
      recipientName: String(row[1] || ""),
      recipientEmail: String(row[2] || ""),
      attemptedAt: String(row[3] || ""),
      mailAppCallResult: String(row[4] || ""),
      remainingQuotaAfterSend: row[5],
      status: String(row[6] || ""),
      runMode: String(row[7] || ""),
      subject: String(row[8] || ""),
      errorMessage: String(row[9] || ""),
      _rowNumber: index + 2
    });
  });
  return records;
}

function emailDeliveryRecordToRow_(record) {
  return [
    record.serviceDate,
    record.recipientName,
    record.recipientEmail,
    record.attemptedAt,
    record.mailAppCallResult,
    record.remainingQuotaAfterSend,
    record.status,
    record.runMode,
    record.subject,
    record.errorMessage
  ];
}

function appendEmailDeliveryRecord_(ss, record) {
  const sheet = getEmailDeliverySheet_(ss);
  sheet.appendRow(emailDeliveryRecordToRow_(record));
}

function maybeSendProductionAdoptionEmail_(ss, summary) {
  if (isSkippedServiceDate_(summary.serviceDate)) {
    return {
      action: "EMAIL_SKIPPED_CONFIGURED_WEEKDAY",
      recipients: []
    };
  }

  const enabled = PropertiesService.getScriptProperties()
    .getProperty(ADOPTION_PER_RECIPIENT_EMAIL_ENABLED_PROPERTY);
  if (String(enabled || "").toLowerCase() !== "true") {
    return {
      action: "EMAIL_SKIPPED_DISABLED",
      recipients: []
    };
  }

  return sendAdoptionEmailPerRecipient_(ss, summary, getAdoptionEmailRecipients_(), "production");
}

function sendAdoptionEmailPerRecipient_(ss, summary, recipients, runMode) {
  attachAdoptionEmail_(summary);
  const subject = summary.email.subject;
  const body = summary.email.textBody;
  const htmlBody = summary.email.htmlBody;
  const results = [];

  recipients.forEach(function(recipient) {
    const bareEmail = String(recipient.email || "").trim();
    const attemptedAt = new Date().toISOString();
    let mailAppCallResult = "success";
    let status = "submitted";
    let errorMessage = "";

    try {
      GmailApp.sendEmail(bareEmail, subject, body, {
        htmlBody: htmlBody
      });
    } catch (error) {
      mailAppCallResult = "error";
      status = "failed";
      errorMessage = String(error && error.message ? error.message : error);
    }

    const record = {
      serviceDate: summary.serviceDate,
      recipientName: String(recipient.name || "").trim(),
      recipientEmail: bareEmail,
      attemptedAt: attemptedAt,
      mailAppCallResult: mailAppCallResult,
      remainingQuotaAfterSend: getRemainingMailAppQuota_(),
      status: status,
      runMode: runMode,
      subject: subject,
      errorMessage: errorMessage
    };
    appendEmailDeliveryRecord_(ss, record);
    results.push(record);
  });

  return {
    action: "EMAIL_PER_RECIPIENT_SUBMISSION_COMPLETE",
    recipients: results,
    failures: results.filter(function(record) {
      return record.mailAppCallResult !== "success";
    })
  };
}

function getRemainingMailAppQuota_() {
  return "";
}

function buildAdoptionEmailText_(summary) {
  const siteA = summary.sites.SITE_A;
  const siteB = summary.sites.SITE_B;
  const expected = siteA.expectedDrivers + siteB.expectedDrivers;
  const checked = siteA.driversWithCheck + siteB.driversWithCheck;
  const adoption = expected ? checked / expected : 0;

  return [
    "eMentor Daily Adoption Report",
    "Service Date: " + summary.serviceDate,
    "Snapshot: " + snapshotLabel_(summary.snapshotType),
    "",
    checked + " of " + expected + " expected drivers completed their eMentor Check today (" + formatAdoptionPercent_(adoption) + " overall adoption).",
    "",
    formatSiteEmailText_("SITE_A", siteA),
    "",
    formatSiteEmailText_("SITE_B", siteB),
    "",
    "Generated automatically on",
    formatGeneratedAt_(summary.generatedAt) + " " + getReportingTimeZone_()
  ].concat(operationalSnapshotNote_(summary.snapshotType) ? ["", operationalSnapshotNote_(summary.snapshotType)] : []).join("\n");
}

function formatSiteEmailText_(site, summary) {
  const missingDrivers = sortedDriverNames_(summary.missingDrivers);
  return [
    site,
    "Expected Drivers: " + summary.expectedDrivers,
    "Drivers with eMentor Check: " + summary.driversWithCheck,
    "Missing Drivers: " + (summary.expectedDrivers - summary.driversWithCheck),
    "Adoption Rate: " + formatAdoptionPercent_(summary.adoptionRate),
    "",
    "Drivers without eMentor Check:",
    missingDrivers.length ? missingDrivers.map(function(name) { return "- " + name; }).join("\n") : "- None"
  ].join("\n");
}

function buildAdoptionEmailHtml_(summary) {
  const siteA = summary.sites.SITE_A;
  const siteB = summary.sites.SITE_B;
  const overallExpected = siteA.expectedDrivers + siteB.expectedDrivers;
  const overallChecked = siteA.driversWithCheck + siteB.driversWithCheck;
  const overallRate = overallExpected ? overallChecked / overallExpected : 0;
  const executiveSummary = overallChecked + " of " + overallExpected +
    " expected drivers completed their eMentor Check today (" +
    formatAdoptionPercent_(overallRate) + " overall adoption).";

  return '<!doctype html><html><body style="margin:0;background:#f4f6f8;color:#17212b;font-family:Arial,Helvetica,sans-serif;">' +
    '<div style="max-width:680px;margin:0 auto;padding:24px 12px;">' +
    '<div style="background:#ffffff;border:1px solid #e3e8ee;border-radius:10px;padding:30px;">' +
    '<h1 style="font-size:26px;line-height:1.25;margin:0 0 6px;">eMentor Daily Adoption Report</h1>' +
    '<div style="font-size:14px;color:#5c6773;margin-bottom:10px;">Service Date: <strong>' + escapeAdoptionHtml_(summary.serviceDate) + '</strong></div>' +
    '<div style="font-size:13px;color:#5c6773;margin-bottom:10px;">Snapshot: <strong>' + escapeAdoptionHtml_(snapshotLabel_(summary.snapshotType)) + '</strong></div>' +
    '<div style="font-size:15px;line-height:1.5;color:#374151;margin-bottom:28px;">' + escapeAdoptionHtml_(executiveSummary) + '</div>' +
    formatSiteEmailHtml_("OVERALL", {
      expectedDrivers: overallExpected,
      driversWithCheck: overallChecked,
      missingDrivers: [],
      adoptionRate: overallRate
    }, false, "#6b7280", "#f3f4f6") +
    '<hr style="border:0;border-top:1px solid #dfe4ea;margin:30px 0;">' +
    formatSiteEmailHtml_("SITE_A", siteA, true, "#2474c6", "#f2f7fc") +
    '<hr style="border:0;border-top:1px solid #dfe4ea;margin:30px 0;">' +
    formatSiteEmailHtml_("SITE_B", siteB, true, "#2e7d32", "#f2f8f2") +
    '<hr style="border:0;border-top:1px solid #dfe4ea;margin:30px 0 24px;">' +
    '<h2 style="font-size:18px;margin:0 0 10px;">Notes</h2>' +
    '<p style="font-size:13px;line-height:1.55;color:#5c6773;margin:0 0 10px;">This report compares today\'s Resource Planning expected drivers with today\'s eMentor Shift Report.</p>' +
    (operationalSnapshotNote_(summary.snapshotType) ? '<p style="font-size:13px;line-height:1.55;color:#5c6773;margin:0 0 10px;">' + escapeAdoptionHtml_(operationalSnapshotNote_(summary.snapshotType)) + '</p>' : "") +
    '<p style="font-size:13px;line-height:1.55;color:#5c6773;margin:0 0 20px;">Drivers who were planned but did not actually receive a route (for example due to sick leave, no-show or last-minute operational changes) may appear in the missing list and should be verified by the dispatcher before taking action.</p>' +
    '<div style="font-size:12px;line-height:1.5;color:#7b8490;border-top:1px solid #eef1f4;padding-top:16px;">Generated automatically on<br><strong>' +
    escapeAdoptionHtml_(formatGeneratedAt_(summary.generatedAt) + " " + getReportingTimeZone_()) + '</strong></div>' +
    '</div></div></body></html>';
}

function formatSiteEmailHtml_(site, summary, includeMissingDrivers, accent, background) {
  const missingDrivers = sortedDriverNames_(summary.missingDrivers);
  const missingCount = summary.expectedDrivers - summary.driversWithCheck;
  const missingList = missingDrivers.length
    ? '<ul style="margin:8px 0 0;padding-left:20px;font-size:14px;line-height:1.7;">' +
      missingDrivers.map(function(name) { return "<li>" + escapeAdoptionHtml_(name) + "</li>"; }).join("") + "</ul>"
    : '<div style="font-size:14px;color:#5c6773;margin-top:8px;">None</div>';

  return '<section><h2 style="font-size:21px;line-height:1.3;margin:0 0 16px;color:' + accent + ';">' + site + '</h2>' +
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;"><tr>' +
    formatAdoptionKpiCell_("Expected Drivers", summary.expectedDrivers, accent, background) +
    formatAdoptionKpiCell_("With Check", summary.driversWithCheck, accent, background) +
    formatAdoptionKpiCell_("Missing", missingCount, accent, background) +
    formatAdoptionKpiCell_("Adoption", formatAdoptionPercent_(summary.adoptionRate), accent, background) +
    '</tr></table>' +
    (includeMissingDrivers ? '<div style="font-size:14px;font-weight:bold;margin-top:20px;">Drivers without eMentor Check</div>' + missingList : "") +
    '</section>';
}

function formatAdoptionKpiCell_(label, value, accent, background) {
  return '<td width="25%" valign="top" style="padding:12px 8px;border-left:3px solid ' + accent + ';background:' + background + ';">' +
    '<div style="font-size:12px;line-height:1.3;color:#687480;">' + label + '</div>' +
    '<div style="font-size:20px;line-height:1.3;font-weight:bold;margin-top:4px;">' + value + '</div></td>';
}

function sortedDriverNames_(names) {
  return (Array.isArray(names) ? names : [])
    .map(function(name) { return String(name).trim(); })
    .sort(function(a, b) { return a.localeCompare(b); });
}

function formatGeneratedAt_(generatedAt) {
  return Utilities.formatDate(new Date(generatedAt), getReportingTimeZone_(), "dd MMM yyyy, HH:mm");
}

function formatAdoptionPercent_(rate) {
  return (Number(rate || 0) * 100).toFixed(1) + "%";
}

function escapeAdoptionHtml_(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function todayReportingDate_() {
  return Utilities.formatDate(new Date(), getReportingTimeZone_(), "yyyy-MM-dd");
}

function sheetDateKey_(value) {
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, getReportingTimeZone_(), "yyyy-MM-dd");
  }

  const text = String(value || "").trim();
  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return match[1] + "-" + match[2] + "-" + match[3];

  match = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (match) return match[3] + "-" + match[2] + "-" + match[1];

  return "";
}

function bytesToHex_(bytes) {
  return bytes.map(function(value) {
    const unsigned = value < 0 ? value + 256 : value;
    return ("0" + unsigned.toString(16)).slice(-2);
  }).join("");
}

function constantTimeEqual_(a, b) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function jsonResponse_(body) {
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}

function getScriptProperty_(name, fallback) {
  const value = PropertiesService.getScriptProperties().getProperty(name);
  return value ? String(value).trim() : fallback;
}

function getReportingTimeZone_() {
  return getScriptProperty_(ADOPTION_TIME_ZONE_PROPERTY, ADOPTION_DEFAULT_TIME_ZONE);
}

function getSnapshotRunHour_(snapshotType) {
  const fallback = snapshotType === ADOPTION_OPERATIONAL_SNAPSHOT_TYPE
    ? ADOPTION_DEFAULT_OPERATIONAL_RUN_HOUR
    : ADOPTION_DEFAULT_FINAL_RUN_HOUR;
  const propertyFallback = snapshotType === ADOPTION_FINAL_SNAPSHOT_TYPE
    ? getScriptProperty_(ADOPTION_RUN_HOUR_PROPERTY, String(fallback))
    : String(fallback);
  const value = Number(propertyFallback);
  return Number.isFinite(value) ? value : fallback;
}

function getSnapshotRunMinute_(snapshotType) {
  const fallback = snapshotType === ADOPTION_OPERATIONAL_SNAPSHOT_TYPE
    ? ADOPTION_DEFAULT_OPERATIONAL_RUN_MINUTE
    : ADOPTION_DEFAULT_FINAL_RUN_MINUTE;
  const propertyFallback = snapshotType === ADOPTION_FINAL_SNAPSHOT_TYPE
    ? getScriptProperty_(ADOPTION_RUN_MINUTE_PROPERTY, String(fallback))
    : String(fallback);
  const value = Number(propertyFallback);
  return Number.isFinite(value) ? value : fallback;
}

function getSkippedWeekdays_() {
  return getScriptProperty_(ADOPTION_SKIP_WEEKDAYS_PROPERTY, ADOPTION_DEFAULT_SKIP_WEEKDAYS)
    .split(",")
    .map(function(value) { return Number(String(value).trim()); })
    .filter(function(value) { return Number.isInteger(value) && value >= 0 && value <= 6; });
}

function snapshotTimeLabel_(snapshotType) {
  return ("0" + getSnapshotRunHour_(snapshotType)).slice(-2) + ":" + ("0" + getSnapshotRunMinute_(snapshotType)).slice(-2) + " " + getReportingTimeZone_();
}

function snapshotLabel_(snapshotType) {
  return snapshotType === ADOPTION_OPERATIONAL_SNAPSHOT_TYPE
    ? "Operational Snapshot (18:15)"
    : "Final Daily Report (22:30)";
}

function operationalSnapshotNote_(snapshotType) {
  return snapshotType === ADOPTION_OPERATIONAL_SNAPSHOT_TYPE
    ? "Operational snapshot: later waves, especially SD-C, may still be in progress. The 22:30 Final Daily Report is the official end-of-day snapshot."
    : "";
}
