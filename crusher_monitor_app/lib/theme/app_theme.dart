import 'package:flutter/material.dart';

// Design tokens matching the HTML dashboard
class AppColors {
  static const amber = Color(0xFFF5A623);
  static const amberDark = Color(0xFFD4881A);
  static const amberLight = Color(0xFFFFC85A);
  static const navy = Color(0xFF1A2B5E);
  static const navyLight = Color(0xFF243572);
  static const green = Color(0xFF1DB97A);
  static const red = Color(0xFFE03A3A);
  static const orange = Color(0xFFF07C20);
  static const blue = Color(0xFF2F7DEB);
  static const purple = Color(0xFF7C3AED);

  // Dark theme
  static const bgDark = Color(0xFF0D0F14);
  static const surfaceDark = Color(0xFF1A1E28);
  static const surface2Dark = Color(0xFF202535);
  static const surface3Dark = Color(0xFF252B3B);
  static const textDark = Color(0xFFF0F2FF);
  static const text2Dark = Color(0xFF8892B0);
  static const text3Dark = Color(0xFF4A5568);
  static const borderDark = Color(0x12FFFFFF);
}

ThemeData buildDarkTheme() {
  return ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    scaffoldBackgroundColor: AppColors.bgDark,
    colorScheme: const ColorScheme.dark(
      primary: AppColors.amber,
      secondary: AppColors.navy,
      surface: AppColors.surfaceDark,
      error: AppColors.red,
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: AppColors.bgDark,
      foregroundColor: AppColors.textDark,
      elevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(
        fontSize: 18,
        fontWeight: FontWeight.w700,
        color: AppColors.textDark,
        letterSpacing: 0.3,
      ),
    ),
    cardTheme: const CardThemeData(
      color: AppColors.surfaceDark,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.all(Radius.circular(16)),
        side: BorderSide(color: AppColors.borderDark),
      ),
    ),
    bottomNavigationBarTheme: const BottomNavigationBarThemeData(
      backgroundColor: AppColors.bgDark,
      selectedItemColor: AppColors.amber,
      unselectedItemColor: AppColors.text3Dark,
      type: BottomNavigationBarType.fixed,
      elevation: 0,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: AppColors.surface2Dark,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: AppColors.borderDark),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: AppColors.borderDark),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: AppColors.amber, width: 1.5),
      ),
      hintStyle: const TextStyle(color: AppColors.text3Dark),
      labelStyle: const TextStyle(color: AppColors.text2Dark),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: AppColors.amber,
        foregroundColor: Colors.white,
        minimumSize: const Size.fromHeight(50),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, letterSpacing: 0.5),
      ),
    ),
    textTheme: const TextTheme(
      headlineLarge: TextStyle(color: AppColors.textDark, fontWeight: FontWeight.w700, fontSize: 24),
      headlineMedium: TextStyle(color: AppColors.textDark, fontWeight: FontWeight.w700, fontSize: 20),
      titleLarge: TextStyle(color: AppColors.textDark, fontWeight: FontWeight.w700, fontSize: 16),
      titleMedium: TextStyle(color: AppColors.textDark, fontWeight: FontWeight.w600, fontSize: 14),
      bodyLarge: TextStyle(color: AppColors.text2Dark, fontSize: 13),
      bodyMedium: TextStyle(color: AppColors.text2Dark, fontSize: 12),
      bodySmall: TextStyle(color: AppColors.text3Dark, fontSize: 11),
      labelSmall: TextStyle(color: AppColors.text3Dark, fontSize: 9, letterSpacing: 0.8),
    ),
  );
}
