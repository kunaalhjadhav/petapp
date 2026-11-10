import 'package:flutter_test/flutter_test.dart';
import 'package:petapp/common/widgets.dart';
import 'package:petapp/services/phone.dart';
import 'package:petapp/services/upload_service.dart';
import 'package:petapp/features/notifications/notifications_screen.dart';

void main() {
  test('phone numbers follow the API’s rules', () {
    expect(normalizeIndianMobile('98123 45678'), '+919812345678');
    expect(normalizeIndianMobile('+91-98123-45678'), '+919812345678');
    expect(normalizeIndianMobile('09812345678'), '+919812345678');
    expect(normalizeIndianMobile('5812345678'), isNull);
    expect(normalizeIndianMobile('12345'), isNull);
    expect(formatIndianMobile('+919812345678'), '+91 98123 45678');
  });

  test('media types match what the API accepts', () {
    expect(mediaTypeOf('a/b/IMG_1.JPG'), (kind: 'IMAGE', mime: 'image/jpeg'));
    expect(mediaTypeOf('clip.mov'), (kind: 'VIDEO', mime: 'video/quicktime'));
    expect(() => mediaTypeOf('photo.heic'), throwsA(isA<UploadRejected>()));
  });

  test('relative times and counts', () {
    final now = DateTime(2026, 10, 2, 12);
    expect(ago(now.subtract(const Duration(seconds: 10)), now), 'just now');
    expect(ago(now.subtract(const Duration(minutes: 5)), now), '5m');
    expect(ago(now.subtract(const Duration(days: 2)), now), '2d');
    expect(ago(DateTime(2026, 8, 15), now), '15 Aug');
    expect(compact(950), '950');
    expect(compact(1500), '1.5k');
    expect(compact(23000), '23k');
    expect(initials('Aanya Kapoor'), 'AK');
  });

  test('notifications and pushes open the right screen', () {
    expect(routeFor('Post', 'p1'), '/post/p1');
    expect(routeFor('PET', 'x'), '/pet/x');
    expect(routeFor('User', 'u'), '/user/u');
    expect(routeFor('AppSetting', 'k'), isNull);
    expect(routeFor('Post', ''), isNull);
  });
}
