import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

class TimerRingCard extends StatelessWidget {
  final String label;
  final String hmsValue;
  final Color ringColor;
  final int thresholdSeconds;

  const TimerRingCard({
    super.key,
    required this.label,
    required this.hmsValue,
    required this.ringColor,
    required this.thresholdSeconds,
  });

  @override
  Widget build(BuildContext context) {
    final secs = _parseSeconds(hmsValue);
    final pct = (secs / thresholdSeconds).clamp(0.0, 1.0);

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surfaceDark,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.borderDark),
      ),
      child: Column(
        children: [
          SizedBox(
            width: 74, height: 74,
            child: Stack(
              alignment: Alignment.center,
              children: [
                CustomPaint(
                  size: const Size(74, 74),
                  painter: _RingPainter(pct: pct, color: ringColor),
                ),
                Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(_displayValue(secs),
                        style: TextStyle(
                            color: ringColor, fontSize: 18, fontWeight: FontWeight.w700)),
                    Text(secs < 60 ? 'sec' : 'min',
                        style: const TextStyle(color: AppColors.text3Dark, fontSize: 9)),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          Text(label,
              style: const TextStyle(
                  color: AppColors.text2Dark, fontSize: 11, fontWeight: FontWeight.w500),
              textAlign: TextAlign.center),
          const SizedBox(height: 2),
          Text('alert at ${thresholdSeconds}s',
              style: const TextStyle(color: AppColors.text3Dark, fontSize: 10)),
        ],
      ),
    );
  }

  String _displayValue(int secs) {
    if (secs < 60) return '$secs';
    return '${(secs / 60).floor()}';
  }

  int _parseSeconds(String hms) {
    final parts = hms.split(':');
    if (parts.length != 3) return 0;
    final h = int.tryParse(parts[0]) ?? 0;
    final m = int.tryParse(parts[1]) ?? 0;
    final s = int.tryParse(parts[2]) ?? 0;
    return h * 3600 + m * 60 + s;
  }
}

class _RingPainter extends CustomPainter {
  final double pct;
  final Color color;

  const _RingPainter({required this.pct, required this.color});

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = size.width / 2 - 5;
    final stroke = 5.0;

    // Background ring
    final bgPaint = Paint()
      ..color = AppColors.surface3Dark
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke
      ..strokeCap = StrokeCap.round;
    canvas.drawCircle(center, radius, bgPaint);

    // Filled arc
    if (pct > 0) {
      final fillPaint = Paint()
        ..color = color
        ..style = PaintingStyle.stroke
        ..strokeWidth = stroke
        ..strokeCap = StrokeCap.round;
      canvas.drawArc(
        Rect.fromCircle(center: center, radius: radius),
        -math.pi / 2,
        2 * math.pi * pct,
        false,
        fillPaint,
      );
    }
  }

  @override
  bool shouldRepaint(_RingPainter old) => old.pct != pct || old.color != color;
}
