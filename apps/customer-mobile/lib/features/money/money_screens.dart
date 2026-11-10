import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../api/models.dart';
import '../../common/money_text.dart';
import '../../common/widgets.dart';
import '../../config.dart';
import '../../state/providers.dart';
import '../../theme.dart';
import '../contests/contest_screens.dart' show rupees;

final prizeMoneyProvider = FutureProvider.autoDispose<PayoutSummary>((ref) => ref.watch(apiProvider).payouts());
final prizeStatementProvider = FutureProvider.autoDispose<Statement>((ref) => ref.watch(apiProvider).prizeStatement());
final payoutAccountProvider = FutureProvider.autoDispose<PayoutAccounts>((ref) => ref.watch(apiProvider).payoutAccount());

/// A list that loads page by page as it scrolls. [load] returns a page and whether more follow.
class _Paged<T> extends ConsumerStatefulWidget {
  const _Paged({super.key, required this.load, required this.item, required this.empty, this.header});
  final Future<(List<T>, bool)> Function(WidgetRef ref, int page) load;
  final Widget Function(BuildContext context, T item) item;
  final Widget empty;
  final List<Widget>? header;
  @override
  ConsumerState<_Paged<T>> createState() => _PagedState<T>();
}

class _PagedState<T> extends ConsumerState<_Paged<T>> {
  final _items = <T>[];
  int _page = 0;
  bool _more = true;
  bool _loading = false;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({bool reset = false}) async {
    if (_loading || (!_more && !reset)) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final (items, more) = await widget.load(ref, reset ? 1 : _page + 1);
      if (!mounted) return;
      setState(() {
        if (reset) {
          _items.clear();
          _page = 0;
        }
        _items.addAll(items);
        _page++;
        _more = more;
      });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final header = widget.header ?? const <Widget>[];
    return RefreshIndicator(
      onRefresh: () => _load(reset: true),
      child: NotificationListener<ScrollNotification>(
        onNotification: (n) {
          if (n.metrics.pixels > n.metrics.maxScrollExtent - 300) _load();
          return false;
        },
        child: ListView(children: [
          ...header,
          if (_items.isEmpty && _loading) const LoadingView(),
          if (_items.isEmpty && !_loading && _error != null) ErrorView(error: _error!, onRetry: _load),
          if (_items.isEmpty && !_loading && _error == null) widget.empty,
          for (final i in _items) widget.item(context, i),
          if (_items.isNotEmpty && _more) const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator())),
        ]),
      ),
    );
  }
}

// ══════════════ payments and refunds ══════════════

/// The customer's money: refunds and where each one is, invoices, and prize money.
class MoneyScreen extends StatelessWidget {
  const MoneyScreen({super.key});
  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Payments and refunds')),
        body: _Paged<RefundItem>(
          load: (ref, page) => ref.read(apiProvider).refunds(page: page),
          header: [
            ListTile(
              leading: const Icon(Icons.receipt_long_outlined),
              title: const Text('Invoices'),
              subtitle: const Text('For orders and bookings, as PDFs'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.push('/money/invoices'),
            ),
            ListTile(
              leading: const Icon(Icons.emoji_events_outlined),
              title: const Text('Prize money'),
              subtitle: const Text('Cash prizes you’ve won, and where they’re paid'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.push('/money/prizes'),
            ),
            const Divider(),
            const Padding(padding: EdgeInsets.fromLTRB(16, 8, 16, 0), child: Text('Refunds', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16))),
          ],
          empty: const Padding(
            padding: EdgeInsets.all(24),
            child: Text('No refunds. If an order or booking is cancelled, its refund and where it is will show here.', style: TextStyle(color: Brand.muted)),
          ),
          item: (context, r) => _RefundTile(refund: r),
        ),
      );
}

class _RefundTile extends StatelessWidget {
  const _RefundTile({required this.refund});
  final RefundItem refund;
  @override
  Widget build(BuildContext context) {
    final r = refund;
    final done = r.status == 'PROCESSED' || r.status == 'SETTLED_MANUALLY';
    final when = r.processedAt ?? r.createdAt;
    final to = r.route;
    return ListTile(
      isThreeLine: true,
      leading: Icon(done ? Icons.check_circle_outline : (r.status == 'FAILED' ? Icons.support_agent : Icons.schedule), color: done ? Brand.teal : Brand.muted),
      title: Text('${rupees(r.amountPaise)} · ${refundStatusText(r.status)}'),
      subtitle: Text([
        '${refundReasonText(r.reason)}: ${r.aboutTitle}${when != null ? ' · ${shortDate(when)}' : ''}',
        refundHelpText(r.status),
        if (r.reference != null) 'Reference ${r.reference}',
      ].where((s) => s.isNotEmpty).join('\n')),
      onTap: to == null ? null : () => context.push(to),
    );
  }
}

// ══════════════ invoices ══════════════

/// Opens an invoice PDF in the phone's browser through a short-lived link.
Future<void> openInvoice(BuildContext context, WidgetRef ref, Invoice invoice) async {
  try {
    final link = await ref.read(apiProvider).invoiceLink(invoice.id);
    final ok = await launchUrl(Uri.parse('${AppConfig.apiBaseUrl}/api/v1${link.path}'), mode: LaunchMode.externalApplication);
    if (!ok && context.mounted) showMessage(context, 'Couldn’t open the PDF. Check that a browser is installed.');
  } catch (e) {
    if (context.mounted) showError(context, e);
  }
}

class InvoicesScreen extends ConsumerWidget {
  const InvoicesScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) => Scaffold(
        appBar: AppBar(title: const Text('Invoices')),
        body: _Paged<Invoice>(
          load: (ref, page) => ref.read(apiProvider).invoices(page: page),
          empty: const Padding(
            padding: EdgeInsets.all(24),
            child: Text('Invoices appear when a parcel is delivered or a visit is completed. Returns get a credit note.', style: TextStyle(color: Brand.muted)),
          ),
          item: (context, inv) => ListTile(
            leading: const Icon(Icons.picture_as_pdf_outlined),
            title: Text('${invoiceKindText(inv.kind, inv.title)} ${inv.number}'),
            subtitle: Text('${inv.issuerName}${inv.issuedAt != null ? ' · ${shortDate(inv.issuedAt!)}' : ''}'),
            trailing: Text(inv.kind == 'CREDIT_NOTE' ? '−${rupees(inv.totalPaise)}' : rupees(inv.totalPaise)),
            onTap: () => openInvoice(context, ref, inv),
          ),
        ),
      );
}

// ══════════════ prize money ══════════════

/// Cash prizes the customer has won: what's owed after TDS, the account it goes to, and payouts.
class PrizeMoneyScreen extends ConsumerWidget {
  const PrizeMoneyScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final summary = ref.watch(prizeMoneyProvider);
    final statement = ref.watch(prizeStatementProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Prize money')),
      body: summary.when(
        loading: () => const LoadingView(),
        error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(prizeMoneyProvider)),
        data: (s) => RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(prizeMoneyProvider);
            ref.invalidate(prizeStatementProvider);
          },
          child: ListView(padding: const EdgeInsets.all(16), children: [
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(color: const Color(0xFFDCEBE8), borderRadius: BorderRadius.circular(16)),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Text('Prize money owed to you', style: TextStyle(color: Brand.muted)),
                const SizedBox(height: 4),
                Text(rupees(s.balancePaise), style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w700, color: Brand.teal)),
                const SizedBox(height: 6),
                const Text('Prizes are paid once PetApp’s team approves them, in the next payout. Income tax (TDS) is deducted from larger prizes as the law requires.',
                    style: TextStyle(color: Brand.muted, fontSize: 12)),
              ]),
            ),
            const SizedBox(height: 8),
            if (s.accountLabel == null)
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: const Color(0xFFFFF1E6), borderRadius: BorderRadius.circular(12)),
                child: Row(children: [
                  const Icon(Icons.account_balance_outlined, color: Brand.heart),
                  const SizedBox(width: 12),
                  Expanded(child: Text(s.balancePaise > 0 ? 'Add your bank account or UPI ID to receive your prize.' : 'Add a bank account or UPI ID for any prizes you win.')),
                  TextButton(onPressed: () => context.push('/money/account'), child: const Text('Add')),
                ]),
              )
            else
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.account_balance_outlined),
                title: Text('Paid to ${s.accountLabel}'),
                subtitle: s.accountPayableFrom != null && s.accountPayableFrom!.isAfter(DateTime.now())
                    ? Text('New account: payouts start ${dateTime(s.accountPayableFrom!)} (safety hold)')
                    : null,
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.push('/money/account'),
              ),
            if (s.payouts.isNotEmpty) ...[
              const SizedBox(height: 8),
              const Text('Payouts', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
              for (final p in s.payouts)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(p.status == 'PROCESSED' ? Icons.check_circle_outline : Icons.schedule, color: p.status == 'PROCESSED' ? Brand.teal : Brand.muted),
                  title: Text(payoutStatusText(p.status)),
                  subtitle: Text([
                    if ((p.processedAt ?? p.createdAt) != null) shortDate((p.processedAt ?? p.createdAt)!),
                    p.accountLabel,
                    if (p.utr != null) 'Bank ref ${p.utr}',
                    if (p.failureReason != null) p.failureReason!,
                  ].join(' · ')),
                  trailing: Text(rupees(p.amountPaise), style: const TextStyle(fontWeight: FontWeight.w600)),
                ),
            ],
            const SizedBox(height: 8),
            const Text('Prizes', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
            statement.when(
              loading: () => const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator())),
              error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(prizeStatementProvider)),
              data: (st) {
                final prizes = st.items.where((l) => l.kind == 'PRIZE_APPROVED').toList();
                if (prizes.isEmpty) {
                  return const Padding(
                    padding: EdgeInsets.symmetric(vertical: 12),
                    child: Text('No cash prizes yet. Enter a contest from the Contests screen.', style: TextStyle(color: Brand.muted)),
                  );
                }
                return Column(children: [
                  for (final l in prizes)
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: const Icon(Icons.emoji_events_outlined, color: Brand.teal),
                      title: Text(l.memo),
                      subtitle: Text([
                        if (l.occurredAt != null) shortDate(l.occurredAt!),
                        if (l.salePaise != null) 'prize ${rupees(l.salePaise!)}',
                        if (l.tdsPaise != 0) 'TDS ${rupees(l.tdsPaise)}',
                      ].join(' · ')),
                      trailing: Text(rupees(l.amountPaise), style: const TextStyle(fontWeight: FontWeight.w600)),
                    ),
                  if (st.tdsPaise > 0)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text('${rupees(st.tdsPaise)} TDS was deposited with the income tax department in your name. You can claim it when you file your return.',
                          style: const TextStyle(color: Brand.muted, fontSize: 12)),
                    ),
                ]);
              },
            ),
          ]),
        ),
      ),
    );
  }
}

// ══════════════ payout account ══════════════

class PayoutAccountScreen extends ConsumerWidget {
  const PayoutAccountScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(payoutAccountProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Prize payout account')),
      body: async.when(
        loading: () => const LoadingView(),
        error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(payoutAccountProvider)),
        data: (a) => ListView(padding: const EdgeInsets.all(16), children: [
          if (a.active != null) _AccountCard(account: a.active!, title: 'Prizes are paid to'),
          if (a.pending != null) ...[const SizedBox(height: 12), _AccountCard(account: a.pending!, title: a.pending!.status == 'FAILED' ? 'Not added' : 'Being checked')],
          if (a.active == null && a.pending == null)
            const Padding(
              padding: EdgeInsets.only(bottom: 8),
              child: Text('Add the bank account or UPI ID in your own name that prize money should be paid to. We check it with your bank straight away.'),
            ),
          const SizedBox(height: 16),
          _AccountForm(replacing: a.active != null),
        ]),
      ),
    );
  }
}

class _AccountCard extends StatelessWidget {
  const _AccountCard({required this.account, required this.title});
  final PayoutAccount account;
  final String title;
  @override
  Widget build(BuildContext context) {
    final a = account;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: Colors.white, border: Border.all(color: Brand.line), borderRadius: BorderRadius.circular(16)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(title, style: const TextStyle(color: Brand.muted)),
        const SizedBox(height: 4),
        Text(a.label, style: Theme.of(context).textTheme.titleLarge),
        if (a.ifsc != null) Text('IFSC ${a.ifsc}', style: const TextStyle(color: Brand.muted)),
        const SizedBox(height: 8),
        Row(children: [
          Icon(a.status == 'VERIFIED' ? Icons.verified_outlined : (a.status == 'FAILED' ? Icons.error_outline : Icons.hourglass_top), size: 18, color: a.status == 'FAILED' ? Brand.heart : Brand.teal),
          const SizedBox(width: 6),
          Expanded(child: Text(accountStatusText(a.status))),
        ]),
        if (a.verifiedName != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text('Name at the bank: ${a.verifiedName}')),
        if (a.nameMatches == false)
          const Padding(
            padding: EdgeInsets.only(top: 4),
            child: Text('This isn’t the name on your PetApp profile, so the first payout waits for a check.', style: TextStyle(color: Brand.heart)),
          ),
        if (a.status == 'VERIFIED' && a.onHoldAt(DateTime.now()))
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text('For your safety, payouts to a new account start ${dateTime(a.payableFrom!)}.', style: const TextStyle(color: Brand.muted)),
          ),
        if (a.failureReason != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text(a.failureReason!, style: const TextStyle(color: Brand.heart))),
      ]),
    );
  }
}

class _AccountForm extends ConsumerStatefulWidget {
  const _AccountForm({required this.replacing});
  final bool replacing;
  @override
  ConsumerState<_AccountForm> createState() => _AccountFormState();
}

class _AccountFormState extends ConsumerState<_AccountForm> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _ifsc = TextEditingController();
  final _number = TextEditingController();
  final _again = TextEditingController();
  final _vpa = TextEditingController();
  String _method = 'UPI';
  bool _busy = false;

  @override
  void dispose() {
    for (final c in [_name, _ifsc, _number, _again, _vpa]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    if (!(_form.currentState?.validate() ?? false)) return;
    setState(() => _busy = true);
    try {
      final r = await ref.read(apiProvider).addPayoutAccount({
        'method': _method,
        'holderName': _name.text.trim(),
        if (_method == 'BANK') 'ifsc': cleanIfsc(_ifsc.text),
        if (_method == 'BANK') 'accountNumber': cleanAccountNumber(_number.text),
        if (_method == 'UPI') 'vpa': _vpa.text.trim(),
      });
      ref.invalidate(payoutAccountProvider);
      ref.invalidate(prizeMoneyProvider);
      if (!mounted) return;
      final refused = r.pending?.status == 'FAILED';
      showMessage(context, refused ? 'Your bank refused this account. Check the details and try again.' : (r.pending != null ? 'Added. We’re checking it with your bank.' : 'Account verified with your bank.'));
      if (!refused) {
        for (final c in [_number, _again, _vpa]) {
          c.clear();
        }
      }
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Form(
      key: _form,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(widget.replacing ? 'Change account' : 'Add account', style: Theme.of(context).textTheme.titleMedium),
        if (widget.replacing)
          const Padding(
            padding: EdgeInsets.only(top: 4),
            child: Text('Your current account keeps working until the new one is verified. Payouts to a new account start after a 24-hour safety hold.',
                style: TextStyle(color: Brand.muted, fontSize: 12)),
          ),
        const SizedBox(height: 12),
        SegmentedButton<String>(
          segments: const [
            ButtonSegment(value: 'UPI', label: Text('UPI ID'), icon: Icon(Icons.qr_code_2)),
            ButtonSegment(value: 'BANK', label: Text('Bank account'), icon: Icon(Icons.account_balance_outlined)),
          ],
          selected: {_method},
          onSelectionChanged: (s) => setState(() => _method = s.first),
        ),
        const SizedBox(height: 12),
        TextFormField(
          controller: _name,
          textCapitalization: TextCapitalization.words,
          decoration: const InputDecoration(labelText: 'Account holder’s name', helperText: 'Exactly as your bank has it'),
          validator: (v) => holderNameError(v ?? ''),
        ),
        const SizedBox(height: 12),
        if (_method == 'BANK') ...[
          TextFormField(
            controller: _ifsc,
            textCapitalization: TextCapitalization.characters,
            decoration: const InputDecoration(labelText: 'IFSC', hintText: 'HDFC0001234'),
            validator: (v) => ifscError(v ?? ''),
          ),
          const SizedBox(height: 12),
          TextFormField(
            controller: _number,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(labelText: 'Account number'),
            validator: (v) => accountNumberError(v ?? ''),
          ),
          const SizedBox(height: 12),
          TextFormField(
            controller: _again,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(labelText: 'Account number again'),
            validator: (v) => confirmAccountError(_number.text, v ?? ''),
          ),
        ] else
          TextFormField(
            controller: _vpa,
            keyboardType: TextInputType.emailAddress,
            autocorrect: false,
            decoration: const InputDecoration(labelText: 'UPI ID', hintText: 'name@oksbi'),
            validator: (v) => vpaError(v ?? ''),
          ),
        const SizedBox(height: 16),
        FilledButton(
          onPressed: _busy ? null : _save,
          child: _busy ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2)) : Text(widget.replacing ? 'Check and switch' : 'Check and add'),
        ),
        const SizedBox(height: 8),
        const Text('Your full account number is stored encrypted and never shown again; only its last 4 digits are.', style: TextStyle(color: Brand.muted, fontSize: 12)),
      ]),
    );
  }
}
