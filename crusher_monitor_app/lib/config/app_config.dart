import 'package:shared_preferences/shared_preferences.dart';

class AppConfig {
  static const _keyPiBase = 'pi_base';
  static const _defaultBase = 'http://192.168.0.124:8000';

  static late SharedPreferences _prefs;

  static Future<void> init() async {
    _prefs = await SharedPreferences.getInstance();
  }

  static String get piBase => _prefs.getString(_keyPiBase) ?? _defaultBase;

  static Future<void> setPiBase(String url) async {
    final clean = url.replaceAll(RegExp(r'/+$'), '');
    await _prefs.setString(_keyPiBase, clean);
  }

  static String get wsUrl => piBase.replaceFirst('http', 'ws').replaceFirst('https', 'wss') + '/ws/camera';
  static String get apiBase => piBase;

  static String endpoint(String path) => '$apiBase$path';
}
