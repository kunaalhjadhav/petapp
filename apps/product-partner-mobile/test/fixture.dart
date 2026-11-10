import 'dart:convert';
import 'dart:io';

dynamic fixture(String name) => (jsonDecode(File('test/fixtures/$name.json').readAsStringSync()) as Map<String, dynamic>)['data'];
