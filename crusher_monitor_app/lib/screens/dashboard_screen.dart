import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../providers/crusher_provider.dart';
import '../services/websocket_service.dart';
import '../theme/app_theme.dart';
import '../widgets/oee_card.dart';
import '../widgets/status_chip.dart';

class DashboardScreen extends StatelessWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Column(
        children: [
          _DashHero(),
          Expanded(child: _DashBody()),
        ],
      ),
    );
  }
}

class _DashHero extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final wsStatus = context.select<CrusherProvider, WsStatus>((p) => p.wsStatus);
    final fps = context.select<CrusherProvider, double>((p) => p.state.cameraFps);
    final conf = context.select<CrusherProvider, double>((p) => p.state.jawConf);

    final now = DateTime.now();
    final hour = now.hour;
    final greeting = hour < 12 ? 'Good morning,' : hour < 17 ? 'Good afternoon,' : 'Good evening,';
    final timeStr = DateFormat('HH:mm:ss').format(now);

    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF1A2B5E), Color(0xFF0D1635), Color(0xFF0A0C14)],
          stops: [0, 0.6, 1],
        ),
      ),
      padding: EdgeInsets.only(
        top: MediaQuery.of(context).padding.top + 16,
        left: 22, right: 22, bottom: 20,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(greeting,
                        style: const TextStyle(color: Colors.white54, fontSize: 12)),
                    const SizedBox(height: 2),
                    const Text('Kannan Blue Metals',
                        style: TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w700)),
                    const Text('Chennimalai, Erode · Plant AI Monitor',
                        style: TextStyle(color: AppColors.amber, fontSize: 11)),
                  ],
                ),
              ),
              _WsIndicator(status: wsStatus),
            ],
          ),
          const SizedBox(height: 16),

          // Stats row
          Row(
            children: [
              _StatCard(
                value: '1',
                label: 'Online',
                color: AppColors.green,
              ),
              const SizedBox(width: 10),
              _StatCard(
                value: '${fps.toStringAsFixed(1)}',
                label: 'FPS',
                color: AppColors.blue,
              ),
              const SizedBox(width: 10),
              _StatCard(
                value: '${(conf * 100).toStringAsFixed(0)}%',
                label: 'AI Conf',
                color: AppColors.amber,
              ),
            ],
          ),

          const SizedBox(height: 12),
          Row(
            children: [
              Container(
                width: 7, height: 7,
                decoration: const BoxDecoration(
                    color: AppColors.green, shape: BoxShape.circle,
                    boxShadow: [BoxShadow(color: AppColors.green, blurRadius: 6)]),
              ),
              const SizedBox(width: 8),
              const Text('Live · RTSP/TCP · YOLOv8s-cls',
                  style: TextStyle(color: Colors.white70, fontSize: 11)),
              const Spacer(),
              Text(timeStr,
                  style: const TextStyle(
                      color: Colors.white38, fontSize: 11, fontFamily: 'monospace')),
            ],
          ),
        ],
      ),
    );
  }
}

class _WsIndicator extends StatelessWidget {
  final WsStatus status;

  const _WsIndicator({required this.status});

  @override
  Widget build(BuildContext context) {
    final (color, label) = switch (status) {
      WsStatus.connected => (AppColors.green, 'LIVE'),
      WsStatus.connecting => (AppColors.amber, 'CONN'),
      WsStatus.error => (AppColors.red, 'ERR'),
      WsStatus.idle => (AppColors.text3Dark, 'IDLE'),
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: color.withOpacity(0.12),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color.withOpacity(0.3)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(width: 5, height: 5,
              decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
          const SizedBox(width: 5),
          Text(label, style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.w700)),
        ],
      ),
    );
  }
}

class _StatCard extends StatelessWidget {
  final String value;
  final String label;
  final Color color;

  const _StatCard({required this.value, required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10),
        decoration: BoxDecoration(
          color: AppColors.surfaceDark,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.borderDark),
        ),
        child: Column(
          children: [
            Text(value,
                style: TextStyle(color: color, fontSize: 20, fontWeight: FontWeight.w700)),
            const SizedBox(height: 2),
            Text(label,
                style: const TextStyle(
                    color: AppColors.text3Dark, fontSize: 9, letterSpacing: 0.6)),
          ],
        ),
      ),
    );
  }
}

class _DashBody extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Consumer<CrusherProvider>(
      builder: (_, provider, __) {
        final state = provider.state;
        return ListView(
          padding: const EdgeInsets.all(18),
          children: [
            // Alert banner
            if (state.alertCount > 0) ...[
              _AlertBanner(
                machineStatus: state.machineStatus,
                alertCount: state.alertCount,
              ),
              const SizedBox(height: 14),
            ],

            // Machine card
            const _SectionHeader(title: 'Machines', action: 'View All'),
            const SizedBox(height: 10),
            _MachineCard(state: state),
            const SizedBox(height: 18),

            // OEE
            OeeCard(
              availabilityPct: state.availabilityPct,
              timerRun: state.timerRun,
              timerStuck: state.timerStuck,
              timerNoFeed: state.timerNoFeed,
            ),
            const SizedBox(height: 18),

            // Shift info
            _ShiftCard(state: state),
            const SizedBox(height: 80),
          ],
        );
      },
    );
  }
}

class _AlertBanner extends StatelessWidget {
  final String machineStatus;
  final int alertCount;

  const _AlertBanner({required this.machineStatus, required this.alertCount});

  @override
  Widget build(BuildContext context) {
    final isStuck = machineStatus == 'STONE STUCK';
    final color = isStuck ? AppColors.red : AppColors.orange;
    final title = isStuck ? 'Stone Stuck!' : 'No Raw Material';
    final desc = '$alertCount active alert${alertCount > 1 ? 's' : ''}';

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withOpacity(0.3)),
      ),
      child: Row(
        children: [
          Container(
            width: 30, height: 30,
            decoration: BoxDecoration(
                color: color.withOpacity(0.15), borderRadius: BorderRadius.circular(9)),
            child: Icon(Icons.warning_rounded, color: color, size: 16),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title,
                    style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w700)),
                Text(desc,
                    style: TextStyle(color: color.withOpacity(0.7), fontSize: 11)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _MachineCard extends StatelessWidget {
  final dynamic state;

  const _MachineCard({required this.state});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surfaceDark,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.borderDark),
      ),
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 14, 14, 10),
            child: Row(
              children: [
                Container(
                  width: 64, height: 52,
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                        colors: [Color(0xFF2A2010), Color(0xFF1E1A08)],
                        begin: Alignment.topLeft, end: Alignment.bottomRight),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(Icons.precision_manufacturing_rounded,
                      color: AppColors.amber, size: 28),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Feeder – 1',
                          style: TextStyle(
                              color: AppColors.textDark, fontSize: 15, fontWeight: FontWeight.w600)),
                      const SizedBox(height: 3),
                      StatusChip(status: state.machineStatus),
                    ],
                  ),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text('${state.targetVfdHz} Hz',
                        style: const TextStyle(
                            color: AppColors.amber, fontSize: 16, fontWeight: FontWeight.w700)),
                    Text(state.jawLabel,
                        style: const TextStyle(color: AppColors.text2Dark, fontSize: 10)),
                  ],
                ),
              ],
            ),
          ),
          Container(
            height: 1, color: AppColors.borderDark,
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('Updated: ${state.statusSince}',
                    style: const TextStyle(color: AppColors.text3Dark, fontSize: 10)),
                Text('Run: ${state.timerRun}',
                    style: const TextStyle(color: AppColors.amberDark, fontSize: 11, fontWeight: FontWeight.w500)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ShiftCard extends StatelessWidget {
  final dynamic state;

  const _ShiftCard({required this.state});

  @override
  Widget build(BuildContext context) {
    final shift = state.shift;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surfaceDark,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.borderDark),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: AppColors.navy,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(shift.shift.toUpperCase() + ' SHIFT',
                    style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.w700, letterSpacing: 0.5)),
              ),
              const Spacer(),
              Text('Started: ${shift.start}',
                  style: const TextStyle(color: AppColors.text2Dark, fontSize: 11)),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              _ShiftMetric(label: 'Elapsed', value: '${shift.elapsedMinutes.toStringAsFixed(0)}m', color: AppColors.blue),
              const SizedBox(width: 10),
              _ShiftMetric(label: 'Availability', value: '${state.availabilityPct.toStringAsFixed(1)}%', color: AppColors.green),
            ],
          ),
        ],
      ),
    );
  }
}

class _ShiftMetric extends StatelessWidget {
  final String label;
  final String value;
  final Color color;

  const _ShiftMetric({required this.label, required this.value, required this.color});

  @override
  Widget build(BuildContext context) => Expanded(
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 10),
          decoration: BoxDecoration(
            color: AppColors.surface2Dark,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: AppColors.borderDark),
          ),
          child: Column(
            children: [
              Text(value,
                  style: TextStyle(color: color, fontSize: 15, fontWeight: FontWeight.w700)),
              const SizedBox(height: 2),
              Text(label,
                  style: const TextStyle(color: AppColors.text3Dark, fontSize: 9, letterSpacing: 0.5)),
            ],
          ),
        ),
      );
}

class _SectionHeader extends StatelessWidget {
  final String title;
  final String? action;

  const _SectionHeader({required this.title, this.action});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(title,
            style: const TextStyle(color: AppColors.textDark, fontSize: 14, fontWeight: FontWeight.w600)),
        if (action != null)
          Text(action!,
              style: const TextStyle(color: AppColors.amber, fontSize: 11, fontWeight: FontWeight.w500)),
      ],
    );
  }
}
