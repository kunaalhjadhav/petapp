import 'package:flutter/material.dart';

/// Brand: warm paper, deep ink, collar teal (shared with the admin dashboard), terracotta for love.
class Brand {
  static const teal = Color(0xFF1D5C58);
  static const paper = Color(0xFFFBF7F1);
  static const ink = Color(0xFF231C17);
  static const muted = Color(0xFF6B5E54);
  static const line = Color(0xFFEADFD3);
  static const heart = Color(0xFFB4471F);
}

ThemeData buildTheme() {
  final scheme = ColorScheme.fromSeed(seedColor: Brand.teal, surface: Brand.paper).copyWith(primary: Brand.teal, onSurface: Brand.ink);
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: Brand.paper,
    appBarTheme: const AppBarTheme(backgroundColor: Brand.paper, foregroundColor: Brand.ink, elevation: 0, scrolledUnderElevation: 0.5, centerTitle: false),
    dividerColor: Brand.line,
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Brand.line)),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Brand.line)),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24))),
    ),
    navigationBarTheme: const NavigationBarThemeData(backgroundColor: Colors.white, indicatorColor: Color(0xFFDCEBE8)),
  );
}
