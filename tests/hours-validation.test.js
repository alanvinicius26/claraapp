import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareHours, defaultBreak } from "../src/hours-validation.js";

const week = (patch = {}) =>
  Array.from({ length: 7 }, (_, weekday) => ({
    studio_id: "s1",
    weekday,
    enabled: weekday > 0,
    opens: "09:00:00",
    closes: "18:00:00",
    break_start: "12:00:00",
    break_end: "13:00:00",
    ...(patch[weekday] || {}),
  }));

test("valid week is sent in the save_hours shape, without extra columns", () => {
  const { hours, error } = prepareHours(week());
  assert.equal(error, undefined);
  assert.equal(hours.length, 7);
  assert.deepEqual(hours[1], {
    weekday: 1,
    enabled: true,
    opens: "09:00",
    closes: "18:00",
    break_start: "12:00",
    break_end: "13:00",
  });
});

test("short Saturday with the lunch break left behind names the day (LariHair case)", () => {
  const { error } = prepareHours(week({ 6: { closes: "12:00" } }));
  assert.equal(
    error,
    "Sábado: a pausa (12:00–13:00) precisa ficar dentro do atendimento (09:00–12:00).",
  );
});

test("every database CHECK has a readable message before saving", () => {
  assert.match(
    prepareHours(week({ 2: { opens: "18:00", closes: "09:00" } })).error,
    /^Terça-feira: o fim do atendimento precisa ser depois do início\.$/,
  );
  assert.match(
    prepareHours(week({ 3: { break_start: "14:00", break_end: "13:00" } })).error,
    /^Quarta-feira: o fim da pausa precisa ser depois do início\.$/,
  );
  assert.match(
    prepareHours(week({ 4: { break_start: "", break_end: "13:00" } })).error,
    /^Quinta-feira: preencha o início e o fim da pausa/,
  );
  assert.match(
    prepareHours(week({ 5: { opens: "" } })).error,
    /^Sexta-feira: preencha o horário de início e de fim/,
  );
  assert.match(
    prepareHours(week({ 1: { break_start: "08:30" } })).error,
    /^Segunda-feira: a pausa .* dentro do atendimento/,
  );
  assert.equal(prepareHours(week().slice(0, 6)).error, "Informe os sete dias da semana.");
});

test("no break and break touching the edges are accepted", () => {
  const { hours, error } = prepareHours(
    week({
      1: { break_start: null, break_end: null },
      2: { break_start: "09:00", break_end: "10:00" },
      3: { break_start: "17:00", break_end: "18:00" },
    }),
  );
  assert.equal(error, undefined);
  assert.equal(hours[1].break_start, null);
  assert.equal(hours[1].break_end, null);
});

test("closed days never block the save: invisible leftovers are cleaned", () => {
  const { hours, error } = prepareHours(
    week({
      0: { enabled: false, closes: "12:00" },
      6: { enabled: false, opens: "15:00", closes: "10:00" },
    }),
  );
  assert.equal(error, undefined);
  assert.deepEqual(
    [hours[0].opens, hours[0].closes, hours[0].break_start, hours[0].break_end],
    ["09:00", "12:00", null, null],
  );
  assert.deepEqual(
    [hours[6].opens, hours[6].closes, hours[6].break_start, hours[6].break_end],
    ["09:00", "18:00", "12:00", "13:00"],
  );
});

test("a new break starts inside the working day", () => {
  assert.deepEqual(defaultBreak("09:00", "18:00"), { break_start: "12:00", break_end: "13:00" });
  assert.deepEqual(defaultBreak("14:00", "20:00"), { break_start: "16:30", break_end: "17:30" });
  assert.deepEqual(defaultBreak("08:00", "12:00"), { break_start: "09:30", break_end: "10:30" });
  assert.deepEqual(defaultBreak("10:00", "11:00"), { break_start: "10:15", break_end: "10:30" });
  for (const [opens, closes] of [["14:00", "20:00"], ["08:00", "12:00"], ["10:00", "11:00"], ["06:00", "12:30"]]) {
    const day = { weekday: 1, enabled: true, opens, closes, ...defaultBreak(opens, closes) };
    assert.equal(prepareHours(week({ 1: day })).error, undefined, `${opens}-${closes}`);
  }
});
