import 'package:dio/dio.dart';
import 'package:image_picker/image_picker.dart';

import '../api/api_client.dart';
import '../api/models.dart';
import '../api/petapp_api.dart';
import 'upload_logic.dart';

/// The connection dropped and didn't come back: [sent] holds what's already safely uploaded (by file position), to
/// pass back to [UploadService.uploadAll] so it carries on where it stopped.
class UploadInterrupted implements Exception {
  UploadInterrupted(this.sent, this.statusCode);
  final Map<int, String> sent;
  final int statusCode;
  @override
  String toString() => 'The upload paused: the connection dropped. Tap Retry to carry on where it stopped.';
}

class _PartsFailed implements Exception {
  _PartsFailed(this.statusCode);
  final int statusCode;
}

/// Thrown for files the app can tell are unsupported before uploading.
class UploadRejected implements Exception {
  UploadRejected(this.message);
  final String message;
  @override
  String toString() => message;
}

({String kind, String mime}) mediaTypeOf(String path) {
  final ext = path.split('.').last.toLowerCase();
  return switch (ext) {
    'jpg' || 'jpeg' => (kind: 'IMAGE', mime: 'image/jpeg'),
    'png' => (kind: 'IMAGE', mime: 'image/png'),
    'webp' => (kind: 'IMAGE', mime: 'image/webp'),
    'mp4' || 'm4v' => (kind: 'VIDEO', mime: 'video/mp4'),
    'mov' => (kind: 'VIDEO', mime: 'video/quicktime'),
    'webm' => (kind: 'VIDEO', mime: 'video/webm'),
    _ => throw UploadRejected('This file type isn’t supported. Use a photo (JPEG, PNG, WebP) or a video (MP4, MOV).'),
  };
}

/// Signed-URL upload: ask the API for a URL, PUT the bytes straight to storage, confirm.
/// Processing then continues on the server; the post publishes itself when it's ready.
class UploadService {
  UploadService(this._api);
  final PetAppApi _api;

  /// A plain client: the storage URL must not receive the app's Authorization header.
  final Dio _storage = Dio(BaseOptions(connectTimeout: const Duration(seconds: 20), sendTimeout: const Duration(minutes: 10)));

  /// Uploads files in order and returns their media ids. [onProgress] gets 0..1 across all files.
  ///
  /// Large videos go in parts (spec §84): a dropped connection re-sends only the part it was on, a few times with
  /// growing waits. If the connection stays down, [UploadInterrupted] says what was sent; pass its [UploadInterrupted.sent]
  /// back as [resume] to carry on where it stopped instead of starting again.
  Future<List<String>> uploadAll(List<XFile> files, {void Function(double)? onProgress, Map<int, String> resume = const {}}) async {
    final sizes = [for (final f in files) await f.length()];
    final total = sizes.fold<int>(0, (a, b) => a + b);
    var done = 0;
    final ids = <int, String>{};
    for (var i = 0; i < files.length; i++) {
      final f = files[i];
      final type = mediaTypeOf(f.path);
      void progress(int bytes) => onProgress?.call(overallProgress(done, bytes, total));
      try {
        final earlier = resume[i];
        UploadProgress? where;
        if (earlier != null) {
          try {
            where = await _api.uploadProgress(earlier);
          } on ApiException catch (e) {
            if (e.isOffline) rethrow;
            where = null; // expired or gone: start this file again
          }
        }
        if (earlier != null && where != null && where.status != 'PENDING_UPLOAD') {
          ids[i] = earlier; // finished before the interruption
        } else if (earlier != null && where != null && where.method == 'MULTIPART') {
          await _sendParts(f, earlier, sizes[i], where.partSize, progress);
          await _api.completeUpload(earlier);
          ids[i] = earlier;
        } else {
          final ticket = await _api.createUpload(type.kind, type.mime, sizes[i], resumable: type.kind == 'VIDEO');
          ids[i] = ticket.mediaId;
          if (ticket.inParts) {
            await _sendParts(f, ticket.mediaId, sizes[i], ticket.partSize, progress);
          } else {
            await _storage.request<void>(
              ticket.url,
              data: f.openRead(),
              options: Options(method: ticket.method, headers: {...ticket.headers, Headers.contentLengthHeader: sizes[i]}),
              onSendProgress: (sent, _) => progress(sent),
            );
          }
          await _api.completeUpload(ticket.mediaId);
        }
      } on DioException catch (e) {
        throw UploadInterrupted(Map.of(ids), e.response?.statusCode ?? 0);
      } on _PartsFailed catch (e) {
        throw UploadInterrupted(Map.of(ids), e.statusCode);
      } on ApiException catch (e) {
        // No connection to the API either: keep what was sent, to carry on later.
        if (e.isOffline || e.status >= 500) throw UploadInterrupted(Map.of(ids), e.status);
        rethrow;
      }
      done += sizes[i];
      progress(0);
    }
    return [for (var i = 0; i < files.length; i++) ids[i]!];
  }

  /// Sends whatever parts storage doesn't have yet. Each part is retried on its own; addresses are fetched in
  /// small batches (they expire), and fetched again when one has.
  Future<void> _sendParts(XFile f, String mediaId, int size, int partSize, void Function(int) progress) async {
    for (var round = 0; round < 3; round++) {
      final status = await _api.uploadProgress(mediaId);
      if (status.missing.isEmpty) return;
      var sent = status.uploadedBytes;
      progress(sent);
      for (final batch in batchesOf(status.missing)) {
        var urls = {for (final u in await _api.uploadPartUrls(mediaId, batch)) u.partNumber: u};
        for (final n in batch) {
          for (var attempt = 0;; attempt++) {
            final part = urls[n]!;
            final r = partRange(n, partSize, size);
            try {
              await _storage.request<void>(
                part.url,
                data: f.openRead(r.start, r.end),
                options: Options(method: 'PUT', headers: {...part.headers, Headers.contentLengthHeader: part.length}),
                onSendProgress: (bytes, _) => progress(sent + bytes),
              );
              sent += part.length;
              break;
            } on DioException catch (e) {
              final code = e.response?.statusCode;
              if (!retryable(code) || attempt >= 5) throw _PartsFailed(code ?? 0);
              await Future<void>.delayed(retryDelay(attempt));
              if (code == 403) urls = {for (final u in await _api.uploadPartUrls(mediaId, batch)) u.partNumber: u};
            }
          }
        }
      }
    }
    if ((await _api.uploadProgress(mediaId)).missing.isNotEmpty) throw _PartsFailed(0);
  }

  /// A photo for a chat, a support ticket or a report: uploaded privately, then waited on until the server has prepared it.
  Future<String> uploadPrivatePhoto(XFile f, {void Function(double)? onProgress}) => uploadPhoto(f, private: true, onProgress: onProgress);

  /// A photo for a review (public), or a private one; returns once the server has prepared it.
  Future<String> uploadPhoto(XFile f, {required bool private, void Function(double)? onProgress}) async {
    final type = mediaTypeOf(f.path);
    if (type.kind != 'IMAGE') throw UploadRejected(private ? 'Only photos can be sent in messages.' : 'Only photos can be added to a review.');
    final size = await f.length();
    final ticket = await _api.createUpload('IMAGE', type.mime, size, private: private);
    try {
      await _storage.request<void>(
        ticket.url,
        data: f.openRead(),
        options: Options(method: ticket.method, headers: {...ticket.headers, Headers.contentLengthHeader: size}),
        onSendProgress: (sent, _) => onProgress?.call(size == 0 ? 1 : sent / size),
      );
    } on DioException catch (e) {
      throw ApiException(e.response?.statusCode ?? 0, 'The photo didn’t upload. Check your connection and try again.');
    }
    var m = await _api.completeUpload(ticket.mediaId);
    for (var i = 0; i < 60 && !m.isFinal; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 500));
      m = await _api.media(ticket.mediaId);
    }
    if (!m.isReady) throw UploadRejected(m.isFinal ? 'This photo couldn’t be used. Try another.' : 'The photo is taking a while. Try sending it again.');
    return ticket.mediaId;
  }
}
