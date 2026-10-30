// Run with: node --test
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../calc.js");

test("parseAmount accepte la virgule et les espaces", () => {
  assert.equal(C.parseAmount("12,50"), 12.5);
  assert.equal(C.parseAmount("1 500"), 1500);
  assert.equal(C.parseAmount("10.005"), 10.01);
  assert.ok(Number.isNaN(C.parseAmount("abc")));
  assert.ok(Number.isNaN(C.parseAmount("")));
});

test("clampStartDay reste entre 1 et 28", () => {
  assert.equal(C.clampStartDay(undefined), 1);
  assert.equal(C.clampStartDay(0), 1);
  assert.equal(C.clampStartDay(31), 28);
  assert.equal(C.clampStartDay("25"), 25);
});

test("shiftMonth passe d'une année à l'autre", () => {
  assert.equal(C.shiftMonth("2026-12", 1), "2027-01");
  assert.equal(C.shiftMonth("2026-01", -1), "2025-12");
  assert.equal(C.shiftMonth("2026-10", -6), "2026-04");
});

test("période classique du 1er au dernier jour du mois", () => {
  assert.ok(C.inPeriod("2026-10-01", "2026-10", 1));
  assert.ok(C.inPeriod("2026-10-31", "2026-10", 1));
  assert.ok(!C.inPeriod("2026-11-01", "2026-10", 1));
  assert.equal(C.periodOf("2026-10-15", 1), "2026-10");
});

test("période qui commence le jour de la paie (le 25)", () => {
  assert.ok(C.inPeriod("2026-10-25", "2026-10", 25));
  assert.ok(C.inPeriod("2026-11-24", "2026-10", 25));
  assert.ok(!C.inPeriod("2026-11-25", "2026-10", 25));
  assert.ok(!C.inPeriod("2026-10-24", "2026-10", 25));
  assert.equal(C.periodOf("2026-10-24", 25), "2026-09");
  assert.equal(C.periodOf("2026-10-25", 25), "2026-10");
  assert.equal(C.periodOf("2026-01-10", 25), "2025-12");
});

test("totals sépare revenus, dépenses et épargne", () => {
  const list = [
    { type: "in", amount: 300000 },
    { type: "out", amount: 50000 },
    { type: "out", amount: 25000 },
    { type: "save", amount: 20000 },
  ];
  assert.deepEqual(C.totals(list), { inc: 300000, out: 75000, save: 20000 });
  assert.deepEqual(C.totals([]), { inc: 0, out: 0, save: 0 });
});

test("carryFor reporte ce qui reste des périodes précédentes", () => {
  const txs = [
    { type: "in", amount: 1000, date: "2026-09-01" },
    { type: "out", amount: 300.1, date: "2026-09-10" },
    { type: "save", amount: 100, date: "2026-09-20" },
    { type: "out", amount: 999, date: "2026-10-02" }, // période en cours : pas reportée
  ];
  assert.equal(C.carryFor(txs, "2026-10", 1), 599.9);
  assert.equal(C.carryFor(txs, "2026-09", 1), 0);
  // Avec un mois qui commence le 15, la dépense du 2 octobre appartient à la période de septembre.
  assert.equal(C.carryFor(txs, "2026-10", 15), -399.1);
});

test("fixedDate place la dépense fixe dans la bonne période", () => {
  assert.equal(C.fixedDate({ day: 5 }, "2026-10", 1), "2026-10-05");
  assert.equal(C.fixedDate({ day: 31 }, "2026-02", 1), "2026-02-28");
  assert.equal(C.fixedDate({ day: 31 }, "2028-02", 1), "2028-02-29");
  // Période du 25 oct. au 24 nov. : le loyer du 5 tombe en novembre.
  assert.equal(C.fixedDate({ day: 5 }, "2026-10", 25), "2026-11-05");
  assert.equal(C.fixedDate({ day: 28 }, "2026-10", 25), "2026-10-28");
});

test("daysLeft compte les jours restants, aujourd'hui compris", () => {
  assert.equal(C.daysLeft("2026-10-30", "2026-10", 1), 2);
  assert.equal(C.daysLeft("2026-10-31", "2026-10", 1), 1);
  assert.equal(C.daysLeft("2026-10-25", "2026-10", 25), 31);
});

test("backupDue rappelle de sauvegarder au bon moment", () => {
  const day = 86400000, now = Date.UTC(2026, 9, 30);
  assert.equal(C.backupDue({ txCount: 0, now }), false);
  assert.equal(C.backupDue({ txCount: 3, now }), true);
  assert.equal(C.backupDue({ txCount: 3, firstUse: now - 5 * day, now }), false);
  assert.equal(C.backupDue({ txCount: 3, firstUse: now - 40 * day, now }), true);
  assert.equal(C.backupDue({ txCount: 3, lastBackup: now - 29 * day, firstUse: now - 90 * day, now }), false);
  assert.equal(C.backupDue({ txCount: 3, lastBackup: now - 30 * day, now }), true);
});
