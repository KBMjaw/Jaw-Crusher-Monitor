import 'dart:convert';
import 'package:http/http.dart' as http;
import '../config/app_config.dart';

class ApiService {
  static final _client = http.Client();

  static Future<Map<String, dynamic>> _get(String path, {Map<String, String>? params}) async {
    var uri = Uri.parse(AppConfig.endpoint(path));
    if (params != null) uri = uri.replace(queryParameters: params);
    final resp = await _client.get(uri).timeout(const Duration(seconds: 10));
    if (resp.statusCode == 200) return jsonDecode(resp.body) as Map<String, dynamic>;
    throw Exception('HTTP ${resp.statusCode}: $path');
  }

  static Future<Map<String, dynamic>> _post(String path) async {
    final uri = Uri.parse(AppConfig.endpoint(path));
    final resp = await _client.post(uri).timeout(const Duration(seconds: 10));
    if (resp.statusCode == 200) return jsonDecode(resp.body) as Map<String, dynamic>;
    throw Exception('HTTP ${resp.statusCode}: $path');
  }

  // ── Live state ──────────────────────────────────────────────
  static Future<Map<String, dynamic>> getCrusherState() => _get('/api/crusher');
  static Future<Map<String, dynamic>> getCameraStatus() => _get('/api/camera/status');

  // ── OEE ─────────────────────────────────────────────────────
  static Future<Map<String, dynamic>> getOee() => _get('/api/oee');

  // ── Alerts ──────────────────────────────────────────────────
  static Future<Map<String, dynamic>> getAlerts() => _get('/api/alerts');

  // ── History ─────────────────────────────────────────────────
  static Future<Map<String, dynamic>> getOeeHistory({int hours = 24}) =>
      _get('/api/db/oee', params: {'hours': hours.toString()});

  static Future<Map<String, dynamic>> getVfdHistory({int minutes = 60}) =>
      _get('/api/db/vfd', params: {'minutes': minutes.toString()});

  static Future<Map<String, dynamic>> getAlertHistory({int limit = 100}) =>
      _get('/api/db/alerts', params: {'limit': limit.toString()});

  static Future<Map<String, dynamic>> getShiftReports({int limit = 30}) =>
      _get('/api/db/shifts', params: {'limit': limit.toString()});

  static Future<Map<String, dynamic>> getTodaySummary() => _get('/api/db/summary');

  // ── Actions ─────────────────────────────────────────────────
  static Future<void> restartCamera() => _post('/api/camera/restart');

  static Future<void> resetShift() => _post('/api/shift/reset');

  static Future<void> addTonnage(double tonnes) =>
      _post('/api/tonnage/${tonnes.toStringAsFixed(2)}');

  // ── VFD (ABB Modbus) ────────────────────────────────────────
  /// Live VFD status: connected, profile, current Hz, status word, write counters.
  static Future<Map<String, dynamic>> getVfdStatus() => _get('/api/vfd/status');

  /// Manual frequency override. Backend clamps to [0, VFD_MAX_HZ].
  /// hz = 0 issues the stop command.
  static Future<void> setVfdFrequency(int hz) =>
      _post('/api/vfd/set/$hz');

  /// Force the drive to ramp down to zero.
  static Future<void> stopVfd() => _post('/api/vfd/stop');

  /// Acknowledge a tripped drive (sends ABB control word 0x04FF).
  static Future<void> resetVfdFault() => _post('/api/vfd/reset-fault');

  // ── Reports (downloadable bytes — caller saves to a file) ───
  /// Returns the PDF bytes. UI layer should save to disk and open.
  static Future<List<int>> downloadShiftPdf({int limit = 20}) async {
    final uri = Uri.parse(AppConfig.endpoint('/api/reports/shift-pdf'))
        .replace(queryParameters: {'limit': limit.toString()});
    final resp = await _client.get(uri).timeout(const Duration(seconds: 30));
    if (resp.statusCode == 200) return resp.bodyBytes;
    throw Exception('HTTP ${resp.statusCode}: shift-pdf');
  }

  static Future<List<int>> downloadShiftCsv({int limit = 20}) async {
    final uri = Uri.parse(AppConfig.endpoint('/api/reports/shift-csv'))
        .replace(queryParameters: {'limit': limit.toString()});
    final resp = await _client.get(uri).timeout(const Duration(seconds: 30));
    if (resp.statusCode == 200) return resp.bodyBytes;
    throw Exception('HTTP ${resp.statusCode}: shift-csv');
  }

  // ── Auth ────────────────────────────────────────────────────
  /// Returns the role payload on success; throws on 401.
  static Future<Map<String, dynamic>> login(String username, String password) async {
    final uri = Uri.parse(AppConfig.endpoint('/api/auth/login'));
    final resp = await _client.post(
      uri,
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'username': username, 'password': password}),
    ).timeout(const Duration(seconds: 10));
    final data = jsonDecode(resp.body) as Map<String, dynamic>;
    if (resp.statusCode == 200 && data['ok'] == true) return data;
    throw Exception(data['error'] ?? 'Login failed');
  }
}
