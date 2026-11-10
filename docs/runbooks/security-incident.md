# Security incident

For a confirmed or suspected breach: leaked data, an attacker in an account or system, leaked secrets, or a vulnerability being exploited.

## Right away
1. **Name an incident lead,** and keep a timeline from the first sign (times in IST).
2. **Contain it, keeping evidence:**
   - **Leaked secrets:** rotate them ([rotate-secrets.md](rotate-secrets.md)).
   - **Compromised staff accounts:** suspend them in the dashboard. Their sessions end at once.
   - **Compromised people's accounts:** sign them out everywhere (suspending and restoring does this), and block the attacker's network at the load balancer.
   - **Evidence:** don't delete anything. Snapshot the affected servers and the database, and export the relevant audit-log and access-log period.
3. **Is personal data involved?** Check the audit log (staff actions), the access logs (request ids, routes) and the database.

## Legal deadlines (India)
Confirm the current rules with your lawyer.
- **CERT-In:** report cyber incidents within **6 hours** of noticing them (CERT-In directions of 28 April 2022), at incident@cert-in.org.in.
- **Data Protection Board and affected people:** a personal data breach must be reported to the Board and to each affected person under the DPDP Act, 2023 and its rules. The rules set a detailed report within **72 hours**; notify people without delay, in plain language, saying what happened and what they should do.
- **Payment data:** if card or bank details may be involved, tell the payment gateway (Razorpay) at once. PetApp never stores card numbers.
- **Who reports:** the Grievance Officer named in the Privacy Policy coordinates. Keep copies of everything sent.

## Afterwards
- Fix the cause, then check that the fix holds (add a test to `test/security.e2e-spec.ts` where possible).
- Write the incident report: timeline, data and people affected, what was done, what changes.
- Review who had access, and remove what isn't needed.
