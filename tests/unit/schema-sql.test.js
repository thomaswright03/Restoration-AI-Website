"use strict";

// supabase/schema.sql, run for real in an in-process Postgres (PGlite): the
// plan limits create_project() enforces, the row-level security that keeps
// one business from reading another's projects, and the sign-up trigger of
// the kill switch. The parts of Supabase the schema leans on (the auth
// schema, auth.uid(), the roles) are stubbed the way Supabase defines them.
//
// PGlite runs one connection, so "concurrent" calls below are serialized by
// the driver; what the concurrency test checks is that the function takes
// the per-owner advisory lock its comment promises, and that the limit holds
// across calls issued at the same time.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");
const { pgcrypto } = require("@electric-sql/pglite/contrib/pgcrypto");

const SCHEMA = fs.readFileSync(path.join(__dirname, "..", "..", "supabase", "schema.sql"), "utf8");
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

// What Supabase provides before schema.sql runs: auth.users, auth.uid() (the
// signed-in user from the request's JWT), and the roles the policies name.
// `authenticated` gets the table rights Supabase grants by default, so the
// RLS policies, not missing grants, are what the isolation test exercises.
const SUPABASE_STUB = `
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key, email text);
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create role anon;
  create role authenticated;
  create role service_role;
  create role supabase_auth_admin;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

let db;
let users = 0;

test.before(async () => {
  db = await new PGlite({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_STUB);
  await db.exec(SCHEMA);
  // "Safe to re-run" is a promise the file makes.
  await db.exec(SCHEMA);
});

test.after(async () => {
  if (db) await db.close();
});

// A fresh account for each test, so counts start at zero.
async function newUser() {
  users += 1;
  const id = "00000000-0000-4000-8000-" + String(users).padStart(12, "0");
  await db.query("insert into auth.users (id) values ($1::uuid)", [id]);
  return id;
}

async function create(owner, monthly, total, name = "Bath") {
  const r = await db.query("select public.create_project($1::uuid, $2, 'abc', $3, $4) as r", [
    owner,
    name,
    monthly,
    total,
  ]);
  return r.rows[0].r;
}

async function count(table, owner) {
  const r = await db.query(`select count(*)::int as n from public.${table} where owner_id = $1::uuid`, [owner]);
  return r.rows[0].n;
}

test("create_project: a project is saved and both counters come back", async () => {
  const owner = await newUser();
  const r = await create(owner, 10, 50, "Smith bath");
  assert.equal(r.error, undefined);
  assert.equal(r.month, 1);
  assert.equal(r.total, 1);
  assert.equal(r.project.name, "Smith bath");
  assert.match(r.project.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(r.project.info, {});
  assert.equal(await count("projects", owner), 1);
  assert.equal(await count("project_creations", owner), 1);
});

test("create_project: the monthly cap stops the next save and says where the account stands", async () => {
  const owner = await newUser();
  assert.equal((await create(owner, 2, 50)).error, undefined);
  assert.equal((await create(owner, 2, 50)).error, undefined);
  const r = await create(owner, 2, 50);
  assert.deepEqual(r, { error: "monthly-limit", month: 2, total: 2 });
  assert.equal(await count("projects", owner), 2, "nothing was inserted");
  assert.equal(await count("project_creations", owner), 2);
});

test("create_project: the total cap stops the next save when the month still has room", async () => {
  const owner = await newUser();
  await create(owner, 10, 2);
  await create(owner, 10, 2);
  const r = await create(owner, 10, 2);
  assert.deepEqual(r, { error: "total-limit", month: 2, total: 2 });
});

test("create_project: deleting a project frees a slot but does not give the month back", async () => {
  const owner = await newUser();
  const first = await create(owner, 2, 2);
  await create(owner, 2, 2);
  await db.query("delete from public.projects where id = $1::uuid and owner_id = $2::uuid", [first.project.id, owner]);
  assert.equal(await count("projects", owner), 1);
  // Total cap of 2 with 1 kept: room. Monthly cap of 2 with 2 created: none.
  assert.deepEqual(await create(owner, 2, 2), { error: "monthly-limit", month: 2, total: 1 });
  // With the month open, the freed slot can be used.
  const r = await create(owner, 10, 2);
  assert.equal(r.error, undefined);
  assert.equal(r.month, 3);
  assert.equal(r.total, 2);
});

test("create_project: a free plan (0 and 0) can never save", async () => {
  const owner = await newUser();
  assert.deepEqual(await create(owner, 0, 0), { error: "monthly-limit", month: 0, total: 0 });
});

test("create_project: saves issued at the same time never slip past the cap, under a per-owner lock", async () => {
  const owner = await newUser();
  const results = await Promise.all([1, 2, 3, 4, 5].map((i) => create(owner, 3, 50, "Bath " + i)));
  const saved = results.filter((r) => !r.error);
  const refused = results.filter((r) => r.error === "monthly-limit");
  assert.equal(saved.length, 3);
  assert.equal(refused.length, 2);
  assert.equal(await count("projects", owner), 3);
  assert.equal(await count("project_creations", owner), 3);
  // The lock is held until the call's transaction ends, and only then.
  await db.transaction(async (tx) => {
    await tx.query("select public.create_project($1::uuid, 'Locked', 'abc', 50, 50)", [owner]);
    const locks = await tx.query(
      "select count(*)::int as n from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()",
    );
    assert.equal(locks.rows[0].n, 1, "create_project holds an advisory lock while it runs");
  });
  const after = await db.query("select count(*)::int as n from pg_locks where locktype = 'advisory'");
  assert.equal(after.rows[0].n, 0, "released when the transaction ends");
});

test("create_project: the counts are per owner", async () => {
  const a = await newUser();
  const b = await newUser();
  await create(a, 1, 50);
  assert.deepEqual(await create(a, 1, 50), { error: "monthly-limit", month: 1, total: 1 });
  const r = await create(b, 1, 50);
  assert.equal(r.error, undefined);
  assert.equal(r.month, 1);
});

test("create_project: the design and info rules of the projects table hold inside the function", async () => {
  const owner = await newUser();
  await assert.rejects(
    db.query("select public.create_project($1::uuid, 'Bad', 'not base64url!', 10, 50)", [owner]),
    /projects_design_check/,
  );
  await assert.rejects(
    db.query("select public.create_project($1::uuid, '', 'abc', 10, 50)", [owner]),
    /projects_name_check/,
  );
  await assert.rejects(
    db.query("select public.create_project($1::uuid, 'Bad', 'abc', 10, 50, '[]'::jsonb)", [owner]),
    /projects_info_object/,
  );
  assert.equal(await count("projects", owner), 0);
  assert.equal(await count("project_creations", owner), 0, "a refused insert uses no allowance");
});

test("create_project: only the server may call it", async () => {
  const r = await db.query(
    `select has_function_privilege($1, 'public.create_project(uuid, text, text, integer, integer, jsonb, jsonb)', 'execute') as ok`,
    ["anon"],
  );
  assert.equal(r.rows[0].ok, false);
  const auth = await db.query(
    `select has_function_privilege($1, 'public.create_project(uuid, text, text, integer, integer, jsonb, jsonb)', 'execute') as ok`,
    ["authenticated"],
  );
  assert.equal(auth.rows[0].ok, false);
  const service = await db.query(
    `select has_function_privilege($1, 'public.create_project(uuid, text, text, integer, integer, jsonb, jsonb)', 'execute') as ok`,
    ["service_role"],
  );
  assert.equal(service.rows[0].ok, true);
});

// Runs fn as the browser would reach the database: with the anon key, or
// signed in as `uid` (the role and the JWT claim are local to the transaction).
// A statement the policies refuse aborts the transaction, so each expected
// refusal gets a transaction of its own.
function as(role, uid, fn) {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`);
    if (uid) await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
    return fn(tx);
  });
}

test("row-level security: a signed-in owner reads only their own projects and can't write them", async () => {
  await db.query("insert into auth.users (id) values ($1::uuid), ($2::uuid) on conflict do nothing", [USER, OTHER]);
  await create(USER, 10, 50, "Mine");
  await create(OTHER, 10, 50, "Theirs");
  const seen = await as("authenticated", USER, (tx) => tx.query("select name from public.projects order by name"));
  assert.deepEqual(
    seen.rows.map((r) => r.name),
    ["Mine"],
  );
  const creations = await as("authenticated", USER, (tx) =>
    tx.query("select count(*)::int as n from public.project_creations"),
  );
  assert.equal(creations.rows[0].n, 0, "the allowance ledger is the server's alone");
  // No insert, update or delete policy: writes go through api/projects.js.
  const upd = await as("authenticated", USER, (tx) =>
    tx.query("update public.projects set name = 'Renamed' where name = 'Mine' returning id"),
  );
  assert.equal(upd.rows.length, 0);
  const del = await as("authenticated", USER, (tx) =>
    tx.query("delete from public.projects where name = 'Mine' returning id"),
  );
  assert.equal(del.rows.length, 0);
  await assert.rejects(
    as("authenticated", USER, (tx) =>
      tx.query("insert into public.projects (owner_id, name) values ($1::uuid, 'Sneaked')", [USER]),
    ),
    /row-level security/,
  );
  const still = await db.query("select name from public.projects where owner_id = $1::uuid", [USER]);
  assert.deepEqual(
    still.rows.map((r) => r.name),
    ["Mine"],
  );
});

test("row-level security: the anon key reads nothing", async () => {
  for (const table of ["businesses", "subscriptions", "projects", "project_creations", "leads"]) {
    const r = await as("anon", null, (tx) => tx.query(`select count(*)::int as n from public.${table}`));
    assert.equal(r.rows[0].n, 0, table);
  }
  await assert.rejects(
    as("anon", null, (tx) => tx.query("select * from public.site_switches")),
    /permission denied/,
  );
});

test("kill switch: with signups off, the auth.users trigger refuses a new account", async () => {
  await db.query("update public.site_switches set signups = false where id = 1");
  await assert.rejects(
    db.query("insert into auth.users (id) values ($1::uuid)", ["33333333-3333-4333-8333-333333333333"]),
    /signups-paused/,
  );
  await db.query("update public.site_switches set signups = true where id = 1");
  await db.query("insert into auth.users (id) values ($1::uuid)", ["33333333-3333-4333-8333-333333333333"]);
  const r = await db.query("select count(*)::int as n from auth.users where id = $1::uuid", [
    "33333333-3333-4333-8333-333333333333",
  ]);
  assert.equal(r.rows[0].n, 1);
});

test("deleting the auth user cascades to the business, subscription, projects and allowance", async () => {
  const owner = await newUser();
  await db.query("insert into public.businesses (owner_id, slug, name) values ($1::uuid, 'cascade-co', 'Cascade')", [
    owner,
  ]);
  await db.query("insert into public.subscriptions (owner_id, status) values ($1::uuid, 'active')", [owner]);
  await create(owner, 10, 50);
  await db.query("delete from auth.users where id = $1::uuid", [owner]);
  for (const table of ["businesses", "subscriptions", "projects", "project_creations"]) {
    assert.equal(await count(table, owner), 0, table);
  }
});
