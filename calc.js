// Mon Budget: pure calculations (periods, totals, carry-over, backups).
// No DOM access here, so the same file runs in the page and in the tests (node --test).
(function (root) {
  const pad2 = (n) => String(n).padStart(2, "0");

  // Day the budget month starts (1–28), from the raw setting.
  const clampStartDay = (v) => Math.min(28, Math.max(1, Math.round(Number(v) || 1)));

  // "YYYY-MM" shifted by d months.
  const shiftMonth = (ym, d) => {
    const [y, m] = ym.split("-").map(Number);
    const dt = new Date(y, m - 1 + d, 1);
    return dt.getFullYear() + "-" + pad2(dt.getMonth() + 1);
  };

  const daysIn = (ym) => { const [y, m] = ym.split("-").map(Number); return new Date(y, m, 0).getDate(); };

  // A period "YYYY-MM" runs from its start day to the start day of the next month (exclusive).
  const periodStart = (ym, sd) => ym + "-" + pad2(sd);
  const periodEnd = (ym, sd) => shiftMonth(ym, 1) + "-" + pad2(sd);
  const inPeriod = (date, ym, sd) => typeof date === "string" && date >= periodStart(ym, sd) && date < periodEnd(ym, sd);
  const periodOf = (date, sd) => { const ym = date.slice(0, 7); return Number(date.slice(8, 10)) >= sd ? ym : shiftMonth(ym, -1); };

  const isoDate = (d) => d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());

  // "12,50", "1 500" or "1500.5" → number rounded to cents, NaN when not a number.
  const parseAmount = (s) => {
    const str = String(s).replace(/\s/g, "").replace(",", ".");
    if (str === "") return NaN;
    const n = Number(str);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
  };

  const totals = (list) => {
    let inc = 0, out = 0, save = 0;
    for (const t of list) { if (t.type === "in") inc += t.amount; else if (t.type === "save") save += t.amount; else out += t.amount; }
    return { inc, out, save };
  };

  // What is left from every period before ym (income minus spending and savings).
  const carryFor = (txs, ym, sd) => {
    const start = periodStart(ym, sd);
    let c = 0;
    for (const t of txs) if (typeof t.date === "string" && t.date < start) c += t.type === "in" ? t.amount : -t.amount;
    return Math.round(c * 100) / 100;
  };

  // Date a fixed expense falls on inside period ym (day clamped to the month length).
  const fixedDate = (r, ym, sd) => {
    const day = Number(r.day) || 1, m = day >= sd ? ym : shiftMonth(ym, 1);
    return m + "-" + pad2(Math.min(day, daysIn(m)));
  };

  // Days left in the period, today included, when today is inside it.
  const daysLeft = (todayIso, ym, sd) => {
    const end = new Date(periodEnd(ym, sd) + "T00:00:00"), now = new Date(todayIso + "T00:00:00");
    return Math.max(1, Math.round((end - now) / 86400000));
  };

  // A backup reminder is due once there is something to lose and the last backup is older than `days`.
  const BACKUP_EVERY_DAYS = 30;
  const backupDue = ({ txCount, lastBackup, firstUse, now, days = BACKUP_EVERY_DAYS }) => {
    if (!txCount) return false;
    const ref = Number(lastBackup) || Number(firstUse) || 0;
    if (!ref) return true;
    return now - ref >= days * 86400000;
  };

  const api = { pad2, clampStartDay, shiftMonth, daysIn, periodStart, periodEnd, inPeriod, periodOf, isoDate, parseAmount, totals, carryFor, fixedDate, daysLeft, backupDue, BACKUP_EVERY_DAYS };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BudgetCalc = api;
})(this);
