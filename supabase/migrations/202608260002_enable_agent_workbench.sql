begin;

update public.demo_settings
set agent_workbench_enabled = true,
    structured_pet_onboarding_enabled = true,
    implicit_pet_replies_enabled = false,
    updated_at = now()
where id = true;

commit;
