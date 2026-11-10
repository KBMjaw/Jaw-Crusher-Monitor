import 'dart:async';
import 'dart:convert';
import 'package:web_socket_channel/web_socket_channel.dart';
import '../config/app_config.dart';
import '../models/crusher_state.dart';

enum WsStatus { idle, connecting, connected, error }

class WebSocketService {
  WebSocketChannel? _channel;
  Timer? _reconnectTimer;
  int _attempt = 0;
  WsStatus _status = WsStatus.idle;

  final _stateController = StreamController<CrusherState>.broadcast();
  final _statusController = StreamController<WsStatus>.broadcast();

  Stream<CrusherState> get stateStream => _stateController.stream;
  Stream<WsStatus> get statusStream => _statusController.stream;
  WsStatus get status => _status;

  void connect() {
    if (_status == WsStatus.connected || _status == WsStatus.connecting) return;
    _setStatus(WsStatus.connecting);
    _doConnect();
  }

  void _doConnect() {
    final url = AppConfig.wsUrl;
    try {
      _channel = WebSocketChannel.connect(Uri.parse(url));
      _setStatus(WsStatus.connecting);

      _channel!.stream.listen(
        _onMessage,
        onError: _onError,
        onDone: _onDone,
        cancelOnError: false,
      );

      // Mark connected once first message arrives or via handshake
      // WebSocket channel doesn't expose onOpen directly; we mark connected on first message
    } catch (e) {
      _setStatus(WsStatus.error);
      _scheduleReconnect();
    }
  }

  void _onMessage(dynamic raw) {
    if (_status != WsStatus.connected) {
      _attempt = 0;
      _setStatus(WsStatus.connected);
    }
    try {
      final json = jsonDecode(raw as String) as Map<String, dynamic>;
      _stateController.add(CrusherState.fromJson(json));
    } catch (_) {}
  }

  void _onError(Object err) {
    _setStatus(WsStatus.error);
    _scheduleReconnect();
  }

  void _onDone() {
    if (_status == WsStatus.connected) {
      _setStatus(WsStatus.error);
      _scheduleReconnect();
    }
  }

  void _scheduleReconnect() {
    if (_reconnectTimer?.isActive == true) return;
    _attempt++;
    final delaySec = (_attempt * 3).clamp(3, 30);
    _reconnectTimer = Timer(Duration(seconds: delaySec), () {
      if (_status != WsStatus.connected) _doConnect();
    });
  }

  void disconnect() {
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    _channel?.sink.close();
    _channel = null;
    _setStatus(WsStatus.idle);
    _attempt = 0;
  }

  void _setStatus(WsStatus s) {
    _status = s;
    _statusController.add(s);
  }

  void dispose() {
    disconnect();
    _stateController.close();
    _statusController.close();
  }
}
