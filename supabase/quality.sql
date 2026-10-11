create index payments_appointment_studio_idx on public.payments(appointment_id,studio_id);
create index request_limits_expiry_idx on encaixa_private.request_limits(expires_at);
create policy service_only on encaixa_private.request_limits for all to service_role using(true) with check(true);
