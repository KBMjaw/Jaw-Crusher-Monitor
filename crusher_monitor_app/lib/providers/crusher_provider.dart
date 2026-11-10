import 'dart:async';
import 'package:flutter/foundation.dart';
import '../models/crusher_state.dart';
import '../services/websocket_service.dart';
import '../services/api_service.dart';

class CrusherProvider extends ChangeNotifier {
  final _ws = WebSocketService();

  CrusherState _state = CrusherState.empty;
  WsStatus _wsStatus = WsStatus.idle;
  bool _isLoading = false;
  String? _error;

  // OEE history for analytics chart
  List<Map<String, dynamic>> _oeeHistory = [];
  List<Map<String, dynamic>> _vfdHistory = [];
  List<Map<String, dynamic>> _alertHistory = [];
  List<Map<String, dynamic>> _shiftReports = [];

  CrusherState get state => _state;
  WsStatus get wsStatus => _wsStatus;
  bool get isLoading => _isLoading;
  String? get error => _error;
  bool get isConnected => _wsStatus == WsStatus.connected;

  List<Map<String, dynamic>> get oeeHistory => _oeeHistory;
  List<Map<String, dynamic>> get vfdHistory => _vfdHistory;
  List<Map<String, dynamic>> get alertHistory => _alertHistory;
  List<Map<String, dynamic>> get shiftReports => _shiftReports;

  void start() {
    _ws.statusStream.listen((s) {
      _wsStatus = s;
      notifyListeners();
    });

    _ws.stateStream.listen((s) {
      _state = s;
      _error = null;
      notifyListeners();
    });

    _ws.connect();
  }

  void reconnect() {
    _ws.disconnect();
    _ws.connect();
  }

  Future<void> loadOeeHistory({int hours = 24}) async {
    try {
      final data = await ApiService.getOeeHistory(hours: hours);
      _oeeHistory = List<Map<String, dynamic>>.from(data['oee_history'] as List? ?? []);
      notifyListeners();
    } catch (e) {
      _error = e.toString();
      notifyListeners();
    }
  }

  Future<void> loadVfdHistory({int minutes = 60}) async {
    try {
      final data = await ApiService.getVfdHistory(minutes: minutes);
      _vfdHistory = List<Map<String, dynamic>>.from(data['vfd_logs'] as List? ?? []);
      notifyListeners();
    } catch (e) {
      _error = e.toString();
      notifyListeners();
    }
  }

  Future<void> loadAlertHistory() async {
    try {
      final data = await ApiService.getAlertHistory();
      _alertHistory = List<Map<String, dynamic>>.from(data['alerts'] as List? ?? []);
      notifyListeners();
    } catch (e) {
      _error = e.toString();
      notifyListeners();
    }
  }

  Future<void> loadShiftReports() async {
    try {
      final data = await ApiService.getShiftReports();
      _shiftReports = List<Map<String, dynamic>>.from(data['shift_reports'] as List? ?? []);
      notifyListeners();
    } catch (e) {
      _error = e.toString();
      notifyListeners();
    }
  }

  Future<void> restartCamera() async {
    _isLoading = true;
    notifyListeners();
    try {
      await ApiService.restartCamera();
    } catch (e) {
      _error = e.toString();
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> resetShift() async {
    _isLoading = true;
    notifyListeners();
    try {
      await ApiService.resetShift();
    } catch (e) {
      _error = e.toString();
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> addTonnage(double tonnes) async {
    try {
      await ApiService.addTonnage(tonnes);
    } catch (e) {
      _error = e.toString();
      notifyListeners();
    }
  }

  @override
  void dispose() {
    _ws.dispose();
    super.dispose();
  }
}
