import { readFile } from "node:fs/promises";
import { migrations } from "./scheduling-fixture.js";

export async function migrateBilling(
  db,
  { scheduling = false, plans = true } = {},
) {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema extensions; create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth,public to anon,authenticated,service_role; set search_path=public,extensions;`);
  const names = [
    ...migrations.filter(
      (name) => scheduling || name !== "scheduling_integrity",
    ),
    ...(plans ? ["billing_plans"] : []),
  ];
  for (const name of names) {
    try {
      await db.exec(
        await readFile(
          new URL(`../supabase/${name}.sql`, import.meta.url),
          "utf8",
        ),
      );
    } catch (error) {
      throw new Error(`Migration ${name}: ${error.message}`, { cause: error });
    }
    if (name === "quality")
      await db.exec(
        "alter table public.studios add column image_url text not null default ''; alter table public.services add column image_url text not null default '';",
      );
  }
}
export async function billingFixture(db) {
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  const owner = (
    await one(
      "insert into auth.users(id) values(gen_random_uuid()) returning id",
    )
  ).id;
  const studio = await one(
    "insert into public.studios(owner_id,name,professional,slug) values($1,'Equipe de teste','Proprietária','teste-'||gen_random_uuid()) returning *",
    [owner],
  );
  const primary = (
    await one(
      "select id from public.professionals where studio_id=$1 and is_default",
      [studio.id],
    )
  ).id;
  const add = async (name = "Atendente", active = true) =>
    (
      await one(
        "insert into public.professionals(studio_id,name,active) values($1,$2,$3) returning id",
        [studio.id, name, active],
      )
    ).id;
  const asOwner = () =>
    db.exec(`set role authenticated; set request.jwt.claim.sub='${owner}'`);
  const account = async (changes = {}) => {
    await db.exec("reset role");
    const fields = Object.keys(changes);
    if (fields.length)
      await db.query(
        `update encaixa_private.billing_accounts set ${fields.map((k, i) => `${k}=$${i + 2}`).join(",")} where owner_id=$1`,
        [owner, ...Object.values(changes)],
      );
    return await one(
      "select * from encaixa_private.billing_accounts where owner_id=$1",
      [owner],
    );
  };
  const status = async () => (await one("select public.billing_status() v")).v;
  return { one, owner, studio, primary, add, asOwner, account, status };
}
