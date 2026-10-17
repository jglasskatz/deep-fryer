CREATE TABLE IF NOT EXISTS "sign_in_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ip_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sign_in_requests_rate_idx" ON "sign_in_requests" USING btree ("ip_hash","created_at");--> statement-breakpoint
-- ---- Sign-in requests: the per-address limit on magic-link emails ----
-- Anyone can type any email address into the sign-in form, and each request
-- sends a real email from the deployment's domain; without a limit the form
-- is a way to mail strangers in bulk, and to burn the domain's sending
-- reputation. Each request is recorded here by a keyed hash of the network
-- address it came from (never the address itself), and the sign-in path
-- refuses once an address has asked too often within the window
-- (packages/db sign-in-requests.ts admitSignInRequest).
--
-- Auth plumbing, like accounts, sessions and verification_tokens (0005): it
-- is written and read before any session exists, in the system context (the
-- owner role), and never on a person's behalf. The default privileges from
-- 0005 grant every new table to the app role, so they are taken back here;
-- RLS with no policies (as for billing_events, 0003) is the second layer if a
-- grant is ever added by mistake. The owner is the system context by design
-- and is not FORCE'd (0005).
REVOKE ALL ON sign_in_requests FROM deep_fryer_app;
--> statement-breakpoint
ALTER TABLE sign_in_requests ENABLE ROW LEVEL SECURITY;
