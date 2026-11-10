import 'dart:convert';
import 'dart:io';

/// Loads `data` from a response recorded from the real API (see tool/record_fixtures.py).
dynamic fixture(String name) => (jsonDecode(File('test/fixtures/$name.json').readAsStringSync()) as Map<String, dynamic>)['data'];

String fixtureRaw(String name) => File('test/fixtures/$name.json').readAsStringSync();
