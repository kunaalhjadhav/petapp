import 'dart:io';

import 'package:dio/dio.dart';

import '../api/api_client.dart';
import '../api/models.dart';
import '../api/vendor_api.dart';

/// Signed URL → PUT the file straight to storage (never through the API) → confirm. Returns the media id.
Future<String> _upload(VendorApi api, {required String kind, required String path, required String mime}) async {
  final file = File(path);
  final size = await file.length();
  final ticket = await api.createUpload(kind, mime, size);
  try {
    // A plain client: the storage URL must not receive the app's Authorization header.
    await Dio().request<void>(
      ticket.url,
      data: file.openRead(),
      options: Options(method: ticket.method, headers: {...ticket.headers, Headers.contentLengthHeader: size}),
    );
  } on DioException {
    throw ApiException(0, 'The upload didn’t finish. Check your connection and try again.');
  }
  await api.completeUpload(ticket.mediaId);
  return ticket.mediaId;
}

String _ext(String path) => path.split('.').last.toLowerCase();

/// Private verification document (the server checks the file really is a PDF/JPEG/PNG), attached to the store.
Future<VendorProfile> uploadDocument(VendorApi api, {required String kind, required String path}) async {
  final mime = switch (_ext(path)) {
    'pdf' => 'application/pdf',
    'png' => 'image/png',
    'jpg' || 'jpeg' => 'image/jpeg',
    _ => throw ApiException(400, 'Use a PDF, JPEG or PNG file.'),
  };
  final id = await _upload(api, kind: 'DOCUMENT', path: path, mime: mime);
  return api.addDocument(kind, id);
}

/// A product photo. The server resizes it in the background (and strips location data); this waits until
/// it's ready, because only finished photos can be put on a product.
Future<Photo> uploadProductPhoto(VendorApi api, String path, {Duration timeout = const Duration(seconds: 60)}) async {
  final mime = switch (_ext(path)) {
    'png' => 'image/png',
    'jpg' || 'jpeg' => 'image/jpeg',
    'webp' => 'image/webp',
    _ => throw ApiException(400, 'Use a JPEG, PNG or WebP photo.'),
  };
  final id = await _upload(api, kind: 'IMAGE', path: path, mime: mime);
  final until = DateTime.now().add(timeout);
  while (true) {
    final p = await api.media(id);
    if (p.status == 'READY') return p;
    if (p.status == 'REJECTED' || p.status == 'FAILED') throw ApiException(400, 'That photo couldn’t be used. Try a different one.');
    if (DateTime.now().isAfter(until)) throw ApiException(0, 'The photo is still processing. Try adding it again in a minute.');
    await Future<void>.delayed(const Duration(milliseconds: 800));
  }
}
