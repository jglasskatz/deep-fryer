# deep-fryer — Design Spec v6: getting involved, and the resident and staff flows

**Status:** In implementation on `claude/production-pwa-billing`, 2026-10-16.
Source: the owner's request to see the experience end to end — sign in,
explore the doughnut, comment — for city staff (NYC: the Mayor's
administration) and for a New York resident; "how to get involved" drawn
from NYC programs and organizations; and a way for organizations to put
themselves forward on any page. Amends SPEC-v5. Decisions not made with
the owner are marked **[P]**.

## 1. What a walk through the product found

The flows were walked on the production stack (Caddy, real magic-link
email) as a resident on a phone and as city staff on a laptop. Findings
this spec fixes:

| Flow | Finding | Fix |
|---|---|---|
| Explore | On a phone the doughnut is ~300 px wide: labels are unreadable and a tap on "Housing" opened Networks. The list of dimensions exists only for keyboard users (visually hidden until focused). | §2.1 a visible, tappable list of dimensions under the doughnut. |
| Sign in | The page is English only, though residents reach it from translated pages (Local Law 30). | §2.2 sign-in in every language. |
| Sign in | "Send link" gives no feedback for several seconds; the "check your email" URL is malformed (`?sent=1?provider=…`). | §2.2 a sending state; a proper check-your-email page. |
| Sign in | The header's sign-in returns people to the portrait's front page, not the page they were on. | §2.2 return to the current page. |
| Comment | A resident's first comment is held for approval, but the thread then shows it to everyone — its author and moderators included — as "[removed by moderators]" with the text blanked. Moderators cannot read what they are approving; the only action offered is "restore". | §3.1 held comments are visible to their author and to moderators, with Approve / Decline. |
| Comment | Nothing tells staff a comment is waiting; the admin overview counts held comments as ordinary ones. | §3.2 a discussion queue and an overview callout. |
| Comment | Residents cannot tell when the city answered. | §3.3 a "Staff" label on comments by the portrait's team. |
| Get involved | The "Get involved" page reads a table nothing writes; NYC's programs exist only as plain-text bullets with no links or organizations. | §4. |

## 2. Resident flow

### 2.1 Explore the doughnut

Below the doughnut, every dimension is listed in two groups (social
foundation, ecological ceiling), each row a link of at least 44 px with the
dimension's name, its status in words (within / shortfall / overshoot / no
data) and its headline value. The canvas stays the overview; the list is the
way in on a phone and for anyone who prefers text. It replaces the
keyboard-only list.

### 2.2 Sign in

- All text from the language catalogs, like every public page.
- "Send link" shows "Sending…" and is disabled until the server answers.
- Auth.js's verify-request page is `/login/check-email`: it says where to
  look, that the link works once for 15 minutes, and offers to send again.
- The header's "Sign in" carries the current path as `next`; a person who
  started on Housing comes back to Housing.

## 3. Discussion moderation

### 3.1 Held comments

A first comment from a new account is held (unchanged policy). Held comments
are now:

- shown to their author, with their text and an "Awaiting approval" label;
- shown to moderators with their text and **Approve** / **Decline**;
- not shown to anyone else (no "[removed]" placeholder for something that
  was never public).

A comment a moderator removed keeps the "[removed by moderators]"
placeholder, and a moderator can still restore it.

### 3.2 Staff queue

`/{tenant}/admin/discussion` lists held comments across all dimensions —
dimension, author (pseudonym or display name), text, time — with Approve and
Decline, and links to each thread. The admin overview shows "N comments
awaiting approval" when there are any, and the admin navigation counts them.

### 3.3 Staff label

Comments written by a member of the portrait's team (any tenant role, or an
owner of the organization that owns the portrait) carry a "Staff" label, so
residents can see an official answer. Membership is read through a
`SECURITY DEFINER` function that returns only which of the given authors are
staff — never roles or emails.

## 4. Getting involved

### 4.1 Listings

An **involvement listing** is one way to get involved: a program, an
organization, a public body, or a campaign. Fields: name, what you can do
(plain language, ≤ 600 chars), link (https), phone, kind, the dimensions it
serves (empty = all), and when staff last checked the link. Kinds, shown in
words:

| Kind | Meaning |
|---|---|
| `volunteer` | Give time: cleanups, food banks, tutoring |
| `services` | Get help or enroll: benefits, programs, legal help |
| `civic` | Have your say: community boards, hearings, public comment, elections |
| `organize` | Join a group or campaign |
| `other` | Anything else |

Listings are curated by staff or come from approved submissions; only
published listings are public (RLS). Each dimension page shows its listings
under **How to get involved**, followed by the dimension's existing short
actions. The **Get involved** page shows every listing grouped by dimension,
with a filter, and the general submission form. Listing text is shown as
entered (staff content, English-content notice applies).

### 4.2 Organizations put themselves forward

Every dimension page and the Get involved page carry a short form:

- **What are you sharing?** — "My organization is a way to get involved" or
  "A suggestion for how people can get involved".
- **Dimension** — preselected on a dimension page; "Several / not sure"
  allowed.
- **Organization or group** (required for an organization), **who you are**
  (required for an organization), **why it's a good way to get involved with
  this dimension — or your suggestion** (required), **website** (optional).
- **Contact**: name and email (required), phone (optional). Contact details
  are never published; the form says so.

No account is needed **[P]** — organizations should not have to sign up to
be listed. Abuse is handled by: a hidden honeypot field; a signed form token
that must be at least three seconds old; limits of 5 submissions per network
address per hour per portrait and 3 per email per day (addresses are stored
only as a keyed hash); length limits; and, above all, nothing is published
without a staff decision. No email is sent to the submitter, so the form
cannot be used to send mail to arbitrary addresses **[P]**.

### 4.3 Staff review

`/{tenant}/admin/involvement` has two parts:

- **Submissions** (new / approved / declined / spam): each with the
  organization, dimension, pitch, website (shown as its domain, not a live
  link until approved), and contact (mailto/tel). **Approve** opens a listing
  form prefilled from the submission for staff to edit before saving;
  **Decline** and **Spam** take an optional note.
- **Listings**: add, edit, publish/unpublish, delete, and "Link checked
  today", which stamps the date residents see ("Checked by staff on …").

The admin overview and navigation count new submissions.

### 4.4 NYC

`scripts/nyc-involvement.ts` proposes listings for the six NYC portraits from
New York City programs and organizations, each with the public page it was
taken from. As with the emergency proposal, it is a dry run until `--apply`;
it writes listings **unpublished**, records whether each link answered from
where it ran (`link_checked_at` only when it did), and leaves rows staff have
edited alone. City staff review, check, and publish.

## 5. Data (migration 0010)

- `involvement_listings` — public read when published; editors write.
- `involvement_submissions` — anyone may insert a `new` row (no account);
  only editors read, update, or delete. Contact details live only here.
- `involvement_submission_counts(tenant, ip_hash, email, since)` —
  `SECURITY DEFINER`, returns the two counts the rate limits need and
  nothing else.
- `public_staff_ids(tenant, user_ids)` — `SECURITY DEFINER`, returns the
  subset of `user_ids` who are on the portrait's team.

## 6. Open questions for the owner

- Should staff be emailed when a submission arrives, or is the queue enough?
- Should a listing show the organization's own contact details (with their
  consent), or only its website?
- Do borough portraits show the citywide listings automatically, or does
  staff curate each portrait (current behavior: each portrait is curated;
  the NYC script proposes citywide listings to all six)?
