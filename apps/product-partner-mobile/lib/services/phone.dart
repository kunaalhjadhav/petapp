/// Mirrors the API's rules: 10-digit Indian mobile starting 6–9, optionally with +91/0 prefix.
/// Returns the number to send to the API, or null if it can't be valid.
String? normalizeIndianMobile(String input) {
  var d = input.replaceAll(RegExp(r'[^\d]'), '');
  if (d.startsWith('91') && d.length == 12) d = d.substring(2);
  if (d.startsWith('0') && d.length == 11) d = d.substring(1);
  return RegExp(r'^[6-9]\d{9}$').hasMatch(d) ? '+91$d' : null;
}

/// "+919812345678" → "+91 98123 45678"
String formatIndianMobile(String e164) {
  final m = RegExp(r'^\+91(\d{5})(\d{5})$').firstMatch(e164);
  return m == null ? e164 : '+91 ${m[1]} ${m[2]}';
}
