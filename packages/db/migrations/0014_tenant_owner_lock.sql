-- The last-owner guard (apps/web lib/member-actions.ts), counted inside the
-- transaction that acts on it.
--
-- Demoting or removing a portrait's owner — or an owner leaving it — is
-- refused when nobody else would keep owner authority over the portrait:
-- its other tenant-level owners, and the owners of the organization holding
-- it (member_role()'s rule, 0003). The app used to count them in the system
-- context, on a second pooled connection while the action's own userDb
-- transaction held the first: as many such requests at once as the pool has
-- connections would each hold one and wait for another, for good. And the
-- count came from a separate snapshot, with no lock, so two owners demoting
-- each other at the same moment could each still count the other and leave
-- the portrait with no owner at all.
--
-- This function is that count, on the caller's own transaction, and the lock
-- that makes it safe to act on: every owner row it counts is locked FOR
-- UPDATE until the caller's transaction ends. A second request counting the
-- same portrait waits for the first to commit; READ COMMITTED then re-checks
-- each row it waited for, so an owner the first request demoted or removed
-- is no longer counted, and the second is refused. Organization owners are
-- locked as well, so removing one (removeOrgMember locks the organization's
-- owner rows itself) is serialized with a portrait-level change that counted
-- them. One statement, so everything counted is exactly what was locked.
--
-- Rows are locked in user_id order, here and in the app's organization-level
-- twin (lockedOrgOwnerCount), so two requests locking overlapping owners
-- always take them in the same order and queue instead of deadlocking.
--
-- SECURITY DEFINER because the caller's role cannot see every row it counts:
-- a tenant-level owner who is not a member of the organization cannot read
-- its owners (organization_members_member_read, 0003). Only the count leaves
-- the function, and the app checks the owner role before it asks. It takes
-- row locks, so only the app role may call it: EXECUTE is revoked from
-- PUBLIC, which every new function grants it by default.
CREATE OR REPLACE FUNCTION public.lock_tenant_owners(p_tenant_id uuid) RETURNS integer
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public
  AS $$
    WITH tenant_owners AS MATERIALIZED (
      SELECT user_id FROM tenant_members
       WHERE tenant_id = p_tenant_id AND role = 'owner'
       ORDER BY user_id
         FOR UPDATE
    ), organization_owners AS MATERIALIZED (
      SELECT om.user_id FROM organization_members om
        JOIN tenants t ON t.organization_id = om.organization_id
       WHERE t.id = p_tenant_id AND om.role = 'owner'
       ORDER BY om.user_id
         FOR UPDATE OF om
    )
    SELECT count(DISTINCT user_id)::int FROM (
      SELECT user_id FROM tenant_owners
      UNION
      SELECT user_id FROM organization_owners
    ) owners
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.lock_tenant_owners(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.lock_tenant_owners(uuid) TO deep_fryer_app;
