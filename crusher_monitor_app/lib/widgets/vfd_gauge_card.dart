import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

class VfdGaugeCard extends StatelessWidget {
  final int hz;
  final String jawLabel;
  final String machineStatus;

  const VfdGaugeCard({
    super.key,
    required this.hz,
    required this.jawLabel,
    required this.machineStatus,
  });

  @override
  Widget build(BuildContext context) {
    final pct = (hz / 50).clamp(0.0, 1.0);
    return Container(
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF0D1635), Color(0xFF1A2B5E)],
        ),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white.withOpacity(0.08)),
      ),
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('VFD FREQUENCY',
                      style: TextStyle(
                          color: AppColors.text2Dark,
                          fontSize: 10,
                          fontWeight: FontWeight.w600,
                          letterSpacing: 1.0)),
                  const SizedBox(height: 4),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.baseline,
                    textBaseline: TextBaseline.alphabetic,
                    children: [
                      Text('$hz',
                          style: const TextStyle(
                              color: AppColors.amberLight,
                              fontSize: 36,
                              fontWeight: FontWeight.w700)),
                      const SizedBox(width: 4),
                      const Text(' Hz',
                          style: TextStyle(color: AppColors.text2Dark, fontSize: 14)),
                    ],
                  ),
                ],
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  const Text('Target', style: TextStyle(color: AppColors.text2Dark, fontSize: 10)),
                  const SizedBox(height: 2),
                  Text(_statusLabel(machineStatus),
                      style: const TextStyle(
                          color: Colors.white60, fontSize: 11, fontWeight: FontWeight.w500)),
                ],
              ),
            ],
          ),
          const SizedBox(height: 14),

          // Track
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: LinearProgressIndicator(
              value: pct,
              minHeight: 8,
              backgroundColor: Colors.white.withOpacity(0.1),
              valueColor: const AlwaysStoppedAnimation(AppColors.amber),
            ),
          ),
          const SizedBox(height: 6),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: const [
              Text('0', style: TextStyle(color: AppColors.text3Dark, fontSize: 10)),
              Text('25', style: TextStyle(color: AppColors.text3Dark, fontSize: 10)),
              Text('50 Hz', style: TextStyle(color: AppColors.text3Dark, fontSize: 10)),
            ],
          ),
          const SizedBox(height: 14),

          // State chips
          Row(
            children: [
              _StateChip(label: 'Filled', hz: 20, active: hz == 20),
              const SizedBox(width: 8),
              _StateChip(label: 'Partial', hz: 37, active: hz == 37),
              const SizedBox(width: 8),
              _StateChip(label: 'Empty', hz: 50, active: hz == 50),
            ],
          ),
        ],
      ),
    );
  }

  String _statusLabel(String s) => switch (s) {
        'NORMAL' => 'Normal load',
        'STONE STUCK' => 'Jaw jammed',
        'NO RAW MATERIAL' => 'No material',
        _ => 'Stopped',
      };
}

class _StateChip extends StatelessWidget {
  final String label;
  final int hz;
  final bool active;

  const _StateChip({required this.label, required this.hz, required this.active});

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 300),
        padding: const EdgeInsets.symmetric(vertical: 9),
        decoration: BoxDecoration(
          color: active ? AppColors.amber.withOpacity(0.18) : Colors.white.withOpacity(0.06),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
              color: active ? AppColors.amber.withOpacity(0.4) : Colors.white.withOpacity(0.08)),
        ),
        child: Column(
          children: [
            Text('$hz',
                style: TextStyle(
                    color: active ? AppColors.amberLight : Colors.white70,
                    fontSize: 17,
                    fontWeight: FontWeight.w700)),
            const SizedBox(height: 2),
            Text(label.toUpperCase(),
                style: const TextStyle(color: Colors.white38, fontSize: 9, letterSpacing: 0.5)),
          ],
        ),
      ),
    );
  }
}
