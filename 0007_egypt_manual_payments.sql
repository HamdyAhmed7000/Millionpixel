-- Manual transfers only: 50 EGP per spot. Receipt approval remains an admin action.
-- Existing referral balances remain in spot-credit units (one unit = one spot).
-- Historical claims retain their original amounts and have no EGP amount backfilled.
begin;
alter table public.slot_claims
  add column if not exists payment_method text check (payment_method in ('instapay', 'vodafone_cash', 'credits')),
  add column if not exists payment_reference text check (char_length(payment_reference) between 3 and 100),
  add column if not exists payment_amount_egp numeric(10,2) check (payment_amount_egp >= 0);

grant insert (payment_method, payment_reference) on public.slot_claims to authenticated;

create or replace function private.set_claim_egypt_payment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Runs after prepare_claim_credits, which computes amount_due on the server.
  new.payment_amount_egp := round(new.amount_due * 50, 2);
  new.payment_reference := nullif(upper(trim(coalesce(new.payment_reference, ''))), '');
  if new.amount_due > 0 then
    if new.payment_method is null or new.payment_method not in ('instapay', 'vodafone_cash') then
      raise exception 'Please refresh the website and select InstaPay or Vodafone Cash';
    end if;
    if new.payment_reference is null or char_length(new.payment_reference) not between 3 and 100 then
      raise exception 'A transaction reference between 3 and 100 characters is required';
    end if;
    if coalesce(new.proof_path, '') = '' then
      raise exception 'A successful transfer receipt is required';
    end if;
  else
    new.payment_method := 'credits';
    new.payment_reference := null;
  end if;
  return new;
end;
$$;
revoke all on function private.set_claim_egypt_payment() from public, anon, authenticated;
drop trigger if exists set_claim_egypt_payment on public.slot_claims;
create trigger set_claim_egypt_payment before insert on public.slot_claims
  for each row execute function private.set_claim_egypt_payment();

create unique index if not exists slot_claims_payment_reference
  on public.slot_claims (payment_method, upper(payment_reference))
  where payment_reference is not null and status <> 'rejected';
notify pgrst, 'reload schema';
commit;

select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'slot_claims'
  and column_name in ('payment_method', 'payment_reference', 'payment_amount_egp')
order by column_name;
