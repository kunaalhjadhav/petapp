import 'package:flutter_test/flutter_test.dart';
import 'package:petapp/config_share.dart';
import 'package:petapp/services/deep_links.dart';

/// Links from the spec (petapp://pet/{id} …), the website (https://<site>/pet/…) and older share links.
void main() {
  final hosts = webHostsFor('https://petapp.in');
  String? r(String link) => routeForLink(Uri.parse(link), webHosts: hosts, scheme: 'petapp');

  test('the spec’s app links', () {
    expect(r('petapp://pet/bruno.lab'), '/pet/bruno.lab');
    expect(r('petapp://reel/6f1c'), '/post/6f1c');
    expect(r('petapp://contest/glam-cup'), '/contest/glam-cup');
    expect(r('petapp://product/yak-chew'), '/product/yak-chew');
    expect(r('petapp://service/happy-paws'), '/service-partner/happy-paws');
    expect(r('petapp://booking/b1'), '/booking/b1');
    expect(r('petapp://challenge/walk-week'), '/challenge/walk-week');
  });

  test('website links on our domain, with or without www', () {
    expect(r('https://petapp.in/pet/bruno'), '/pet/bruno');
    expect(r('https://www.petapp.in/reel/abc?utm_source=whatsapp'), '/post/abc');
    expect(r('https://PETAPP.in/service/paws/'), '/service-partner/paws');
    expect(r('https://petapp.in/p/abc'), '/post/abc');
    expect(r('https://petapp.in/legal/privacy-policy'), '/legal/privacy-policy');
  });

  test('older links still work', () {
    expect(r('petapp://app/post/abc'), '/post/abc');
  });

  test('anything else is ignored', () {
    expect(r('https://evil.example/pet/bruno'), isNull);
    expect(r('https://petapp.in.evil.example/pet/bruno'), isNull);
    expect(r('petapp://pet'), isNull);
    expect(r('petapp://pet/a/b'), isNull);
    expect(r('petapp://admin/users'), isNull);
    expect(r('https://petapp.in/'), isNull);
    expect(r('mailto:hi@petapp.in'), isNull);
    // Keys are re-encoded, so a link can't smuggle in another route.
    expect(r('petapp://pet/..%2Fsettings'), '/pet/..%2Fsettings');
  });

  test('share links point at the website', () {
    expect(shareLink(ShareKind.pet, 'bruno.lab'), '$shareBaseUrl/pet/bruno.lab');
    expect(shareLink(ShareKind.service, 'a b'), '$shareBaseUrl/service/a%20b');
  });
}
