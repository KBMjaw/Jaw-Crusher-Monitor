import 'package:shared_preferences/shared_preferences.dart';

class AuthService {
  static const _keyUser = 'auth_user';
  static const _keyPass = 'auth_pass';
  static const _keyRemember = 'remember_user';
  static const _keyLoggedIn = 'is_logged_in';

  // Default credentials — these should be configurable from Settings
  static const _defaultUser = 'admin';
  static const _defaultPass = 'admin123';

  static Future<bool> login(String username, String password, {bool remember = false}) async {
    final prefs = await SharedPreferences.getInstance();

    // Check against stored credentials or defaults
    final storedUser = prefs.getString(_keyUser) ?? _defaultUser;
    final storedPass = prefs.getString(_keyPass) ?? _defaultPass;

    if (username == storedUser && password == storedPass) {
      await prefs.setBool(_keyLoggedIn, true);
      if (remember) await prefs.setString(_keyRemember, username);
      return true;
    }
    return false;
  }

  static Future<void> logout() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_keyLoggedIn, false);
  }

  static Future<bool> isLoggedIn() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(_keyLoggedIn) ?? false;
  }

  static Future<String?> rememberedUser() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_keyRemember);
  }

  static Future<void> changePassword(String newUser, String newPass) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_keyUser, newUser);
    await prefs.setString(_keyPass, newPass);
  }
}
