import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

class StatusChip extends StatelessWidget {
  final String status;

  const StatusChip({super.key, required this.status});

  @override
  Widget build(BuildContext context) {
    final (color, label) = _resolve(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: color.withOpacity(0.15),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withOpacity(0.4)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 6, height: 6,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle,
                boxShadow: [BoxShadow(color: color.withOpacity(0.6), blurRadius: 4)]),
          ),
          const SizedBox(width: 6),
          Text(label,
              style: TextStyle(
                  color: color, fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 0.3)),
        ],
      ),
    );
  }

  (Color, String) _resolve(String s) => switch (s.toUpperCase()) {
        'NORMAL' => (AppColors.green, 'NORMAL'),
        'STONE STUCK' => (AppColors.red, 'STONE STUCK'),
        'NO RAW MATERIAL' => (AppColors.orange, 'NO MATERIAL'),
        'FAULT' => (AppColors.red, 'FAULT'),
        'STOPPED' => (AppColors.text3Dark, 'STOPPED'),
        _ => (AppColors.text3Dark, s),
      };
}
