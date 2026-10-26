-- 002_crm_enums.sql
-- All CRM enum types. Values mirror Backend/src/domain/enums.ts, minus the retired ones
-- (maybe, negative, maybe_nurture, negative_nurture, call_outcome_maybe,
-- call_outcome_negative, lead_source 'website'). The old lead_lifecycle_state is split into
-- contact_status (consent, on the contact) and deal_outcome (journey, on the deal).

begin;

create type public.crm_user_role as enum ('admin', 'salesperson');

create type public.crm_lead_source as enum (
  'linkedin', 'email', 'cold_call', 'referral', 'event', 'inbound_form', 'other'
);

create type public.crm_contact_status as enum ('active', 'do_not_contact', 'merged');

create type public.crm_deal_outcome as enum ('open', 'won', 'lost', 'nurture', 'discarded');

create type public.crm_pipeline_stage as enum (
  'new',
  'ready_for_first_call',
  'contact_attempted',
  'not_connected_nurture',
  'connected_qualifying',
  'interested_later',
  'future_possibility',
  'objection_nurture',
  'meeting_scheduling',
  'meeting_scheduled',
  'meeting_follow_up',
  'proposal_preparation',
  'proposal_sent',
  'proposal_decision_pending',
  'negotiation'
);

create type public.crm_automation_mode as enum ('active', 'paused', 'manual', 'stopped');

create type public.crm_response_state as enum (
  'no_response', 'responded', 'conversation_active', 'waiting_on_customer', 'waiting_on_us'
);

create type public.crm_contact_channel as enum ('phone', 'email', 'whatsapp');

create type public.crm_objection_type as enum (
  'commission_only', 'internal_hiring', 'existing_team', 'budget_price', 'internal_approval', 'wrong_fit'
);

create type public.crm_loss_reason as enum (
  'price_budget',
  'internal_hiring',
  'project_postponed',
  'competitor_selected',
  'management_rejected',
  'no_urgency',
  'no_response',
  'other'
);

create type public.crm_call_not_connected_reason as enum (
  'no_answer',
  'busy',
  'call_rejected',
  'switched_off',
  'temporarily_unreachable',
  'voicemail',
  'network_failure',
  'invalid_number',
  'wrong_number',
  'other'
);

create type public.crm_call_connected_outcome as enum (
  'positive',
  'meeting_agreed',
  'interested_later',
  'future_possibility',
  'callback_requested',
  'information_requested',
  'commission_only',
  'internal_hiring',
  'existing_team',
  'budget_price',
  'internal_approval',
  'wrong_fit',
  'wrong_person',
  'do_not_contact'
);

create type public.crm_task_type as enum (
  'call',
  'follow_up',
  'send_information',
  'send_case_study',
  'send_email',
  'send_whatsapp',
  'schedule_meeting',
  'confirm_meeting',
  'reschedule',
  'prepare_proposal',
  'send_proposal',
  'proposal_follow_up',
  'nurture',
  're_engage',
  'internal_review',
  'general_task'
);

create type public.crm_task_status as enum ('open', 'completed', 'cancelled');

create type public.crm_task_origin as enum ('manual', 'automation');

create type public.crm_meeting_status as enum (
  'tentative', 'scheduled', 'confirmed', 'rescheduled', 'completed', 'cancelled', 'no_show', 'failed'
);

create type public.crm_meeting_outcome as enum (
  'proposal_required',
  'highly_interested',
  'needs_internal_discussion',
  'needs_more_information',
  'won',
  'follow_up_required',
  'second_meeting',
  'not_interested',
  'no_proposal_required'
);

create type public.crm_proposal_status as enum (
  'draft',
  'uploaded',
  'ready_to_send',
  'sent',
  'revision_requested',
  'revised',
  'accepted',
  'rejected',
  'withdrawn',
  'expired'
);

create type public.crm_workflow_trigger as enum (
  'lead_created',
  'meeting_scheduled',
  'meeting_agreed',
  'call_not_connected',
  'call_outcome_interested_later',
  'call_outcome_future_possibility',
  'call_outcome_information_requested',
  'objection_commission_only',
  'objection_internal_hiring',
  'objection_existing_team',
  'objection_budget_price',
  'objection_internal_approval',
  'meeting_needs_more_information',
  'meeting_not_ready',
  'meeting_highly_interested',
  'meeting_proposal_requested',
  'meeting_not_a_fit',
  'proposal_pending',
  'manual_enrollment'
);

create type public.crm_workflow_status as enum ('active', 'paused');

create type public.crm_workflow_version_status as enum ('draft', 'published', 'previous');

create type public.crm_workflow_step_action as enum (
  'send_email',
  'send_whatsapp',
  'create_call_task',
  'create_follow_up_task',
  'change_lead_stage',
  'stop_workflow'
);

create type public.crm_workflow_run_status as enum (
  'running', 'waiting', 'paused', 'completed', 'failed', 'cancelled'
);

create type public.crm_scheduled_action_status as enum (
  'pending', 'due', 'executing', 'completed', 'failed', 'cancelled', 'paused', 'skipped'
);

create type public.crm_template_channel as enum ('email', 'whatsapp');

create type public.crm_notification_kind as enum ('info', 'warning', 'success', 'danger');

create type public.crm_actor_source as enum ('user', 'system', 'automation', 'brain');

commit;
