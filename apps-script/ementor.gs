function normKey(v) {
  return String(v || '')
    .toUpperCase()
    .replace(/[ĐÐ]/g, 'D')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\bDJ/g, 'D');
}

function normalizeStation(s) {
  return String(s || '').replace(/\s+/g, '').toUpperCase();
}

function tokenize(name) {
  return normKey(name).split(' ').filter(Boolean);
}

function isSamePerson(a, b) {
  let A = tokenize(a);
  let B = tokenize(b);

  let short = A.length <= B.length ? A : B;
  let long = A.length > B.length ? A : B;

  let match = 0;

  for (let t of short) {
    let found = false;
    for (let l of long) {
      if (t === l) { found = true; break; }

      let s = t.length < l.length ? t : l;
      let lo = t.length < l.length ? l : t;
      if (s.length >= 4 && lo.startsWith(s)) { found = true; break; }

      let threshold = Math.min(t.length, l.length) <= 4 ? 0.6 : 0.65;
      if (levenSim(t, l) >= threshold) { found = true; break; }
    }
    if (found) match++;
  }

  return match === short.length;
}

function levenSim(a, b) {
  a = a.replace(/\s/g, '');
  b = b.replace(/\s/g, '');

  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  let distance = matrix[b.length][a.length];
  let maxLen = Math.max(a.length, b.length);
  return 1 - distance / maxLen;
}

function getAliasMap(ss) {
  ss = ss || SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName("ALIAS_TABLE");
  if (!sheet) return {};

  const data = sheet.getDataRange().getValues();
  let map = {};

  for (let i = 1; i < data.length; i++) {
    let raw = normKey(data[i][0]);
    let correct = normKey(data[i][1]);
    if (raw && correct) {
      map[raw] = correct;
    }
  }
  return map;
}

function addAlias(raw, correct, ss) {
  ss = ss || SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName("ALIAS_TABLE");
  if (!sheet) {
    sheet = ss.insertSheet("ALIAS_TABLE");
    sheet.getRange(1, 1, 1, 2).setValues([["Raw Name", "Correct Name"]]);
  }
  sheet.appendRow([normKey(raw), normKey(correct)]);
}

function runEMentorMatcher_(ss, filterStation, interactive) {
  const em = ss.getSheetByName("eMentor_Check").getDataRange().getValues();
  const ex = ss.getSheetByName("EXPECTED_DRIVERS").getDataRange().getValues();

  let aliasMap = getAliasMap(ss);
  let actual = [];
  let actualRecords = [];
  let handled = new Set();

  for (let i = 1; i < em.length; i++) {
    let fn = em[i][0];
    let ln = em[i][1];
    if (!fn || !ln) continue;

    let raw = fn + " " + ln;
    let key = normKey(raw);
    if (aliasMap[key]) key = aliasMap[key];

    actual.push(key);
    actualRecords.push({
      key: key,
      rawName: String(raw).trim(),
      station: normalizeStation(em[i][11])
    });
  }

  let stationA = [];
  let stationB = [];
  let expected = { STATION_A: new Map(), STATION_B: new Map() };
  let matched = { STATION_A: new Set(), STATION_B: new Set() };
  let unmatchedNames = { STATION_A: [], STATION_B: [] };
  let unmatchedActualKeys = new Set();

  for (let i = 1; i < ex.length; i++) {
    let name = ex[i][2];
    let station = normalizeStation(ex[i][3]);
    if (filterStation && station !== filterStation) continue;

    let expectedKey = normKey(name);
    if (expected[station] && expectedKey && !expected[station].has(expectedKey)) {
      expected[station].set(expectedKey, name);
    }

    let found = false;

    for (let a of actual) {
      if (isSamePerson(a, expectedKey)) {
        found = true;
        break;
      }
    }

    if (!found) {
      let best = null;
      let bestScore = 0;

      for (let a of actual) {
        let score = levenSim(a, expectedKey);
        if (score > bestScore) {
          bestScore = score;
          best = a;
        }
      }

      let aliasValid = false;
      if (best) {
        let bestTokens = tokenize(best);
        let expectedTokens = tokenize(expectedKey);

        let lastB = bestTokens[bestTokens.length - 1];
        let lastE = expectedTokens[expectedTokens.length - 1];
        let lastTokenMatch = levenSim(lastB, lastE) >= 0.75;

        let commonCount = bestTokens.filter(t => expectedTokens.includes(t)).length;
        let majorityMatch = commonCount >= Math.ceil(Math.min(bestTokens.length, expectedTokens.length) * 0.6);

        aliasValid = lastTokenMatch || majorityMatch;
      }

      if (bestScore > 0.7 && aliasValid && !handled.has(best + expectedKey)) {
        handled.add(best + expectedKey);

        if (interactive) {
          let ui = SpreadsheetApp.getUi();
          let response = ui.alert(
            "Alias Vorschlag",
            best + " → " + expectedKey + " ?",
            ui.ButtonSet.YES_NO
          );

          if (response == ui.Button.YES) {
            addAlias(best, expectedKey, ss);
            aliasMap[best] = expectedKey;
            actual.push(expectedKey);
            found = true;
          }
        } else if (unmatchedNames[station]) {
          unmatchedNames[station].push(best + " → " + expectedKey);
          unmatchedActualKeys.add(best);
        }
      }
    }

    if (found && matched[station]) {
      matched[station].add(expectedKey);
    }

    if (!found) {
      if (station === "STATION_A") stationA.push(name);
      else if (station === "STATION_B") stationB.push(name);
    }
  }

  return {
    actualRecords: actualRecords,
    expected: expected,
    matched: matched,
    missing: { STATION_A: stationA, STATION_B: stationB },
    unmatchedActualKeys: unmatchedActualKeys,
    unmatchedNames: unmatchedNames
  };
}

function checkEMentorDrivers(filterStation) {
  const result = runEMentorMatcher_(SpreadsheetApp.getActive(), filterStation, true);
  const stationA = result.missing.STATION_A;
  const stationB = result.missing.STATION_B;
  let totalMissing = stationA.length + stationB.length;

  if (totalMissing === 0) {
    SpreadsheetApp.getUi().alert("✅ Alle Fahrer sind im eMentor aktiv");
    return;
  }

  let message = "⚠️ Hinweis:\n";
  message += "Einige Fahrer könnten später starten. Bitte im Timeline prüfen.\n\n";
  message += "❌ MISSING eMENTOR (" + totalMissing + "):\n\n";

  if (!filterStation || filterStation === "STATION_B") {
    if (stationB.length) {
      message += "🔵 STATION_B:\n" + stationB.join("\n") + "\n\n";
    }
  }

  if (!filterStation || filterStation === "STATION_A") {
    if (stationA.length) {
      message += "🟢 STATION_A:\n" + stationA.join("\n") + "\n\n";
    }
  }

  SpreadsheetApp.getUi().alert(message);
}

function checkEM_STATION_A() { checkEMentorDrivers("STATION_A"); }
function checkEM_STATION_B() { checkEMentorDrivers("STATION_B"); }

function buildEMentorAdoptionSummary_(ss, serviceDate) {
  const result = runEMentorMatcher_(ss, null, false);
  const allExpectedKeys = [];
  ["STATION_A", "STATION_B"].forEach(function(station) {
    result.expected[station].forEach(function(name, key) {
      allExpectedKeys.push(key);
    });
  });

  const extra = { STATION_A: new Map(), STATION_B: new Map() };
  result.actualRecords.forEach(function(record) {
    if (!extra[record.station]) return;

    let belongsToExpected = allExpectedKeys.some(function(expectedKey) {
      return isSamePerson(record.key, expectedKey);
    });
    if (belongsToExpected || result.unmatchedActualKeys.has(record.key)) return;

    if (!extra[record.station].has(record.key)) {
      extra[record.station].set(record.key, record.rawName);
    }
  });

  const stations = {};
  ["STATION_A", "STATION_B"].forEach(function(station) {
    const expected = result.expected[station];
    const matched = result.matched[station];
    const missingDrivers = [];

    expected.forEach(function(name, key) {
      if (!matched.has(key)) missingDrivers.push(name);
    });

    const expectedDrivers = expected.size;
    const driversWithCheck = matched.size;
    stations[station] = {
      expectedDrivers: expectedDrivers,
      driversWithCheck: driversWithCheck,
      missingDrivers: missingDrivers,
      extraMentorDrivers: Array.from(extra[station].values()),
      unmatchedNames: Array.from(new Set(result.unmatchedNames[station])),
      adoptionRate: expectedDrivers === 0
        ? 0
        : Math.round((driversWithCheck / expectedDrivers) * 10000) / 10000
    };
  });

  return {
    serviceDate: serviceDate,
    stations: stations
  };
}

function clearEMentor() {
  const sheet = SpreadsheetApp.getActive().getSheetByName("eMentor_Check");
  sheet.clearContents();
  sheet.setActiveSelection("A1");
  SpreadsheetApp.getUi().alert("🧹 eMentor_Check komplett geleert");
}
