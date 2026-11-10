// Same rules as the customer app (lib/api/offline_logic.dart, Phase 10b, spec §85).

/// What people read when something fails. The API's own words for things they can fix (validation, closed
/// registration, not available here); never the server's internals.
String friendlyMessage(int status, String? apiMessage) {
  if (status == 0) return 'No internet connection. Check your network and try again.';
  if (status == 408 || status == 504) return 'The connection is slow. Please try again.';
  if (status == 429) return apiMessage ?? 'Too many tries. Wait a moment and try again.';
  // 503s the API writes for people ("Downloads aren't available right now"); a bare one is a load balancer.
  if (status == 503) return apiMessage ?? 'PetApp is busy right now. Please try again in a moment.';
  if (status >= 500) return 'Something went wrong on our side. Please try again in a moment.';
  return apiMessage ?? 'Something went wrong. Please try again.';
}
