import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/crusher_provider.dart';
import '../services/api_service.dart';
import '../services/websocket_service.dart';
import '../theme/app_theme.dart';

class CameraScreen extends StatelessWidget {
  const CameraScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF060810),
      body: SafeArea(
        child: Column(
          children: [
            _CameraTopBar(),
            Expanded(child: _CameraBody()),
          ],
        ),
      ),
    );
  }
}

class _CameraTopBar extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final wsStatus = context.select<CrusherProvider, WsStatus>((p) => p.wsStatus);
    final (pillColor, pillLabel) = switch (wsStatus) {
      WsStatus.connected => (AppColors.green, 'CONNECTED'),
      WsStatus.connecting => (AppColors.amber, 'CONNECTING'),
      WsStatus.error => (AppColors.red, 'ERROR'),
      WsStatus.idle => (AppColors.text3Dark, 'OFFLINE'),
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: Color(0x10FFFFFF))),
      ),
      child: Row(
        children: [
          const Text('Live Camera Feed',
              style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w700)),
          const Spacer(),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: pillColor.withOpacity(0.1),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: pillColor.withOpacity(0.4)),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(width: 5, height: 5,
                    decoration: BoxDecoration(color: pillColor, shape: BoxShape.circle)),
                const SizedBox(width: 5),
                Text(pillLabel,
                    style: TextStyle(color: pillColor, fontSize: 10, fontWeight: FontWeight.w700)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _CameraBody extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Consumer<CrusherProvider>(
      builder: (_, provider, __) {
        final state = provider.state;
        return ListView(
          padding: const EdgeInsets.all(14),
          children: [
            // Video viewport
            _VideoViewport(
              frameBase64: state.frameBase64,
              camStatus: state.camStatus,
              jawLabel: state.jawLabel,
              jawConf: state.jawConf,
              machineStatus: state.machineStatus,
              fps: state.cameraFps,
              onRetry: () => provider.restartCamera(),
            ),
            const SizedBox(height: 14),

            // Camera restart button
            _CameraControlCard(
              camStatus: state.camStatus,
              onRestart: () async {
                try {
                  await ApiService.restartCamera();
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Camera restart initiated')));
                  }
                } catch (e) {
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text('Error: $e')));
                  }
                }
              },
            ),
            const SizedBox(height: 14),

            // AI inference panel
            _AiInferencePanel(state: state),
            const SizedBox(height: 14),

            // Stream info
            _StreamInfoCard(state: state),
            const SizedBox(height: 80),
          ],
        );
      },
    );
  }
}

class _VideoViewport extends StatelessWidget {
  final String? frameBase64;
  final String camStatus;
  final String jawLabel;
  final double jawConf;
  final String machineStatus;
  final double fps;
  final VoidCallback onRetry;

  const _VideoViewport({
    required this.frameBase64,
    required this.camStatus,
    required this.jawLabel,
    required this.jawConf,
    required this.machineStatus,
    required this.fps,
    required this.onRetry,
  });

  @override
  Widget build(BuildContext context) {
    return AspectRatio(
      aspectRatio: 4 / 3,
      child: Container(
        decoration: BoxDecoration(
          color: Colors.black,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: Colors.white.withOpacity(0.08)),
        ),
        clipBehavior: Clip.hardEdge,
        child: Stack(
          children: [
            // Frame or placeholder
            if (frameBase64 != null && frameBase64!.isNotEmpty)
              Positioned.fill(
                child: Image.memory(
                  base64Decode(frameBase64!),
                  fit: BoxFit.cover,
                  gaplessPlayback: true,
                ),
              )
            else
              _StateOverlay(camStatus: camStatus, onRetry: onRetry),

            // AI overlay (shown when live)
            if (frameBase64 != null && frameBase64!.isNotEmpty) ...[
              // Top-left: label + conf
              Positioned(
                top: 8, left: 8,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
                  decoration: BoxDecoration(
                    color: Colors.black.withOpacity(0.65),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(jawLabel,
                          style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w700)),
                      Text('${(jawConf * 100).toStringAsFixed(0)}%',
                          style: const TextStyle(color: AppColors.green, fontSize: 10)),
                    ],
                  ),
                ),
              ),

              // Top-right: machine status
              Positioned(
                top: 8, right: 8,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
                  decoration: BoxDecoration(
                    color: _statusColor(machineStatus).withOpacity(0.2),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: _statusColor(machineStatus).withOpacity(0.4)),
                  ),
                  child: Text(machineStatus,
                      style: TextStyle(
                          color: _statusColor(machineStatus),
                          fontSize: 10, fontWeight: FontWeight.w700)),
                ),
              ),

              // Bottom-right: FPS
              Positioned(
                bottom: 8, right: 8,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                  decoration: BoxDecoration(
                    color: Colors.black.withOpacity(0.55),
                    borderRadius: BorderRadius.circular(5),
                  ),
                  child: Text('${fps.toStringAsFixed(1)} fps',
                      style: const TextStyle(color: Color(0xFF00C8FF), fontSize: 9)),
                ),
              ),

              // Scan line
              const Positioned.fill(child: _ScanLine()),

              // Corner brackets
              ..._corners(),
            ],
          ],
        ),
      ),
    );
  }

  Color _statusColor(String s) => switch (s) {
        'NORMAL' => AppColors.green,
        'STONE STUCK' => AppColors.red,
        'NO RAW MATERIAL' => AppColors.orange,
        _ => AppColors.text3Dark,
      };

  List<Widget> _corners() {
    const c = Color(0x80_00C8FF);
    const w = 18.0;
    return [
      Positioned(top: 6, left: 6, child: _Corner(w, w, top: true, left: true, color: c)),
      Positioned(top: 6, right: 6, child: _Corner(w, w, top: true, left: false, color: c)),
      Positioned(bottom: 6, left: 6, child: _Corner(w, w, top: false, left: true, color: c)),
      Positioned(bottom: 6, right: 6, child: _Corner(w, w, top: false, left: false, color: c)),
    ];
  }
}

class _Corner extends StatelessWidget {
  final double width;
  final double height;
  final bool top;
  final bool left;
  final Color color;

  const _Corner(this.width, this.height, {required this.top, required this.left, required this.color});

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      size: Size(width, height),
      painter: _CornerPainter(top: top, left: left, color: color),
    );
  }
}

class _CornerPainter extends CustomPainter {
  final bool top;
  final bool left;
  final Color color;

  const _CornerPainter({required this.top, required this.left, required this.color});

  @override
  void paint(Canvas canvas, Size size) {
    final p = Paint()..color = color..strokeWidth = 2..style = PaintingStyle.stroke..strokeCap = StrokeCap.square;
    final x = left ? 0.0 : size.width;
    final y = top ? 0.0 : size.height;
    final dx = left ? size.width : -size.width;
    final dy = top ? size.height : -size.height;
    canvas.drawLine(Offset(x, y), Offset(x + dx, y), p);
    canvas.drawLine(Offset(x, y), Offset(x, y + dy), p);
  }

  @override
  bool shouldRepaint(_CornerPainter old) => false;
}

class _ScanLine extends StatefulWidget {
  const _ScanLine();

  @override
  State<_ScanLine> createState() => _ScanLineState();
}

class _ScanLineState extends State<_ScanLine> with SingleTickerProviderStateMixin {
  late final AnimationController _ctrl;
  late final Animation<double> _anim;

  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(vsync: this, duration: const Duration(seconds: 4))..repeat();
    _anim = Tween<double>(begin: 0, end: 1).animate(_ctrl);
  }

  @override
  void dispose() { _ctrl.dispose(); super.dispose(); }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _anim,
      builder: (_, __) => CustomPaint(
        painter: _ScanPainter(_anim.value),
      ),
    );
  }
}

class _ScanPainter extends CustomPainter {
  final double t;
  const _ScanPainter(this.t);

  @override
  void paint(Canvas canvas, Size size) {
    final y = size.height * t;
    final p = Paint()
      ..shader = LinearGradient(
        colors: [Colors.transparent, const Color(0x4D00C8FF), Colors.transparent],
      ).createShader(Rect.fromLTWH(0, y - 1, size.width, 2));
    canvas.drawRect(Rect.fromLTWH(0, y, size.width, 1), p);
  }

  @override
  bool shouldRepaint(_ScanPainter old) => old.t != t;
}

class _StateOverlay extends StatelessWidget {
  final String camStatus;
  final VoidCallback onRetry;

  const _StateOverlay({required this.camStatus, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Container(
      color: const Color(0xFF0A0C14),
      child: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            if (camStatus == 'connecting' || camStatus == 'stopped')
              const CircularProgressIndicator(color: AppColors.amber, strokeWidth: 2)
            else
              const Icon(Icons.videocam_off_rounded, color: AppColors.red, size: 48),
            const SizedBox(height: 12),
            Text(
              camStatus == 'connecting' ? 'Connecting to Stream' : 'Stream Unavailable',
              style: TextStyle(
                color: camStatus == 'error' ? AppColors.red : Colors.white,
                fontSize: 14, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 4),
            const Text('Check Pi is running & API server is on :8000',
                style: TextStyle(color: Colors.white38, fontSize: 10),
                textAlign: TextAlign.center),
            if (camStatus == 'error') ...[
              const SizedBox(height: 14),
              GestureDetector(
                onTap: onRetry,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 8),
                  decoration: BoxDecoration(
                    color: AppColors.amber.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: AppColors.amber.withOpacity(0.35)),
                  ),
                  child: const Text('↺ Retry Connection',
                      style: TextStyle(color: AppColors.amber, fontSize: 12, fontWeight: FontWeight.w700)),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _CameraControlCard extends StatelessWidget {
  final String camStatus;
  final VoidCallback onRestart;

  const _CameraControlCard({required this.camStatus, required this.onRestart});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surfaceDark,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.borderDark),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
                color: AppColors.amber.withOpacity(0.12), borderRadius: BorderRadius.circular(10)),
            child: const Icon(Icons.videocam_rounded, color: AppColors.amber, size: 18),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Camera Control',
                    style: TextStyle(color: AppColors.textDark, fontSize: 13, fontWeight: FontWeight.w600)),
                Text('Status: $camStatus',
                    style: const TextStyle(color: AppColors.text3Dark, fontSize: 11)),
              ],
            ),
          ),
          ElevatedButton.icon(
            onPressed: onRestart,
            icon: const Icon(Icons.refresh_rounded, size: 14),
            label: const Text('Restart'),
            style: ElevatedButton.styleFrom(
              minimumSize: const Size(0, 36),
              padding: const EdgeInsets.symmetric(horizontal: 14),
              textStyle: const TextStyle(fontSize: 12),
            ),
          ),
        ],
      ),
    );
  }
}

class _AiInferencePanel extends StatelessWidget {
  final dynamic state;

  const _AiInferencePanel({required this.state});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surfaceDark,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.borderDark),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('AI Inference',
              style: TextStyle(color: AppColors.textDark, fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: 0.5)),
          const SizedBox(height: 12),
          Row(
            children: [
              _InferenceStat(label: 'Label', value: state.jawLabel, color: AppColors.amberLight),
              const SizedBox(width: 10),
              _InferenceStat(
                  label: 'Confidence',
                  value: '${(state.jawConf * 100).toStringAsFixed(0)}%',
                  color: AppColors.green),
              const SizedBox(width: 10),
              _InferenceStat(label: 'Status', value: state.machineStatus, color: AppColors.green),
              const SizedBox(width: 10),
              _InferenceStat(label: 'FPS', value: '${state.cameraFps.toStringAsFixed(1)}', color: AppColors.blue),
            ],
          ),
        ],
      ),
    );
  }
}

class _InferenceStat extends StatelessWidget {
  final String label;
  final String value;
  final Color color;

  const _InferenceStat({required this.label, required this.value, required this.color});

  @override
  Widget build(BuildContext context) => Expanded(
        child: Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: AppColors.surface2Dark,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: AppColors.borderDark),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: const TextStyle(color: AppColors.text3Dark, fontSize: 9, letterSpacing: 0.5)),
              const SizedBox(height: 3),
              Text(value, style: TextStyle(color: color, fontSize: 13, fontWeight: FontWeight.w700),
                  overflow: TextOverflow.ellipsis, maxLines: 1),
            ],
          ),
        ),
      );
}

class _StreamInfoCard extends StatelessWidget {
  final dynamic state;

  const _StreamInfoCard({required this.state});

  @override
  Widget build(BuildContext context) {
    final rows = [
      ('Camera status', state.camStatus),
      ('Protocol', 'RTSP/TCP'),
      ('Channel', '101'),
      ('Model', 'YOLOv8s-cls'),
      ('Resolution', '640 × 480'),
      ('Frames total', '${state.frameCount}'),
    ];

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surfaceDark,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.borderDark),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Stream Info',
              style: TextStyle(color: AppColors.textDark, fontSize: 12, fontWeight: FontWeight.w700)),
          const SizedBox(height: 10),
          ...rows.mapIndexed((i, row) => Container(
                padding: const EdgeInsets.symmetric(vertical: 7),
                decoration: BoxDecoration(
                  border: i < rows.length - 1
                      ? const Border(bottom: BorderSide(color: AppColors.borderDark))
                      : null,
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(row.$1, style: const TextStyle(color: AppColors.text3Dark, fontSize: 11)),
                    Text(row.$2,
                        style: const TextStyle(
                            color: AppColors.textDark, fontSize: 10, fontWeight: FontWeight.w600, fontFamily: 'monospace')),
                  ],
                ),
              )),
        ],
      ),
    );
  }
}

extension _IndexedMap<T> on List<T> {
  Iterable<R> mapIndexed<R>(R Function(int i, T item) f) sync* {
    for (var i = 0; i < length; i++) yield f(i, this[i]);
  }
}
