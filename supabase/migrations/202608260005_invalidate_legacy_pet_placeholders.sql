with placeholder_replies as (
  select in_reply_to_id
  from public.pet_private_threads
  where role = 'pet'
    and in_reply_to_id is not null
    and content ~ '(凑近观察|先观察一下).*(再告诉|告诉你.*发现)'
)
update public.pet_private_threads owner_message
set reply_status = 'failed',
    reply_error_code = 'legacy_placeholder_reply',
    reply_phase_updated_at = now(),
    reply_completed_at = now()
where owner_message.id in (select in_reply_to_id from placeholder_replies);

update public.pet_private_threads
set content = '这是一条旧版未完成的占位回复，已作废。请在上一条问题下点击“重试”。'
where role = 'pet'
  and content ~ '(凑近观察|先观察一下).*(再告诉|告诉你.*发现)';
