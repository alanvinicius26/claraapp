import { readFile } from "node:fs/promises";

export const migrations = ["schema", "hardening", "quality", "multiservice", "booking_readiness", "product_completion",
  "team", "custom_links", "clara", "clara_reschedule", "clara_dialogue", "production_readiness", "billing", "scheduling_integrity"];

export async function migrateScheduling(db) {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema extensions; create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth,public to anon,authenticated,service_role; set search_path=public,extensions;`);
  for (const name of migrations) {
    try { await db.exec(await readFile(new URL(`../supabase/${name}.sql`, import.meta.url), "utf8")); }
    catch (error) { throw new Error(`Migration ${name}: ${error.message}`, { cause: error }); }
    if (name === "quality") await db.exec("alter table public.studios add column image_url text not null default ''; alter table public.services add column image_url text not null default '';");
  }
}

export async function schedulingFixture(db) {
  const one = async (sql, values = []) => (await db.query(sql, values)).rows[0];
  const owner = (await one("insert into auth.users(id) values(gen_random_uuid()) returning id")).id;
  const studio = (await one("insert into public.studios(owner_id,name,professional,slug,min_notice,buffer,horizon) values($1,'QA Scheduling','Principal','qa-'||gen_random_uuid(),0,10,90) returning *", [owner]));
  await db.query("insert into public.working_hours(studio_id,weekday) select $1,generate_series(0,6)", [studio.id]);
  const p1 = (await one("select id from public.professionals where studio_id=$1", [studio.id])).id;
  const p2 = (await one("insert into public.professionals(studio_id,name) values($1,'Segunda profissional') returning id", [studio.id])).id;
  const r1 = (await one("insert into public.resources(studio_id,name) values($1,'Maca 1') returning id", [studio.id])).id;
  const r2 = (await one("insert into public.resources(studio_id,name) values($1,'Sala 2') returning id", [studio.id])).id;
  const service = async (name, duration, resource) => (await one("insert into public.services(studio_id,name,duration,price,resource_id) values($1,$2,$3,50,$4) returning id", [studio.id, name, duration, resource])).id;
  const manicure = await service("Manicure", 45, r1);
  const hair = await service("Progressiva", 180, r2);
  const brow = await service("Sobrancelha", 30, r1);
  const free = await service("Sem recurso", 45, null);
  const client = (await one("insert into public.clients(studio_id,name) values($1,'Cliente sintética') returning id", [studio.id])).id;
  const date = (await one("select ((now() at time zone 'America/Sao_Paulo')::date+7)::text d")).d;
  const at = (time = "09:00", day = date) => `${day}T${time}:00-03:00`;
  const insert = (services = [manicure], start = at(), professional = p1, extra = {}) => {
    const values = { studio_id: studio.id, professional_id: professional, client_id: client, service_ids: services,
      starts_at: start, ends_at: new Date(Date.parse(start) + 60000).toISOString(), ...extra };
    const keys = Object.keys(values);
    return one(`insert into public.appointments(${keys.join(",")}) values(${keys.map((_, i) => `$${i + 1}`).join(",")}) returning *`, Object.values(values));
  };
  return { one, owner, studio, p1, p2, r1, r2, manicure, hair, brow, free, client, date, at, insert };
}
