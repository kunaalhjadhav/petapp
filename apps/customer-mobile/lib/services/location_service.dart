import 'package:geolocator/geolocator.dart';

typedef LatLng = ({double lat, double lng});

/// City centres for when location is unavailable or refused.
const fallbackCities = <String, LatLng>{
  'Mumbai': (lat: 19.0760, lng: 72.8777),
  'Delhi': (lat: 28.6139, lng: 77.2090),
  'Bengaluru': (lat: 12.9716, lng: 77.5946),
  'Hyderabad': (lat: 17.3850, lng: 78.4867),
  'Chennai': (lat: 13.0827, lng: 80.2707),
  'Pune': (lat: 18.5204, lng: 73.8567),
  'Kolkata': (lat: 22.5726, lng: 88.3639),
  'Ahmedabad': (lat: 23.0225, lng: 72.5714),
};

/// The phone's position, or null if location is off or refused (the UI then offers a city).
Future<LatLng?> currentPosition() async {
  try {
    if (!await Geolocator.isLocationServiceEnabled()) return null;
    var perm = await Geolocator.checkPermission();
    if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
    if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) return null;
    final p = await Geolocator.getCurrentPosition(locationSettings: const LocationSettings(accuracy: LocationAccuracy.medium, timeLimit: Duration(seconds: 10)));
    return (lat: p.latitude, lng: p.longitude);
  } catch (_) {
    return null;
  }
}
