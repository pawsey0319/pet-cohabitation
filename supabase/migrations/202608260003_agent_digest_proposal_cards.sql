alter table public.agent_jobs
  add column if not exists agent_request_id uuid references public.agent_requests(id) on delete cascade;

create unique index if not exists agent_jobs_request_once_idx
  on public.agent_jobs(agent_request_id)
  where agent_request_id is not null;

alter table public.messages
  add column if not exists agent_proposal_id uuid references public.agent_proposals(id) on delete set null;

create unique index if not exists messages_proposal_notice_once_idx
  on public.messages(agent_proposal_id)
  where agent_proposal_id is not null;

create unique index if not exists messages_agent_client_once_idx
  on public.messages(space_id, client_id)
  where sender_id is null;

alter table public.agent_jobs replica identity full;
alter table public.messages replica identity full;
