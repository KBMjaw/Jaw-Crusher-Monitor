import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

class OeeCard extends StatelessWidget {
  final double availabilityPct;
  final String timerRun;
  final String timerStuck;
  final String timerNoFeed;

  const OeeCard({
    super.key,
    required this.availabilityPct,
    required this.timerRun,
    required this.timerStuck,
    required this.timerNoFeed,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surfaceDark,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.borderDark),
      ),
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Text('OEE Metrics',
                  style: TextStyle(
                      color: AppColors.textDark, fontSize: 13, fontWeight: FontWeight.w700)),
              const SizedBox(width: 8),
              Expanded(child: Container(height: 1, color: AppColors.borderDark)),
            ],
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: _MetricBox(
                  label: 'AVAILABILITY',
                  value: '${availabilityPct.toStringAsFixed(1)}%',
                  color: AppColors.green,
                  barPct: availabilityPct / 100,
                  highlight: true,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _MetricBox(
                  label: 'RUN TIME',
                  value: timerRun,
                  color: AppColors.blue,
                  barPct: null,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: _MetricBox(
                  label: 'STUCK TIME',
                  value: timerStuck,
                  color: AppColors.red,
                  barPct: null,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _MetricBox(
                  label: 'NO FEED',
                  value: timerNoFeed,
                  color: AppColors.orange,
                  barPct: null,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _MetricBox extends StatelessWidget {
  final String label;
  final String value;
  final Color color;
  final double? barPct;
  final bool highlight;

  const _MetricBox({
    required this.label,
    required this.value,
    required this.color,
    this.barPct,
    this.highlight = false,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: highlight
            ? AppColors.amber.withOpacity(0.08)
            : AppColors.surface2Dark,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: highlight ? AppColors.amber.withOpacity(0.25) : AppColors.borderDark,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(value,
              style: TextStyle(color: color, fontSize: 18, fontWeight: FontWeight.w700)),
          const SizedBox(height: 2),
          Text(label,
              style: const TextStyle(
                  color: AppColors.text3Dark, fontSize: 9, letterSpacing: 0.8)),
          if (barPct != null) ...[
            const SizedBox(height: 8),
            ClipRRect(
              borderRadius: BorderRadius.circular(3),
              child: LinearProgressIndicator(
                value: barPct,
                minHeight: 3,
                backgroundColor: AppColors.surface3Dark,
                valueColor: AlwaysStoppedAnimation(color),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
