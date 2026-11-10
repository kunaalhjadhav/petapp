import 'dart:io';

import 'package:dio/dio.dart';

import '../api/api_client.dart';
import '../api/models.dart';
import '../api/partner_api.dart';

/// Private KYC upload: signed URL → PUT the file straight to storage → confirm → attach to the profile.
/// The server checks the file's signature (a "PDF" that isn't one is refused).
Future<PartnerProfile> uploadDocument(PartnerApi api, {required String kind, required String path}) async {
  final ext = path.split('.').last.toLowerCase();
  final mime = switch (ext) {
    'pdf' => 'application/pdf',
    'png' => 'image/png',
    'jpg' || 'jpeg' => 'image/jpeg',
    _ => throw ApiException(400, 'Use a PDF, JPEG or PNG file.'),
  };
  final file = File(path);
  final size = await file.length();
  final ticket = await api.createDocumentUpload(mime, size);
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
  return api.addDocument(kind, ticket.mediaId);
}
