# PaymentFailuresSpike: most payments in the last hour failed (page)

1. **Check Razorpay's status page and dashboard.** Is it one payment method (UPI, a bank) or everything?
2. **Our side:** look at `failureReason` on recent payments (Finance → payments). Wrong keys after a rotation fail every payment immediately.
3. **Gateway outage:** consider switching off paid features briefly (contests with fees, the marketplace) with a notice, rather than letting people fail repeatedly.
4. **Afterwards:** failed payments need nothing from staff. Places and stock are released automatically.
