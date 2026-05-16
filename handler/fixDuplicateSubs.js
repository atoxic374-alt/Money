const fs = require('fs');

function readJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw || !raw.trim()) return fallback;
    const p = JSON.parse(raw);
    return (p !== null && p !== undefined) ? p : fallback;
  } catch { return fallback; }
}

/**
 * Scans time.json for users that have more than one active subscription
 * on the same server, merges them into the single entry with the highest
 * expirationTime, re-routes all tokens to that entry's code, and saves.
 *
 * Returns an array of merge-report objects so callers can log or notify.
 */
function fixDuplicateSubs() {
  const now = Date.now();
  let timeArr = readJson('./settings/time.json', []);
  let tokens  = readJson('./settings/tokens.json', []);

  if (!Array.isArray(timeArr) || !Array.isArray(tokens)) return [];

  // Group ACTIVE entries by user:server
  const groups = {};
  timeArr.forEach(function(e) {
    if (e.expirationTime <= now) return;
    const key = e.user + ':' + e.server;
    if (!groups[key]) groups[key] = [];
    groups[key].push(e);
  });

  const reports = [];
  const codesToDelete = new Set();

  Object.values(groups).forEach(function(group) {
    if (group.length <= 1) return;

    // Sort descending by expirationTime — longest subscription wins
    group.sort(function(a, b) { return b.expirationTime - a.expirationTime; });
    const keeper   = group[0];
    const victims  = group.slice(1);
    const victimCodes = new Set(victims.map(function(e) { return e.code; }));

    // Sum all botsCount into the keeper
    const totalBots = group.reduce(function(s, e) { return s + (e.botsCount || 0); }, 0);
    keeper.botsCount = totalBots;

    // Re-route tokens that belonged to the victims
    let rerouted = 0;
    tokens.forEach(function(t) {
      if (victimCodes.has(t.code)) {
        t.code = keeper.code;
        rerouted++;
      }
    });

    victims.forEach(function(v) { codesToDelete.add(v.code); });

    reports.push({
      user:     keeper.user,
      server:   keeper.server,
      kept:     keeper.code,
      deleted:  victims.map(function(v) { return v.code; }),
      rerouted: rerouted,
      totalBots: totalBots,
    });
  });

  if (reports.length === 0) return [];

  // Remove duplicate entries, keep expired ones untouched
  const keeperCodes = new Set(
    Object.values(groups)
      .filter(function(g) { return g.length > 0; })
      .map(function(g) { return g[0].code; })
  );

  const newTimeArr = timeArr.filter(function(e) {
    if (e.expirationTime <= now) return true;   // keep expired (cleaned by checkSubscriptions)
    if (codesToDelete.has(e.code)) return false; // remove victim
    return true;
  });

  // Make sure keeper has the updated botsCount in the written array
  reports.forEach(function(r) {
    const entry = newTimeArr.find(function(e) { return e.code === r.kept; });
    if (entry) entry.botsCount = r.totalBots;
  });

  try {
    fs.writeFileSync('./settings/time.json',   JSON.stringify(newTimeArr, null, 2));
    fs.writeFileSync('./settings/tokens.json', JSON.stringify(tokens,     null, 2));
  } catch (e) {
    console.error('[fixDuplicateSubs] write error:', e.message);
    return [];
  }

  return reports;
}

module.exports = { fixDuplicateSubs };
