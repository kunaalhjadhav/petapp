# Phase 7c — PetApp Assistant: report

This completes Phase 7 (AI): 7a AI moderation and account risk, 7b recommendations and the home screen, **7c the PetApp Assistant (this report)**.

## 1. Implemented

### What the assistant does (spec §34)
A chat in the customer app (the ✨ button on Home, when the **ENABLE_AI_ASSISTANT** switch is on). It helps with everything the spec lists, and every result comes as a card that opens the right screen:

| Spec | How |
|---|---|
| Finding nearby services | Partners near the person (their chosen place or saved address), by category in everyday words ("groomer", "doctor", "hostel"), best rated first |
| Finding products | Searches the shop (the whole phrase, then its words); falls back to picks for their pets |
| Finding contests | Contests their pets can still enter, then ones open for voting |
| Understanding contest rules | Who can enter, fee, deadlines, how winners are decided (judges vs public votes, votes per day), prizes, tasks to submit, the written rules |
| Finding challenges | Running or starting soon, with their own progress |
| General pet-care information | Short general notes (vaccinations, poisonous foods, heat, feeding, ticks and fleas, grooming, teeth, exercise), always pointing to the vet |
| App navigation | 16 how-to guides (add a pet, post a reel, book, cancel, returns, refunds, invoices, prize payouts, contests, voting, challenges, notifications, privacy, report/block, delete account, follow) with steps and a button to the screen |
| Booking assistance | Their upcoming bookings, how to book, change or cancel |

**Two ways to answer (no hard-coding):**
- **Built-in** (`AI_PROVIDER=rules`, the default): understands common questions by keywords, runs the same look-ups and answers from templates. No key and no cost. It is also the automatic fallback when the AI model fails, so people still get an answer.
- **Claude** (`AI_PROVIDER=anthropic`): the Messages API with eight tools that our server runs against PetApp's own data.
  - **No made-up results:** Claude is told to mention only what the tools returned, so it can't invent services, prices, dates or rules.
  - **Tool loop:** up to four rounds, with failed tools reported back as errors.
  - **Context sent:** the last 10 messages, plus only the person's pets (name, species, life stage) and whether a location is set.
  - **Prompt-injection resistance:** the person's words are fenced so they can't override the instructions.
  - **Model:** set by `AI_ASSISTANT_MODEL` (default `claude-sonnet-5-5`).
- **Feature switches apply to the tools:** with the shop off, product search isn't offered (the same goes for services and contests).

### Veterinary guardrails (spec: distinguish general guidance from diagnosis)
Enforced by the server whatever answers, not just by instructions to the model:
- **Emergencies:**
  - **What triggers it:** signs such as poisoning (chocolate, grapes, xylitol, rat poison, human medicines, lilies…), breathing trouble, seizures, collapse, heavy bleeding, injuries, bloat, heatstroke, a blocked cat, vomiting blood or a difficult birth.
  - **The answer is fixed:** "contact a vet now", with what to do on the way (and what not to do, e.g. don't induce vomiting unless a vet says so).
  - **It shows nearby vets,** plus the poisonous-foods note for poisoning. The model isn't asked.
- **Medicine doses:** a question asking for a dose gets a fixed answer (a vet must decide; human medicines can poison pets). Any answer to a health question that still contains a dose (mg, ml, tablets…) is replaced.
- **Other health questions** are answered as general information. The app shows a clear notice on the answer: "General information, not a diagnosis. For anything about your pet's health, talk to a vet." The intro screen says "I'm not a vet" up front.
- **Clinical content:** the care notes are general, mainstream advice and each one points to the vet. Clinical content is a product decision; have a vet review the wording before launch.

### In the customer app
- **Chat screen:**
  - **Intro:** what the assistant can do, the health notice, the privacy note, suggestion chips and questions left today.
  - **Each answer shows:** the urgent (red) or general-information (amber) notice, then the cards: services, products, contests, challenges, bookings, app steps, and care notes that expand.
  - **Thumbs up or down:** a thumbs-down asks for an optional note and says it will be shared with the PetApp team.
  - **Location:** the place chosen on Home is used for nearby services.
- **Earlier chats:** open one, delete one, or delete all.

### Admin dashboard → Community → PetApp Assistant
- **Status:** on/off, built-in or AI model. For the last 24 hours: answers, emergencies, health questions, model failures, average answer time and tokens. Ratings over 30 days.
- **Limits:** questions per person per day (40) and days chats are kept (30). Both are validated and recorded in the audit log.
- **Rated answers** (thumbs down / thumbs up) with the question, the person's note, what was shown, and what answered (fixed safety answer, built-in, or AI model, including when the model failed). Conversations nobody rated stay private.

### API
- **Customer endpoints:**
  - `GET /assistant`
  - `POST /assistant/messages`: ask, with optional `conversationId`, `lat`, `lng`; limited to 15 a minute and the daily limit.
  - `POST /assistant/messages/{id}/rating`
  - `GET /assistant/conversations`, `GET /assistant/conversations/{id}`
  - `DELETE /assistant/conversations/{id}`, `DELETE /assistant/conversations`
- **Admin endpoints:** `GET /admin/assistant/status`, `GET /admin/assistant/feedback`.
- **Access:** everything except the admin endpoints answers 404 while `ENABLE_AI_ASSISTANT` is off. People can only see their own conversations.
- The API reference was regenerated (314 operations).

### Database and jobs
- **Migration `20261015090000_assistant`:**
  - `AssistantConversation`
  - `AssistantMessage`: text, cards, safety level, the tools used and their inputs, provider, model, prompt version, time, tokens, error, and rating with note.
- **New settings:** `assistant.dailyMessages` and `assistant.historyDays`.
- **Nightly job (04:40 IST):** deletes conversations past the retention period.

## 2. Verification
- **Backend unit tests:** 182 pass (19 new):
  - Emergency signs (13 phrasings), health vs everyday questions, dose questions and dose detection in answers.
  - Titles and the India-time daily limit.
  - Question topics, app guides, care notes, category words and shop search words.
  - The Claude tool loop against recorded responses: tool results sent back correctly, a failing tool reported as an error, the round limit, retryable vs permanent errors.
- **Backend end-to-end:** 157/157, including 9 new tests (against a scripted model):
  - Off by default; the intro.
  - Services near them, and a prompt to choose a place without one; products; contests; contest rules; app steps.
  - Emergencies answered without the model, with vets and the poison note.
  - Dose questions, and a dose in a model answer replaced.
  - The model with tools, conversation history, and the fallback when the model fails.
  - Other people's conversations are hidden.
  - Switched-off features aren't offered.
  - The daily limit and its validation.
  - Ratings; staff see only rated answers; the status numbers.
  - Deleting conversations, and the retention purge.
- **Dashboard browser tests:** 22/22, including a new one (status, limits with validation, and a rated-down answer listed with its question and note).
- **Customer app:**
  - Contract check: 115 API calls; 519 field reads across 78 models, against responses recorded from the running API by the new `tool/record_assistant_fixtures.py`.
  - New Dart tests in `test/assistant_test.dart`, mirrored in Python (`scripts/check_assistant_mirrors.py`).
  - Name and bracket checks pass.
- **Live check (built-in answers):** a new customer with a puppy asked nine questions. Grooming partners near them came back as cards. A chocolate question got the emergency answer. A paracetamol question got the dose refusal. "Cancel my booking" showed their booking.

## 3. Problems found and fixed
- **"Here are grooming near you"** read badly. Answers now say "grooming partners".
- **"dog food" found nothing** because the shop search matches the whole phrase. The assistant now tries the phrase, then each word.
- **When no vet is near,** an emergency answer had no way forward. Any service search with no results now adds a button to Services.
- **Words that should not trigger a health notice:** "vet" alone ("find a vet near me") was being treated as a health question. Asking for a vet is now a services question.
- **Emergency and dose phrasings** were broadened after tests. Examples: "belly is swollen and hard and he keeps retching", "How much paracetamol can I give my dog?" and "can I give my dog a crocin".

## 4. Known limitations
- **Not yet run against the real Claude API:** this environment has no key. The tool loop is tested against recorded responses. Try it in staging with a key before switching it on for everyone.
- **Moderation model:** AI moderation (7a) forces its tool. Anthropic's docs say some newer models (e.g. Sonnet 5.5, Opus 5.5) reject a forced tool, so keep `AI_MODERATION_MODEL` on Haiku (the default). The assistant itself doesn't force tools.
- **Built-in answers understand common phrasings only.** Unusual questions get the "here's what I can do" reply. The model is much better at this.
- **English only** for the built-in answers and the safety checks. Hindi and other languages need translated patterns (the model understands them, but the server's emergency and dose checks are English-only today).
- **No booking from the chat:** the assistant finds partners and explains the steps, and booking happens on the partner's screen with payment as usual. This is deliberate, so it can't book or pay by mistake.
- **No live typing:** answers arrive whole, without streaming.
- **The care notes** are general and should be reviewed by a vet before launch.

## 5. Next: Phase 8, production
Load and security testing, monitoring and alerts, backups and recovery drills, data export and deletion jobs, the support centre, legal pages and consent, and app-store submission.
