-- Apply once through the Supabase SQL editor. Enable email confirmation in Auth.
create table public.admin_users (user_id uuid primary key references auth.users(id) on delete cascade);
alter table public.admin_users enable row level security;
revoke all on public.admin_users from anon, authenticated;
create function public.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.admin_users where user_id = auth.uid());
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null check (length(trim(display_name)) between 1 and 80),
 age integer not null check(age between 18 and 100),
 city text not null check(length(trim(city)) between 1 and 80),
 education text not null check(length(trim(education)) between 1 and 120),
 occupation text not null check(length(trim(occupation)) between 1 and 120),
 about text not null check(length(trim(about)) between 20 and 1500),
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 review_note text not null default '',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create index profiles_status_idx on public.profiles(status);
create function public.is_approved_member() returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.profiles where id = auth.uid() and status = 'approved');
$$;
revoke all on function public.is_approved_member() from public;
grant execute on function public.is_approved_member() to authenticated;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant insert(id, display_name, age, city, education, occupation, about) on public.profiles to authenticated;
grant update(id, display_name, age, city, education, occupation, about) on public.profiles to authenticated;
create policy profile_read on public.profiles for select to authenticated using (
 id = auth.uid() or public.is_admin() or (status = 'approved' and public.is_approved_member())
);
create policy profile_create on public.profiles for insert to authenticated with check(id = auth.uid());
create policy profile_edit on public.profiles for update to authenticated using(id = auth.uid()) with check(id = auth.uid());
create function public.reset_profile_review() returns trigger language plpgsql set search_path = '' as $$
begin
 new.status := 'pending'; new.review_note := '';
 new.updated_at := now();
 return new;
end;
$$;
create trigger profile_review_reset before update of display_name, age, city, education, occupation, about on public.profiles for each row execute function public.reset_profile_review();
create table public.profile_reviews (
 id bigint generated always as identity primary key,
 profile_id uuid not null references public.profiles(id) on delete cascade,
 admin_id uuid not null references auth.users(id),
 decision text not null,
 note text not null,
 created_at timestamptz not null default now()
);
alter table public.profile_reviews enable row level security;
revoke all on public.profile_reviews from anon, authenticated;
grant select on public.profile_reviews to authenticated;
create policy admin_review_read on public.profile_reviews for select to authenticated using(public.is_admin());
create function public.review_profile(target_id uuid, approve boolean, note text default '') returns void language plpgsql security definer set search_path = '' as $$
begin
 if not public.is_admin() then raise exception 'Admin access required'; end if;
 update public.profiles set status = case when approve then 'approved' else 'rejected' end, review_note = left(coalesce(note,''),1000) where id = target_id and status = 'pending';
 if not found then raise exception 'Profile is no longer awaiting review. Refresh the queue.'; end if;
 insert into public.profile_reviews(profile_id, admin_id, decision, note) values(target_id, auth.uid(), case when approve then 'approved' else 'rejected' end, left(coalesce(note,''),1000));
end;
$$;
revoke all on function public.review_profile(uuid,boolean,text) from public;
grant execute on function public.review_profile(uuid,boolean,text) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('profile-photos','profile-photos',false,2097152,array['image/webp']);
-- Fixed object names enforce a maximum of five objects per account, including concurrent requests.
create policy photo_insert on storage.objects for insert to authenticated with check (
 bucket_id = 'profile-photos' and name ~ ('^' || auth.uid()::text || '/[1-5]\.webp$')
 and exists(select 1 from public.profiles where id = auth.uid())
);
create policy photo_read on storage.objects for select to authenticated using (
 bucket_id = 'profile-photos' and (
 (storage.foldername(name))[1] = auth.uid()::text or public.is_admin() or (
 public.is_approved_member() and exists(select 1 from public.profiles where id::text = (storage.foldername(name))[1] and status = 'approved')
 ))
);
create policy photo_delete on storage.objects for delete to authenticated using (
 bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text
);
-- No object UPDATE policy: replacements must be delete + upload.
-- Invalidate approval atomically whenever photos change, even outside the Angular interface.
create function public.photo_requires_review() returns trigger language plpgsql security definer set search_path = '' as $$
declare object_name text; bucket text;
begin
 if TG_OP = 'DELETE' then object_name := old.name; bucket := old.bucket_id;
 else object_name := new.name; bucket := new.bucket_id; end if;
 if bucket = 'profile-photos' then
   update public.profiles set status = 'pending', review_note = '' where id::text = split_part(object_name,'/',1);
 end if;
 return null;
end;
$$;
create trigger photo_review_reset after insert or delete on storage.objects for each row execute function public.photo_requires_review();
