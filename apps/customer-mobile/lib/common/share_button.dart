import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

import '../config_share.dart';

/// Shares a link to the thing on the PetApp website, which opens the app for people who have it.
class ShareButton extends StatelessWidget {
  const ShareButton({super.key, required this.kind, required this.linkKey, required this.text});
  final ShareKind kind;
  final String linkKey;

  /// A line before the link, e.g. "Meet Bruno on PetApp".
  final String text;

  @override
  Widget build(BuildContext context) => IconButton(
        tooltip: 'Share',
        icon: const Icon(Icons.ios_share_rounded),
        onPressed: () => Share.share('$text\n${shareLink(kind, linkKey)}'),
      );
}
