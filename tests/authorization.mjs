import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create schema auth; create schema storage;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth,storage to authenticated;
grant execute on function auth.uid() to authenticated;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id bigint generated always as identity, bucket_id text,name text, unique(bucket_id,name));
alter table storage.objects enable row level security;
grant select,insert,delete,update on storage.objects to authenticated;
grant usage,select on all sequences in schema storage to authenticated;
create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;`);
await db.exec(
  readFileSync(new URL('../supabase/migrations/001_initial.sql', import.meta.url), 'utf8').replace(
    /^\uFEFF/,
    '',
  ),
);
const a = '00000000-0000-0000-0000-000000000001',
  b = '00000000-0000-0000-0000-000000000002',
  admin = '00000000-0000-0000-0000-000000000003';
await db.exec(
  `insert into auth.users values('${a}'),('${b}'),('${admin}'); insert into public.admin_users values('${admin}');`,
);
const as = async (id) => {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec('set role authenticated');
};
const rows = async (sql) => (await db.query(sql)).rows;
const denied = async (sql) => {
  await assert.rejects(db.exec(sql));
};
for (const id of [a, b]) {
  await as(id);
  await db.exec(
    `insert into public.profiles(id,display_name,age,city,education,occupation,about) values('${id}','Test',25,'Pune','Degree','Engineer','A sufficiently detailed test profile.');`,
  );
}
await as(a);
assert.equal((await rows('select * from profiles')).length, 1);
await denied("update profiles set status='approved'");
await denied(`insert into admin_users values('${a}')`);
await denied(`select review_profile('${a}',true,'')`);
await db.exec(`update profiles set display_name='Intruder' where id='${b}'`);
await as(admin);
assert.equal(
  (await rows(`select display_name from profiles where id='${b}'`))[0].display_name,
  'Test',
);
await db.exec(`select review_profile('${b}',true,'');`);
await as(a);
assert.equal((await rows('select * from profiles')).length, 1);
await as(admin);
await db.exec(`select review_profile('${a}',true,'');`);
await as(a);
assert.equal((await rows('select * from profiles')).length, 2);
await db.exec('update profiles set display_name=display_name');
assert.equal((await rows('select status from profiles'))[0].status, 'pending');
for (let n = 1; n <= 5; n++)
  await db.exec(
    `insert into storage.objects(bucket_id,name) values('profile-photos','${a}/${n}.webp')`,
  );
await denied(`insert into storage.objects(bucket_id,name) values('profile-photos','${a}/6.webp')`);
await denied(
  `insert into storage.objects(bucket_id,name) values('profile-photos','${a}/nested/1.webp')`,
);
await denied(`insert into storage.objects(bucket_id,name) values('profile-photos','${b}/1.webp')`);
await as(admin);
await db.exec(`select review_profile('${a}',true,'');`);
await as(a);
await db.exec(`delete from storage.objects where name='${a}/1.webp'`);
assert.equal((await rows('select status from profiles'))[0].status, 'pending');
await as(admin);
await db.exec(`select review_profile('${a}',false,'Please update');`);
await as(a);
await db.exec('update profiles set display_name=display_name');
assert.equal((await rows('select status from profiles'))[0].status, 'pending');
await as(b);
assert.equal((await rows('select * from storage.objects')).length, 0);
await db.exec('reset role; set role anon;');
await denied('select * from profiles');
await db.close();
console.log(
  'PASS: migration, private pending profiles, admin-only approvals, cross-account edits, re-review, rejected resubmission, five photo slots, photo privacy, anonymous access.',
);
