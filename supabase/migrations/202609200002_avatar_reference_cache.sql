-- Only the authenticated Edge handler may ask for storage signing inputs.
-- The returned paths are never exposed to the caller or accepted from it.
create or replace function public.resolve_avatar_references(p_viewer uuid, p_references jsonb)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare item jsonb; ref text; scope uuid; asset uuid; pet_row public.pets;
  asset_row public.avatar_assets; visual public.pet_visual_assets;
  pref public.pet_display_preferences; job public.pet_transparent_jobs;
  output jsonb='[]'::jsonb; resolved jsonb; is_published boolean; valid_binding boolean;
begin
  if p_viewer is null or jsonb_typeof(p_references)<>'array' or jsonb_array_length(p_references)>50 then raise exception 'avatar_input_invalid'; end if;
  if not exists(select 1 from public.profiles where id=p_viewer)
    or exists(select 1 from public.chat_background_owner_controls where owner_id=p_viewer and deleting) then raise exception 'avatar_forbidden'; end if;
  for item in select value from jsonb_array_elements(p_references) loop
    ref=item->>'reference'; scope=nullif(item->>'space_id','')::uuid;
    resolved=jsonb_build_object('reference',ref,'space_id',scope,'error','avatar_forbidden');
    if scope is not null and not exists(select 1 from public.space_members where space_id=scope and user_id=p_viewer) then
      output=output||jsonb_build_array(jsonb_set(resolved,'{error}','"avatar_scope_forbidden"'::jsonb)); continue;
    end if;
    if ref ~* '^avatar://[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      asset=substring(ref from 10)::uuid;
      select * into asset_row from public.avatar_assets where id=asset;
      if asset_row.id is not null and public.can_read_avatar(asset,p_viewer)
        and not exists(select 1 from public.chat_background_owner_controls where owner_id=asset_row.owner_id and deleting) then
        select exists(select 1 from public.avatar_bindings b where b.asset_id=asset and (
          (b.target_kind='space' and (scope is null or b.target_id=scope) and exists(select 1 from public.space_members where space_id=b.target_id and user_id=p_viewer)) or
          (b.target_kind='profile' and ((scope is null and b.target_id=p_viewer) or exists(
            select 1 from public.space_members mine join public.space_members peer on peer.space_id=mine.space_id
            where mine.user_id=p_viewer and peer.user_id=b.target_id and (scope is null or mine.space_id=scope))))
        )) into valid_binding;
        is_published=valid_binding;
        -- Personal editor can preview its own draft; a group can only request a published avatar.
        if valid_binding or (scope is null and asset_row.owner_id=p_viewer) then
          resolved=jsonb_build_object('reference',ref,'space_id',scope,'bucket','avatars','path',asset_row.storage_path,
            'version',asset_row.id::text||':'||asset_row.content_sha256,'published',is_published);
        end if;
      end if;
    elsif ref ~* '^pet-avatar://[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select * into pet_row from public.pets where id=substring(ref from 14)::uuid and status='confirmed';
      if pet_row.id is not null
        and not exists(select 1 from public.chat_background_owner_controls where owner_id=pet_row.owner_id and deleting)
        and ((scope is null and pet_row.owner_id=p_viewer) or exists(
          select 1 from public.space_members mine join public.space_members peer on peer.space_id=mine.space_id
          where mine.user_id=p_viewer and peer.user_id=pet_row.owner_id and (scope is null or mine.space_id=scope))) then
        select * into visual from public.pet_visual_assets where id=pet_row.current_asset_id and pet_id=pet_row.id and not is_draft and superseded_at is null;
        if visual.id is not null then
          resolved=jsonb_build_object('reference',ref,'space_id',scope,'bucket','pet-portraits','path',visual.storage_path,'version',visual.id::text,'published',true);
          select * into pref from public.pet_display_preferences where pet_id=pet_row.id and owner_id=pet_row.owner_id;
          if pref.use_transparent and pref.approved_at is not null and pref.approved_source_asset_id=visual.id and pref.approved_display_version=pref.version then
            select * into job from public.pet_transparent_jobs where id=pref.approved_job_id and pet_id=pet_row.id
              and owner_id=pet_row.owner_id and source_asset_id=visual.id and expected_display_version=pref.version and status='succeeded';
            if job.output_path is not null then
              resolved=jsonb_build_object('reference',ref,'space_id',scope,'bucket','pet-transparent','path',job.output_path,
                'version',visual.id::text||':'||job.id::text||':'||pref.version::text,'published',true);
            end if;
          end if;
        else resolved=jsonb_build_object('reference',ref,'space_id',scope,'version','none','published',true); end if;
      end if;
    end if;
    output=output||jsonb_build_array(resolved);
  end loop;
  return output;
end $$;
revoke all on function public.resolve_avatar_references(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.resolve_avatar_references(uuid,jsonb) to service_role;

create or replace function public.read_space_avatar_state(p_viewer uuid,p_space uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare binding public.avatar_bindings;
begin
  if not exists(select 1 from public.space_members where space_id=p_space and user_id=p_viewer)
    or exists(select 1 from public.chat_background_owner_controls where owner_id=p_viewer and deleting) then raise exception 'avatar_scope_forbidden'; end if;
  select * into binding from public.avatar_bindings where target_kind='space' and target_id=p_space;
  return jsonb_build_object('reference',case when binding.asset_id is null then null else 'avatar://'||binding.asset_id::text end,
    'version',coalesce(binding.version,0),'members',coalesce((select jsonb_agg(jsonb_build_object('id',m.user_id,
      'nickname',p.nickname,'avatarUrl',p.avatar_url,'joinedAt',m.joined_at) order by m.joined_at,m.user_id)
      from public.space_members m join public.profiles p on p.id=m.user_id where m.space_id=p_space),'[]'::jsonb));
end $$;
revoke all on function public.read_space_avatar_state(uuid,uuid) from public,anon,authenticated;
grant execute on function public.read_space_avatar_state(uuid,uuid) to service_role;

-- Backward-compatible shape: old clients show their existing name placeholder
-- for this new pointer instead of incorrectly rendering the owner's portrait.
create or replace function public.list_space_mention_targets(target_space_id uuid)
returns table(target_kind text,target_id uuid,display_name text,owner_name text,avatar_url text)
language sql stable security definer set search_path=public,pg_temp as $$
  select 'user'::text,profile.id,profile.nickname,null::text,profile.avatar_url
  from public.space_members member join public.profiles profile on profile.id=member.user_id
  where member.space_id=target_space_id and public.is_space_member(target_space_id)
  union all
  select 'pet'::text,pet.id,pet.name,owner.nickname,'pet-avatar://'||pet.id::text
  from public.space_members member join public.pets pet on pet.owner_id=member.user_id and pet.status='confirmed'
  join public.profiles owner on owner.id=pet.owner_id
  where member.space_id=target_space_id and public.is_space_member(target_space_id)
  order by 1,3
$$;
grant execute on function public.list_space_mention_targets(uuid) to authenticated;
