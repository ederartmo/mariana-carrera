# Support quality follow-up

- The public transcript follows new messages only if the visitor was within 48
  CSS pixels of the bottom before render. Readers higher up keep their visible
  message anchor; the viewport itself is never scrolled by this helper.
- The existing admin inbox requests attention order: pending first, then
  descending last activity and UUID within each group. Existing status,
  category and assignee filters still apply. The cursor records the group
  because a page may cross groups. The server reuses the operator guard and the
  existing service-role read grant; the legacy list contract is unchanged.
  Reopened requests re-enter the pending group through the existing lifecycle.
  Like other live keyset lists, a row that changes between pages may move to
  another page; refresh the first page to see newly reopened requests.
- Follow-up email collection is deferred. There is no dedicated private field
  or consent workflow. Do not store emails as visitor transcript messages.
  A later change needs a ticket-bound write with capability/account checks,
  explicit purpose/consent, a private operator projection and retention rules.
  The existing notification worker sends to a fixed internal recipient and
  must not be repurposed to send participant replies without a distinct
  authorized, idempotent delivery flow.
- The existing notification email already includes a short ticket folio, event
  date, pending status and an admin inbox link. Category and visitor excerpt
  are deferred: jobs do not capture an immutable category or privacy-reviewed
  excerpt. Adding mutable live text would risk exposing private information and
  changing the body under the same Resend idempotency key. Do not copy raw chat
  content; snapshot bounded safe metadata before a first attempt in a separate
  reviewed change.
