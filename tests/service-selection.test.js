import { test } from "node:test";
import assert from "node:assert/strict";
import {
  summarizeServices,
  serviceSchedule,
} from "../src/service-selection.js";
const services = [
  { id: "a", name: "Manicure", price: 45, duration: 45 },
  { id: "b", name: "Sobrancelhas", price: 60, duration: 30 },
];
test("combined services preserve selection order and sum duration and price", () => {
  assert.deepEqual(summarizeServices(services), {
    name: "Manicure + Sobrancelhas",
    price: 105,
    duration: 75,
  });
  assert.equal(
    summarizeServices([
      { price: 0.1, duration: 5, name: "a" },
      { price: 0.2, duration: 5, name: "b" },
    ]).price,
    0.3,
  );
  assert.equal(summarizeServices(services.slice(1)).duration, 30);
  assert.equal(summarizeServices([]).price, 0);
});
test("service timeline is continuous and adds cleanup only after the final service", () => {
  const result = serviceSchedule(services, "2026-10-01T14:00:00-03:00", 15);
  assert.equal(result.items[0].ends_at, result.items[1].starts_at);
  assert.equal(result.ends_at, "2026-10-01T18:15:00.000Z");
  assert.equal(result.free_at, "2026-10-01T18:30:00.000Z");
  assert.equal(serviceSchedule(services, undefined), null);
});
