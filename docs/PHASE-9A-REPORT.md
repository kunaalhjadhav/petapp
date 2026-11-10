# Phase 9a — Chat and support center: report

Phase 9 builds the parts of the spec that were still missing after Phase 8. Phase 9a covers:
- chat between customers and businesses (spec §37)
- the support center (spec §58)
- the NestJS 11 upgrade that clears the last advisories in shipped code

## 1. Implemented

### Upgrade
- **NestJS 10 → 11.2.7** (Express 5). Express 4's query-string parsing is kept on purpose, so query handling doesn't change.
- **Other upgrades:** google-auth-library 10, and js-yaml pinned to a fixed version for the API docs.
- **Advisories:** `npm audit --omit=dev` now reports **0 vulnerabilities**. Before, there were 7 moderate ones.
- All 197 existing end-to-end tests passed on the new version before any chat code was written.

### Chat (spec §37)
- **Who talks to whom:**
  - **Customer ↔ service partner:** started from the partner's page or a booking.
  - **Customer ↔ seller:** started from a product or an order ("where appropriate": sellers can't cold-message people).
  - **Admin ↔ user:** a support ticket started by staff (see below).
- **What can be sent:**
  - text
  - photos, which are private: processed copies sit under `private/` and are only served as signed links that expire after 15 minutes
  - booking, product and order cards, which must belong to both sides
- **Report and block:** both from the conversation. Reported messages go to **Moderation** with the messages around them. Staff can't read private chats otherwise.
- **Realtime:**
  - **Connection:** a WebSocket on the API's own server (`/api/v1/chat/ws`), opened with a one-time ticket. Events fan out across API instances through Redis pub/sub, so no sticky sessions are needed.
  - **What it carries:** new messages, read receipts, typing and status changes.
  - **Sending:** always over HTTP: validated, rate-limited and idempotent.
  - **Push:** goes to people who aren't in the app, one per burst. Each person can turn it off.
- **Abuse controls:**
  - messages per minute
  - new conversations per customer per day
  - AI moderation of chat text and photos for scams and abuse
  - account status checked when connecting and on every heartbeat
- **Switching it on:** `ENABLE_CHAT`, off by default. Support works whatever the flag says.

### Support center (spec §58)
- **FAQs:**
  - grouped by topic, per app (customer, partner, seller)
  - searchable, with "Did this help?"
  - also on the website at `/help`, with FAQ structured data, which works as the App Store's support URL
  - eight drafts seeded unpublished, like the legal documents
- **Tickets:**
  - **Fields:** topic, subject, message, up to 5 photo attachments, and optionally the booking or order it's about.
  - **Statuses:** Open, Assigned, In progress, Waiting, Resolved and Closed.
  - **Priority:** Low, Normal, High or Urgent.
  - **Assignment:** to support staff.
  - **Replies:** staff answers come with a notification. Staff can also add notes the person never sees.
  - **Status rules:**
    - A staff reply moves a new ticket to In progress.
    - The person's reply reopens a waiting or resolved ticket.
    - Resolved tickets close after `support.autoCloseDays` (7) with no reply, through a nightly job.
- **Admin ↔ user:** **Message** on a person's page starts a ticket that they answer in the app.
- **Dashboard:**
  - **Support → Tickets:** a queue with tabs (Active, Mine, Unassigned, Waiting, Resolved, Closed), counts, search and filters, and a ticket page that refreshes itself.
  - **Help center:** FAQ editing with a preview and publish switches.
  - **Topics.**
- **Permissions:** `support.read` and `support.manage`, given to the Support agent role.

### Apps
- **Customer app:**
  - **Messages** (Me tab) with an unread badge, and the conversation screen: day dividers, Seen/Sent receipts, typing, photos, cards, and retry for failed sends.
  - **Help & support** (Settings), and **Message** / **Get help** buttons on partner, product, booking and order pages.
  - Push taps open the conversation or ticket. There's a new **Messages** switch in notification settings.
- **Partner and seller apps:** the same chat and help screens, in one file shared by both. Each booking or parcel has **Message** and **Get help**.
  - **New: push notifications,** which these apps didn't have. They are Firebase, switched on by dart-defines as in the customer app.
- **Shared code:** `chat_logic.dart` is the same file in all three apps. CI checks the copies match.

### Privacy
- **Data export:** includes conversations, messages sent as a business, and support tickets.
- **Erasure:** removes a person's conversations and tickets, and blanks what they wrote elsewhere.

## 2. Verification

| Check | Result |
|---|---|
| API unit tests | 204 pass (5 new: chat rules) |
| API end-to-end tests | 215 pass, 17 suites (18 new in `chat.e2e`: access and 404s, idempotent sends, unread and read, cards, private photos, a real WebSocket with typing and single-use tickets, push only to people who are away, rate limits, blocking, reporting and moderation, the FAQ, tickets, notes, statuses, auto-close, staff-started tickets, support with chat off, erasure) |
| Dashboard browser tests | 28 pass (3 new: message a person, notes, waiting; FAQ draft, publish, shown in the API; topics) |
| Website browser tests | 12 pass (new: `/help`); unit tests 12 pass (new: FAQ structured data) |
| App ↔ API contract checks, all three apps | Pass (new fixtures recorded from the running API by `record_chat_fixtures.py`) |
| Python mirrors of the Dart tests (7 sets; new `check_chat_mirrors.py`) | Pass. Among other things, they check that the app's "after" cursor matches the server's exactly |
| Bracket and name checks, platform configuration tests | Pass |
| `npm audit --omit=dev` | 0 vulnerabilities |

## 3. Problems found and fixed
- **Staff notes:** notes failed the status check, because a note shouldn't change the status at all. Notes now skip it.
- **Push burst window:** the 30-second burst window started even when the person had no phone registered, so their first real push was swallowed. It now starts only when a push is actually sent.
- **Shadowed name:** a parameter named `ref` hid Riverpod's `ref` in the conversation screen. It was renamed.
- **Install problem:** packages hoisted from the Nest 10 era left the throttler resolving Nest 10. The lockfile entries were rebuilt.

## 4. Known limitations
- **The Flutter apps weren't compiled here** (no SDK). CI's mobile jobs run `flutter analyze` and `flutter test` on the new screens. The logic is covered by the Python mirrors and contract checks.
- **The dashboard doesn't use the WebSocket.** It refreshes an open ticket every 20 seconds, and the queue on reload.
- **Apps can't send PDFs in chat:** they send photos only. The API accepts PDFs on tickets.
- **Typing indicators** show for customers and businesses, not for support staff.

## 5. Next: Phase 9b
- product reviews with verified purchase, photos on reviews, seller and partner replies, and review moderation
- reporting for every kind of content, with the full reporting dashboard of spec §59
