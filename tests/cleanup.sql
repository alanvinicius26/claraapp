-- Only exact synthetic accounts created by fixture.sql; cascade removes test-only app records.
delete from auth.sessions where user_id in (select id from auth.users where email in ('encaixa-test-a@example.invalid','encaixa-test-b@example.invalid'));
delete from auth.users where email in ('encaixa-test-a@example.invalid','encaixa-test-b@example.invalid');
