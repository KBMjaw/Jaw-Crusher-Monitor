import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/crusher_provider.dart';
import '../theme/app_theme.dart';
import '../widgets/vfd_gauge_card.dart';
import '../widgets/timer_ring_card.dart';
import '../widgets/status_chip.dart';

class MachineDetailScreen extends StatelessWidget {
  const MachineDetailScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Consumer<CrusherProvider>(
        builder: (_, provider, __) {
          final state = provider.state;
          return CustomScrollView(
            slivers: [
              SliverAppBar(
                expandedHeight: 180,
                pinned: true,
                automaticallyImplyLeading: false,
                backgroundColor: AppColors.navy,
                flexibleSpace: FlexibleSpaceBar(
                  background: Container(
                    decoration: const BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                        colors: [Color(0xFF0D1635), Color(0xFF1A2B5E), Color(0xFF0D1635)],
                      ),
                    ),
                    child: SafeArea(
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(20, 8, 20, 0),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                const Text('Feeder – 1',
                                    style: TextStyle(
                                        color: Colors.white,
                                        fontSize: 20,
                                        fontWeight: FontWeight.w700)),
                                StatusChip(status: state.machineStatus),
                              ],
                            ),
                            const SizedBox(height: 4),
                            Text('Updated: ${state.statusSince}',
                                style: const TextStyle(color: Colors.white38, fontSize: 10)),
                            const Spacer(),
                            Row(
                              children: [
                                _HeroStat(label: 'VFD', value: '${state.targetVfdHz} Hz', color: AppColors.amberLight),
                                const SizedBox(width: 16),
                                _HeroStat(label: 'FPS', value: '${state.cameraFps.toStringAsFixed(1)}', color: AppColors.blue),
                                const SizedBox(width: 16),
                                _HeroStat(label: 'Shift', value: state.shift.shift.toUpperCase(), color: AppColors.text2Dark),
                              ],
                            ),
                            const SizedBox(height: 16),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),

              SliverPadding(
                padding: const EdgeInsets.all(18),
                sliver: SliverList(
                  delegate: SliverChildListDelegate([
                    // VFD gauge
                    VfdGaugeCard(
                      hz: state.targetVfdHz,
                      jawLabel: state.jawLabel,
                      machineStatus: state.machineStatus,
                    ),
                    const SizedBox(height: 16),

                    // Timer rings
                    Row(
                      children: [
                        Expanded(
                          child: TimerRingCard(
                            label: 'Jam Timer',
                            hmsValue: state.timerStuck,
                            ringColor: AppColors.orange,
                            thresholdSeconds: 15,
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: TimerRingCard(
                            label: 'Empty Timer',
                            hmsValue: state.timerNoFeed,
                            ringColor: AppColors.red,
                            thresholdSeconds: 30,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),

                    // Live parameters
                    _ParamsCard(state: state),
                    const SizedBox(height: 16),

                    // Shift timers
                    _ShiftTimersCard(state: state),
                    const SizedBox(height: 80),
                  ]),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _HeroStat extends StatelessWidget {
  final String label;
  final String value;
  final Color color;

  const _HeroStat({required this.label, required this.value, required this.color});

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(color: Colors.white38, fontSize: 10)),
          Text(value, style: TextStyle(color: color, fontSize: 15, fontWeight: FontWeight.w700)),
        ],
      );
}

class _ParamsCard extends StatelessWidget {
  final dynamic state;

  const _ParamsCard({required this.state});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surfaceDark,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.borderDark),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(18, 12, 18, 10),
            child: Text('Live Parameters',
                style: TextStyle(
                    color: AppColors.textDark, fontSize: 13, fontWeight: FontWeight.w700)),
          ),
          const Divider(height: 1, color: AppColors.borderDark),
          _ParamRow(key_: 'Fill status', value: state.jawLabel, colorClass: 'ok'),
          _ParamRow(key_: 'AI confidence', value: '${(state.jawConf * 100).toStringAsFixed(0)}%', colorClass: 'ok'),
          _ParamRow(key_: 'Machine status', value: state.machineStatus, colorClass: state.isNormal ? 'ok' : state.isStuck ? 'crit' : 'warn'),
          _ParamRow(key_: 'Camera status', value: state.camStatus, colorClass: state.camStatus == 'live' ? 'ok' : 'warn'),
          _ParamRow(key_: 'Shift', value: '${state.shift.shift.toUpperCase()} · Started ${state.shift.start}', colorClass: 'neutral'),
          _ParamRow(key_: 'Stream', value: 'RTSP/TCP · Channel 101', colorClass: 'neutral', last: true),
        ],
      ),
    );
  }
}

class _ParamRow extends StatelessWidget {
  final String key_;
  final String value;
  final String colorClass;
  final bool last;

  const _ParamRow({required this.key_, required this.value, required this.colorClass, this.last = false});

  @override
  Widget build(BuildContext context) {
    final color = switch (colorClass) {
      'ok' => AppColors.green,
      'crit' => AppColors.red,
      'warn' => AppColors.orange,
      _ => AppColors.blue,
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 11),
      decoration: BoxDecoration(
        border: last ? null : const Border(bottom: BorderSide(color: AppColors.borderDark)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(key_, style: const TextStyle(color: AppColors.text2Dark, fontSize: 12)),
          Text(value, style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w500, fontFamily: 'monospace')),
        ],
      ),
    );
  }
}

class _ShiftTimersCard extends StatelessWidget {
  final dynamic state;

  const _ShiftTimersCard({required this.state});

  @override
  Widget build(BuildContext context) {
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
          const Text('Shift Timers',
              style: TextStyle(color: AppColors.textDark, fontSize: 13, fontWeight: FontWeight.w700)),
          const SizedBox(height: 12),
          _TimerRow(label: 'Shift total', value: state.timerShift, color: AppColors.blue),
          _TimerRow(label: 'Running', value: state.timerRun, color: AppColors.green),
          _TimerRow(label: 'Stone stuck', value: state.timerStuck, color: AppColors.red),
          _TimerRow(label: 'No material', value: state.timerNoFeed, color: AppColors.orange),
          _TimerRow(label: 'Idle', value: state.timerIdle, color: AppColors.text2Dark, last: true),
        ],
      ),
    );
  }
}

class _TimerRow extends StatelessWidget {
  final String label;
  final String value;
  final Color color;
  final bool last;

  const _TimerRow({required this.label, required this.value, required this.color, this.last = false});

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(vertical: 8),
        decoration: BoxDecoration(
          border: last ? null : const Border(bottom: BorderSide(color: AppColors.borderDark)),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(label, style: const TextStyle(color: AppColors.text2Dark, fontSize: 12)),
            Text(value,
                style: TextStyle(
                    color: color, fontSize: 13, fontWeight: FontWeight.w600, fontFamily: 'monospace')),
          ],
        ),
      );
}
