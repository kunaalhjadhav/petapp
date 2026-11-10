# Sign-in problems: OTP codes not arriving

1. **Is it everyone?** Check the SMS provider's dashboard (SMSLocal): balance, sender ID, DLT template approval. Codes need an approved DLT template in India. Look for `sms` errors in the logs.
2. **One person:**
   - **Too many codes:** they may have asked too often. Codes are limited per number per hour, and a wait between codes is enforced. The app shows the wait.
   - **Their account is suspended or blocked:** they are told so. Check their status in **People**.
   - **Deleted, and the grace period passed:** the account was erased. Signing in creates a new account.
3. **Email sign-in** (staff and some users): passwords are stored only as hashes, so support can't recover them, and there's no reset-by-email flow yet. Customers can sign in with their mobile number instead.
4. **Don't** read codes out of the database for a customer. Codes are stored only as hashes, by design.
