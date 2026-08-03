function normKey(v) {
  return String(v || '')
    .toUpperCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ADOPTION_NAME_MATCH_CONFIG = {
  minPrefixLength: 4,
  shortTokenSimilarity: 0.7,
  longTokenSimilarity: 0.75,
  aliasSuggestionSimilarity: 0.75,
  aliasLastTokenSimilarity: 0.75,
  aliasCommonTokenRatio: 0.6
};

function adoptionSheetName_(propertyName, fallback) {
  try {
    const value = PropertiesService.getScriptProperties().getProperty(propertyName);
    return value ? String(value).trim() : fallback;
  } catch (error) {
    return fallback;
  }
}

function normalizeSite(s) {
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
      if (s.length >= ADOPTION_NAME_MATCH_CONFIG.minPrefixLength && lo.startsWith(s)) { found = true; break; }

      let threshold = Math.min(t.length, l.length) <= 4
        ? ADOPTION_NAME_MATCH_CONFIG.shortTokenSimilarity
        : ADOPTION_NAME_MATCH_CONFIG.longTokenSimilarity;
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
  const sheet = ss.getSheetByName(adoptionSheetName_("ADOPTION_ALIAS_SHEET", "ALIAS_TABLE"));
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
  let sheet = ss.getSheetByName(adoptionSheetName_("ADOPTION_ALIAS_SHEET", "ALIAS_TABLE"));
  if (!sheet) {
    sheet = ss.insertSheet(adoptionSheetName_("ADOPTION_ALIAS_SHEET", "ALIAS_TABLE"));
    sheet.getRange(1, 1, 1, 2).setValues([["Raw Name", "Correct Name"]]);
  }
  sheet.appendRow([normKey(raw), normKey(correct)]);
}

function runAdoptionMatcher_(ss, filterSite, interactive) {
  const em = ss.getSheetByName(adoptionSheetName_("ADOPTION_RAW_IMPORT_SHEET", "Adoption_Check")).getDataRange().getValues();
  const ex = ss.getSheetByName(adoptionSheetName_("ADOPTION_EXPECTED_SHEET", "EXPECTED_DRIVERS")).getDataRange().getValues();

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
      site: normalizeSite(em[i][11])
    });
  }

  let siteA = [];
  let siteB = [];
  let expected = { SITE_A: new Map(), SITE_B: new Map() };
  let matched = { SITE_A: new Set(), SITE_B: new Set() };
  let unmatchedNames = { SITE_A: [], SITE_B: [] };
  let unmatchedActualKeys = new Set();

  for (let i = 1; i < ex.length; i++) {
    let name = ex[i][2];
    let site = normalizeSite(ex[i][3]);
    if (filterSite && site !== filterSite) continue;

    let expectedKey = normKey(name);
    if (expected[site] && expectedKey && !expected[site].has(expectedKey)) {
      expected[site].set(expectedKey, name);
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
        let lastTokenMatch = levenSim(lastB, lastE) >= ADOPTION_NAME_MATCH_CONFIG.aliasLastTokenSimilarity;

        let commonCount = bestTokens.filter(t => expectedTokens.includes(t)).length;
        let majorityMatch = commonCount >= Math.ceil(Math.min(bestTokens.length, expectedTokens.length) * ADOPTION_NAME_MATCH_CONFIG.aliasCommonTokenRatio);

        aliasValid = lastTokenMatch || majorityMatch;
      }

      if (bestScore > ADOPTION_NAME_MATCH_CONFIG.aliasSuggestionSimilarity && aliasValid && !handled.has(best + expectedKey)) {
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
        } else if (unmatchedNames[site]) {
          unmatchedNames[site].push(best + " → " + expectedKey);
          unmatchedActualKeys.add(best);
        }
      }
    }

    if (found && matched[site]) {
      matched[site].add(expectedKey);
    }

    if (!found) {
      if (site === "SITE_A") siteA.push(name);
      else if (site === "SITE_B") siteB.push(name);
    }
  }

  return {
    actualRecords: actualRecords,
    expected: expected,
    matched: matched,
    missing: { SITE_A: siteA, SITE_B: siteB },
    unmatchedActualKeys: unmatchedActualKeys,
    unmatchedNames: unmatchedNames
  };
}

function checkAdoptionDrivers(filterSite) {
  const result = runAdoptionMatcher_(SpreadsheetApp.getActive(), filterSite, true);
  const siteA = result.missing.SITE_A;
  const siteB = result.missing.SITE_B;
  let totalMissing = siteA.length + siteB.length;

  if (totalMissing === 0) {
    SpreadsheetApp.getUi().alert("All expected workers have a completed adoption check.");
    return;
  }

  let message = "Missing adoption checks (" + totalMissing + "):\n\n";

  if (!filterSite || filterSite === "SITE_B") {
    if (siteB.length) {
      message += "🔵 SITE_B:\n" + siteB.join("\n") + "\n\n";
    }
  }

  if (!filterSite || filterSite === "SITE_A") {
    if (siteA.length) {
      message += "🟢 SITE_A:\n" + siteA.join("\n") + "\n\n";
    }
  }

  SpreadsheetApp.getUi().alert(message);
}

function checkSiteA() { checkAdoptionDrivers("SITE_A"); }
function checkSiteB() { checkAdoptionDrivers("SITE_B"); }

function buildAdoptionSummary_(ss, serviceDate) {
  const result = runAdoptionMatcher_(ss, null, false);
  const allExpectedKeys = [];
  ["SITE_A", "SITE_B"].forEach(function(site) {
    result.expected[site].forEach(function(name, key) {
      allExpectedKeys.push(key);
    });
  });

  const extra = { SITE_A: new Map(), SITE_B: new Map() };
  result.actualRecords.forEach(function(record) {
    if (!extra[record.site]) return;

    let belongsToExpected = allExpectedKeys.some(function(expectedKey) {
      return isSamePerson(record.key, expectedKey);
    });
    if (belongsToExpected || result.unmatchedActualKeys.has(record.key)) return;

    if (!extra[record.site].has(record.key)) {
      extra[record.site].set(record.key, record.rawName);
    }
  });

  const sites = {};
  ["SITE_A", "SITE_B"].forEach(function(site) {
    const expected = result.expected[site];
    const matched = result.matched[site];
    const missingDrivers = [];

    expected.forEach(function(name, key) {
      if (!matched.has(key)) missingDrivers.push(name);
    });

    const expectedDrivers = expected.size;
    const driversWithCheck = matched.size;
    sites[site] = {
      expectedDrivers: expectedDrivers,
      driversWithCheck: driversWithCheck,
      missingDrivers: missingDrivers,
      extraMentorDrivers: Array.from(extra[site].values()),
      unmatchedNames: Array.from(new Set(result.unmatchedNames[site])),
      adoptionRate: expectedDrivers === 0
        ? 0
        : Math.round((driversWithCheck / expectedDrivers) * 10000) / 10000
    };
  });

  return {
    serviceDate: serviceDate,
    sites: sites
  };
}

function clearAdoption() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(adoptionSheetName_("ADOPTION_RAW_IMPORT_SHEET", "Adoption_Check"));
  sheet.clearContents();
  sheet.setActiveSelection("A1");
  SpreadsheetApp.getUi().alert("🧹 Adoption_Check komplett geleert");
}
