import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/models.dart';
import '../common/money_text.dart';
import '../common/widgets.dart';
import '../config.dart';
import '../state/providers.dart';
import '../theme.dart';

void _open(BuildContext context, Widget page) => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => page));

/// Top of the Earnings tab: what can be paid now, what's still waiting, where it goes, and recent payouts.
class PayoutCard extends ConsumerWidget {
  const PayoutCard({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(payoutSummaryProvider);
    return async.when(
      loading: () => const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator())),
      error: (_, __) => ListTile(
        leading: const Icon(Icons.error_outline),
        title: const Text('Couldn’t load your payouts'),
        trailing: TextButton(onPressed: () => ref.invalidate(payoutSummaryProvider), child: const Text('Retry')),
      ),
      data: (s) {
        final now = DateTime.now();
        final held = s.accountPayableFrom != null && s.accountPayableFrom!.isAfter(now);
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Card(
            elevation: 0,
            color: const Color(0xFFDCEBE8),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Text('Ready to be paid', style: TextStyle(color: Brand.muted)),
                const SizedBox(height: 4),
                Text(rupees(s.availablePaise), style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w700, color: Brand.teal)),
                if (s.waitingPaise > 0) ...[
                  const SizedBox(height: 6),
                  Text(
                    s.holdDays > 0
                        ? '${rupees(s.waitingPaise)} more becomes payable ${s.holdDays} day${s.holdDays == 1 ? '' : 's'} after each visit.'
                        : '${rupees(s.waitingPaise)} more is waiting to become payable.',
                  ),
                ],
                const SizedBox(height: 6),
                const Text('PetApp pays everyone due in regular payout batches.', style: TextStyle(color: Brand.muted, fontSize: 12)),
              ]),
            ),
          ),
          const SizedBox(height: 8),
          if (s.accountLabel == null)
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: const Color(0xFFFFF1E6), borderRadius: BorderRadius.circular(12)),
              child: Row(children: [
                const Icon(Icons.account_balance_outlined, color: Brand.heart),
                const SizedBox(width: 12),
                const Expanded(child: Text('Add your bank account or UPI ID so we can pay you.')),
                TextButton(onPressed: () => _open(context, const PayoutAccountScreen()), child: const Text('Add')),
              ]),
            )
          else
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.account_balance_outlined),
              title: Text('Paid to ${s.accountLabel}'),
              subtitle: held ? Text('New account: payouts start ${when(s.accountPayableFrom!)} (safety hold)') : null,
              trailing: const Icon(Icons.chevron_right),
              onTap: () => _open(context, const PayoutAccountScreen()),
            ),
          if (s.payouts.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text('Recent payouts', style: Theme.of(context).textTheme.titleMedium),
            for (final p in s.payouts.take(3)) PayoutTile(payout: p),
            if (s.payouts.length > 3)
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton(onPressed: () => _open(context, PayoutsScreen(payouts: s.payouts)), child: const Text('All payouts')),
              ),
          ],
        ]);
      },
    );
  }
}

class PayoutTile extends StatelessWidget {
  const PayoutTile({super.key, required this.payout});
  final Payout payout;
  @override
  Widget build(BuildContext context) {
    final p = payout;
    final bad = p.status == 'FAILED' || p.status == 'REVERSED';
    final at = p.processedAt ?? p.createdAt;
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: Icon(
        p.status == 'PROCESSED' ? Icons.check_circle_outline : (bad ? Icons.undo : Icons.schedule),
        color: p.status == 'PROCESSED' ? Brand.teal : (bad ? Brand.heart : Brand.muted),
      ),
      title: Text(payoutStatusText(p.status)),
      subtitle: Text([
        if (at != null) day(at),
        p.accountLabel,
        if (p.utr != null) 'Bank ref ${p.utr}',
        if (p.failureReason != null) p.failureReason!,
      ].join(' · ')),
      trailing: Text(rupees(p.amountPaise), style: const TextStyle(fontWeight: FontWeight.w600)),
    );
  }
}

class PayoutsScreen extends StatelessWidget {
  const PayoutsScreen({super.key, required this.payouts});
  final List<Payout> payouts;
  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Payouts')),
        body: ListView(padding: const EdgeInsets.symmetric(horizontal: 16), children: [
          for (final p in payouts) PayoutTile(payout: p),
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 16),
            child: Text('The bank reference (UTR) helps your bank find a payment. Money from a payout that isn’t paid goes back on your balance for the next one.',
                style: TextStyle(color: Brand.muted, fontSize: 12)),
          ),
        ]),
      );
}

// ══════════════ payout account ══════════════

class PayoutAccountScreen extends ConsumerWidget {
  const PayoutAccountScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(payoutAccountProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Payout account')),
      body: async.when(
        loading: () => const LoadingView(),
        error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(payoutAccountProvider)),
        data: (a) => ListView(padding: const EdgeInsets.all(16), children: [
          if (a.active != null) _AccountCard(account: a.active!, title: 'Payouts go to'),
          if (a.pending != null) ...[const SizedBox(height: 12), _AccountCard(account: a.pending!, title: a.pending!.status == 'FAILED' ? 'Not added' : 'Being checked')],
          if (a.active == null && a.pending == null)
            const Padding(
              padding: EdgeInsets.only(bottom: 8),
              child: Text('Add the bank account or UPI ID you want your earnings paid to. We check it with your bank straight away.'),
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
    final now = DateTime.now();
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
            child: Text('This isn’t your business’s or your own name, so the first payout waits for a check.', style: TextStyle(color: Brand.heart)),
          ),
        if (a.status == 'VERIFIED' && a.onHoldAt(now))
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text('For your safety, payouts to a new account start ${when(a.payableFrom!)}.', style: const TextStyle(color: Brand.muted)),
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
  String _method = 'BANK';
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
      ref.invalidate(payoutSummaryProvider);
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
        Text(widget.replacing ? 'Change payout account' : 'Add payout account', style: Theme.of(context).textTheme.titleMedium),
        if (widget.replacing)
          const Padding(
            padding: EdgeInsets.only(top: 4),
            child: Text('Your current account keeps working until the new one is verified. Payouts to a new account start after a 24-hour safety hold.',
                style: TextStyle(color: Brand.muted, fontSize: 12)),
          ),
        const SizedBox(height: 12),
        SegmentedButton<String>(
          segments: const [
            ButtonSegment(value: 'BANK', label: Text('Bank account'), icon: Icon(Icons.account_balance_outlined)),
            ButtonSegment(value: 'UPI', label: Text('UPI ID'), icon: Icon(Icons.qr_code_2)),
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
            decoration: const InputDecoration(labelText: 'UPI ID', hintText: 'name@okhdfcbank'),
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

// ══════════════ statement ══════════════

/// Every line on the partner's account: visits with PetApp's fee and taxes, and payouts.
class StatementScreen extends ConsumerStatefulWidget {
  const StatementScreen({super.key});
  @override
  ConsumerState<StatementScreen> createState() => _StatementScreenState();
}

class _StatementScreenState extends ConsumerState<StatementScreen> {
  Statement? _first;
  final _items = <StatementLine>[];
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
      final s = await ref.read(apiProvider).statement(page: reset ? 1 : _page + 1);
      if (!mounted) return;
      setState(() {
        if (reset) {
          _items.clear();
          _page = 0;
        }
        if (_page == 0) _first = s;
        _items.addAll(s.items);
        _page++;
        _more = s.more;
      });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = _first;
    return Scaffold(
      appBar: AppBar(title: const Text('Statement')),
      body: s == null
          ? (_error != null ? ErrorView(error: _error!, onRetry: _load) : const LoadingView())
          : RefreshIndicator(
              onRefresh: () => _load(reset: true),
              child: NotificationListener<ScrollNotification>(
                onNotification: (n) {
                  if (n.metrics.pixels > n.metrics.maxScrollExtent - 300) _load();
                  return false;
                },
                child: ListView(padding: const EdgeInsets.all(16), children: [
                  _Totals(statement: s),
                  const SizedBox(height: 12),
                  if (_items.isEmpty) const EmptyView(title: 'Nothing yet', message: 'Each completed visit and payout shows up here.'),
                  for (final l in _items) _StatementTile(line: l),
                  if (_more) const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator())),
                ]),
              ),
            ),
    );
  }
}

class _Totals extends StatelessWidget {
  const _Totals({required this.statement});
  final Statement statement;
  @override
  Widget build(BuildContext context) {
    final s = statement;
    Widget row(String k, int v, {bool strong = false}) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 2),
          child: Row(children: [
            Expanded(child: Text(k, style: TextStyle(fontWeight: strong ? FontWeight.w600 : null))),
            Text(rupees(v), style: TextStyle(fontWeight: strong ? FontWeight.w600 : null)),
          ]),
        );
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: Colors.white, border: Border.all(color: Brand.line), borderRadius: BorderRadius.circular(16)),
      child: Column(children: [
        row('You earned', s.earnedPaise),
        row('Paid to your account', s.paidOutPaise),
        row('Owed to you now', s.balancePaise, strong: true),
        const Divider(),
        row('PetApp fees (incl. GST)', s.feesPaise),
        row('TCS (GST) collected', s.tcsPaise),
        row('TDS (income tax) deducted', s.tdsPaise),
        const SizedBox(height: 6),
        const Text('TCS and TDS are deposited with the government in your name; claim them when you file your returns.', style: TextStyle(color: Brand.muted, fontSize: 12)),
      ]),
    );
  }
}

class _StatementTile extends StatelessWidget {
  const _StatementTile({required this.line});
  final StatementLine line;
  @override
  Widget build(BuildContext context) {
    final l = line;
    final parts = <String>[
      if (l.occurredAt != null) day(l.occurredAt!),
      if (l.salePaise != null && l.salePaise != l.amountPaise) 'price ${rupees(l.salePaise!)}',
      if (l.feePaise != 0) 'fee ${rupees(l.feePaise)}',
      if (l.tcsPaise != 0) 'TCS ${rupees(l.tcsPaise)}',
      if (l.tdsPaise != 0) 'TDS ${rupees(l.tdsPaise)}',
    ];
    return ListTile(
      contentPadding: EdgeInsets.zero,
      title: Text(statementKindText(l.kind)),
      subtitle: Text('${l.memo}\n${parts.join(' · ')}'),
      isThreeLine: true,
      trailing: Text(
        l.amountPaise > 0 ? '+${rupees(l.amountPaise)}' : rupees(l.amountPaise),
        style: TextStyle(fontWeight: FontWeight.w600, color: l.amountPaise >= 0 ? Brand.teal : Brand.ink),
      ),
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

class InvoicesScreen extends ConsumerStatefulWidget {
  const InvoicesScreen({super.key});
  @override
  ConsumerState<InvoicesScreen> createState() => _InvoicesScreenState();
}

class _InvoicesScreenState extends ConsumerState<InvoicesScreen> {
  final _items = <Invoice>[];
  int _page = 0;
  bool _more = true;
  bool _loading = false;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (_loading || !_more) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final (items, more) = await ref.read(apiProvider).invoices(page: _page + 1);
      if (!mounted) return;
      setState(() {
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
    Widget body;
    if (_items.isEmpty && _loading) {
      body = const LoadingView();
    } else if (_items.isEmpty && _error != null) {
      body = ErrorView(error: _error!, onRetry: _load);
    } else if (_items.isEmpty) {
      body = const EmptyView(
        title: 'No invoices yet',
        message: 'When you complete a visit, PetApp issues the invoice to the customer in your name. PetApp’s monthly fee invoices appear here too.',
      );
    } else {
      body = NotificationListener<ScrollNotification>(
        onNotification: (n) {
          if (n.metrics.pixels > n.metrics.maxScrollExtent - 300) _load();
          return false;
        },
        child: ListView.separated(
          itemCount: _items.length + (_more ? 1 : 0),
          separatorBuilder: (_, __) => const Divider(height: 1),
          itemBuilder: (context, i) {
            if (i == _items.length) return const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator()));
            final inv = _items[i];
            final toPetApp = inv.kind == 'COMMISSION';
            return ListTile(
              leading: const Icon(Icons.picture_as_pdf_outlined),
              title: Text('${invoiceKindText(inv.kind, inv.title)} ${inv.number}'),
              subtitle: Text([if (inv.issuedAt != null) day(inv.issuedAt!), toPetApp ? 'from PetApp' : 'to ${inv.recipientName}'].join(' · ')),
              trailing: Text(inv.kind == 'CREDIT_NOTE' ? rupees(-inv.totalPaise) : rupees(inv.totalPaise)),
              onTap: () => openInvoice(context, ref, inv),
            );
          },
        ),
      );
    }
    return Scaffold(appBar: AppBar(title: const Text('Invoices')), body: body);
  }
}
