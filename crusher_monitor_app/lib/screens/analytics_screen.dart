import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/crusher_provider.dart';
import '../theme/app_theme.dart';

class AnalyticsScreen extends StatefulWidget {
  const AnalyticsScreen({super.key});

  @override
  State<AnalyticsScreen> createState() => _AnalyticsScreenState();
}

class _AnalyticsScreenState extends State<AnalyticsScreen> {
  int _hoursFilter = 24;
  int _vfdMinutes = 60;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final p = context.read<CrusherProvider>();
    await Future.wait([
      p.loadOeeHistory(hours: _hoursFilter),
      p.loadVfdHistory(minutes: _vfdMinutes),
      p.loadShiftReports(),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Column(
        children: [
          _AnalyticsHero(
            hoursFilter: _hoursFilter,
            onPeriodChanged: (h) {
              setState(() => _hoursFilter = h);
              _load();
            },
          ),
          Expanded(child: _AnalyticsBody(hoursFilter: _hoursFilter)),
        ],
      ),
    );
  }
}

class _AnalyticsHero extends StatelessWidget {
  final int hoursFilter;
  final ValueChanged<int> onPeriodChanged;

  const _AnalyticsHero({required this.hoursFilter, required this.onPeriodChanged});

  @override
  Widget build(BuildContext context) {
    final avail = context.select<CrusherProvider, double>((p) => p.state.availabilityPct);

    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          colors: [Color(0xFF0D1635), Color(0xFF1A1E28)],
          begin: Alignment.topLeft, end: Alignment.bottomRight,
        ),
      ),
      padding: EdgeInsets.only(
        top: MediaQuery.of(context).padding.top + 16,
        left: 20, right: 20, bottom: 16,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('Analytics',
                  style: TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w700)),
              Text('${avail.toStringAsFixed(1)}% avail.',
                  style: const TextStyle(color: AppColors.amber, fontSize: 12, fontWeight: FontWeight.w600)),
            ],
          ),
          const SizedBox(height: 14),
          // Period tabs
          Container(
            decoration: BoxDecoration(
              color: AppColors.surface2Dark,
              borderRadius: BorderRadius.circular(10),
            ),
            padding: const EdgeInsets.all(3),
            child: Row(
              children: [
                _PeriodTab(label: '1h', hours: 1, current: hoursFilter, onTap: onPeriodChanged),
                _PeriodTab(label: '8h', hours: 8, current: hoursFilter, onTap: onPeriodChanged),
                _PeriodTab(label: '24h', hours: 24, current: hoursFilter, onTap: onPeriodChanged),
                _PeriodTab(label: '7d', hours: 168, current: hoursFilter, onTap: onPeriodChanged),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _PeriodTab extends StatelessWidget {
  final String label;
  final int hours;
  final int current;
  final ValueChanged<int> onTap;

  const _PeriodTab({required this.label, required this.hours, required this.current, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final active = current == hours;
    return Expanded(
      child: GestureDetector(
        onTap: () => onTap(hours),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: const EdgeInsets.symmetric(vertical: 7),
          decoration: BoxDecoration(
            color: active ? AppColors.surfaceDark : Colors.transparent,
            borderRadius: BorderRadius.circular(8),
          ),
          child: Text(label,
              textAlign: TextAlign.center,
              style: TextStyle(
                  color: active ? AppColors.amber : AppColors.text3Dark,
                  fontSize: 11, fontWeight: FontWeight.w600)),
        ),
      ),
    );
  }
}

class _AnalyticsBody extends StatelessWidget {
  final int hoursFilter;

  const _AnalyticsBody({required this.hoursFilter});

  @override
  Widget build(BuildContext context) {
    return Consumer<CrusherProvider>(
      builder: (_, provider, __) {
        final state = provider.state;
        final oeeHistory = provider.oeeHistory;
        final vfdHistory = provider.vfdHistory;
        final shiftReports = provider.shiftReports;

        return ListView(
          padding: const EdgeInsets.fromLTRB(18, 14, 18, 90),
          children: [
            // OEE summary card
            _OeeSummaryCard(
              availabilityPct: state.availabilityPct,
              timerRun: state.timerRun,
              timerStuck: state.timerStuck,
              timerNoFeed: state.timerNoFeed,
              tonnage: state.tonnageActual,
            ),
            const SizedBox(height: 14),

            // OEE history chart
            if (oeeHistory.isNotEmpty) ...[
              _ChartCard(
                title: 'Availability % (last ${hoursFilter}h)',
                child: _OeeLineChart(data: oeeHistory),
              ),
              const SizedBox(height: 14),
            ],

            // VFD history chart
            if (vfdHistory.isNotEmpty) ...[
              _ChartCard(
                title: 'VFD Frequency Hz (last ${hoursFilter == 1 ? 60 : hoursFilter * 60} min)',
                child: _VfdBarChart(data: vfdHistory),
              ),
              const SizedBox(height: 14),
            ],

            // State distribution
            _StateDistCard(
              framesRunning: state.framesRunning,
              framesStuck: state.framesStuck,
              framesNoFeed: state.framesNoFeed,
              frameCount: state.frameCount,
            ),
            const SizedBox(height: 14),

            // Shift reports table
            if (shiftReports.isNotEmpty) ...[
              _ShiftReportsCard(reports: shiftReports),
              const SizedBox(height: 14),
            ],
          ],
        );
      },
    );
  }
}

class _OeeSummaryCard extends StatelessWidget {
  final double availabilityPct;
  final String timerRun;
  final String timerStuck;
  final String timerNoFeed;
  final double tonnage;

  const _OeeSummaryCard({
    required this.availabilityPct,
    required this.timerRun,
    required this.timerStuck,
    required this.timerNoFeed,
    required this.tonnage,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: AppColors.surfaceDark,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.borderDark),
      ),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('AVAILABILITY', style: TextStyle(color: AppColors.text3Dark, fontSize: 10, letterSpacing: 0.8)),
                  const SizedBox(height: 4),
                  Text('${availabilityPct.toStringAsFixed(1)}%',
                      style: TextStyle(
                          color: availabilityPct >= 80 ? AppColors.green : AppColors.orange,
                          fontSize: 32, fontWeight: FontWeight.w700)),
                ],
              ),
              // Mini ring
              SizedBox(
                width: 72, height: 72,
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    CircularProgressIndicator(
                      value: availabilityPct / 100,
                      backgroundColor: AppColors.surface3Dark,
                      color: AppColors.amber,
                      strokeWidth: 6,
                    ),
                    Text('${availabilityPct.toStringAsFixed(0)}%',
                        style: const TextStyle(color: AppColors.amber, fontSize: 14, fontWeight: FontWeight.w700)),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              _SubMetric(label: 'Run Time', value: timerRun, color: AppColors.green),
              const SizedBox(width: 8),
              _SubMetric(label: 'Stuck', value: timerStuck, color: AppColors.red),
              const SizedBox(width: 8),
              _SubMetric(label: 'No Feed', value: timerNoFeed, color: AppColors.orange),
            ],
          ),
        ],
      ),
    );
  }
}

class _SubMetric extends StatelessWidget {
  final String label;
  final String value;
  final Color color;

  const _SubMetric({required this.label, required this.value, required this.color});

  @override
  Widget build(BuildContext context) => Expanded(
        child: Column(
          children: [
            Text(value, style: TextStyle(color: color, fontSize: 13, fontWeight: FontWeight.w700)),
            const SizedBox(height: 2),
            Text(label, style: const TextStyle(color: AppColors.text3Dark, fontSize: 9, letterSpacing: 0.5)),
            const SizedBox(height: 6),
            Container(height: 3,
                decoration: BoxDecoration(color: color.withOpacity(0.3), borderRadius: BorderRadius.circular(3))),
          ],
        ),
      );
}

class _ChartCard extends StatelessWidget {
  final String title;
  final Widget child;

  const _ChartCard({required this.title, required this.child});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surfaceDark,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.borderDark),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: const TextStyle(color: AppColors.textDark, fontSize: 12, fontWeight: FontWeight.w700)),
          const SizedBox(height: 14),
          SizedBox(height: 120, child: child),
        ],
      ),
    );
  }
}

class _OeeLineChart extends StatelessWidget {
  final List<Map<String, dynamic>> data;

  const _OeeLineChart({required this.data});

  @override
  Widget build(BuildContext context) {
    final spots = data.asMap().entries.map((e) {
      final avail = (e.value['availability_pct'] as num?)?.toDouble() ?? 0;
      return FlSpot(e.key.toDouble(), avail);
    }).toList();

    return LineChart(
      LineChartData(
        gridData: FlGridData(
          show: true,
          drawVerticalLine: false,
          getDrawingHorizontalLine: (_) => const FlLine(color: AppColors.borderDark, strokeWidth: 1),
        ),
        titlesData: FlTitlesData(
          leftTitles: AxisTitles(
            sideTitles: SideTitles(
              showTitles: true,
              reservedSize: 32,
              getTitlesWidget: (v, _) => Text('${v.toInt()}%',
                  style: const TextStyle(color: AppColors.text3Dark, fontSize: 9)),
            ),
          ),
          bottomTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
          rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
          topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
        ),
        borderData: FlBorderData(show: false),
        minY: 0, maxY: 100,
        lineBarsData: [
          LineChartBarData(
            spots: spots,
            isCurved: true,
            color: AppColors.amber,
            barWidth: 2,
            dotData: const FlDotData(show: false),
            belowBarData: BarAreaData(
              show: true,
              color: AppColors.amber.withOpacity(0.1),
            ),
          ),
        ],
      ),
    );
  }
}

class _VfdBarChart extends StatelessWidget {
  final List<Map<String, dynamic>> data;

  const _VfdBarChart({required this.data});

  @override
  Widget build(BuildContext context) {
    // Take last 20 samples for readability
    final samples = data.take(20).toList().reversed.toList();
    final groups = samples.asMap().entries.map((e) {
      final hz = (e.value['vfd_hz'] as num?)?.toDouble() ?? 0;
      return BarChartGroupData(
        x: e.key,
        barRods: [
          BarChartRodData(
            toY: hz,
            color: _hzColor(hz.toInt()),
            width: 8,
            borderRadius: BorderRadius.circular(4),
          ),
        ],
      );
    }).toList();

    return BarChart(
      BarChartData(
        gridData: const FlGridData(show: false),
        titlesData: FlTitlesData(
          leftTitles: AxisTitles(
            sideTitles: SideTitles(
              showTitles: true,
              reservedSize: 28,
              getTitlesWidget: (v, _) => Text('${v.toInt()}Hz',
                  style: const TextStyle(color: AppColors.text3Dark, fontSize: 9)),
            ),
          ),
          bottomTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
          rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
          topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
        ),
        borderData: FlBorderData(show: false),
        maxY: 55,
        barGroups: groups,
      ),
    );
  }

  Color _hzColor(int hz) {
    if (hz == 20) return AppColors.green;
    if (hz == 37) return AppColors.orange;
    if (hz >= 50) return AppColors.red;
    return AppColors.text3Dark;
  }
}

class _StateDistCard extends StatelessWidget {
  final int framesRunning;
  final int framesStuck;
  final int framesNoFeed;
  final int frameCount;

  const _StateDistCard({
    required this.framesRunning,
    required this.framesStuck,
    required this.framesNoFeed,
    required this.frameCount,
  });

  @override
  Widget build(BuildContext context) {
    final total = frameCount > 0 ? frameCount.toDouble() : 1;
    final runPct = framesRunning / total * 100;
    final stuckPct = framesStuck / total * 100;
    final noFeedPct = framesNoFeed / total * 100;

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
          const Text('State Distribution (this shift)',
              style: TextStyle(color: AppColors.textDark, fontSize: 13, fontWeight: FontWeight.w700)),
          const SizedBox(height: 14),
          _DistBar(label: 'Running', pct: runPct, color: AppColors.green, frames: framesRunning),
          const SizedBox(height: 8),
          _DistBar(label: 'Stone Stuck', pct: stuckPct, color: AppColors.red, frames: framesStuck),
          const SizedBox(height: 8),
          _DistBar(label: 'No Material', pct: noFeedPct, color: AppColors.orange, frames: framesNoFeed),
        ],
      ),
    );
  }
}

class _DistBar extends StatelessWidget {
  final String label;
  final double pct;
  final Color color;
  final int frames;

  const _DistBar({required this.label, required this.pct, required this.color, required this.frames});

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(label, style: const TextStyle(color: AppColors.text2Dark, fontSize: 12)),
              Text('${pct.toStringAsFixed(1)}% ($frames frames)',
                  style: const TextStyle(color: AppColors.text3Dark, fontSize: 10)),
            ],
          ),
          const SizedBox(height: 4),
          ClipRRect(
            borderRadius: BorderRadius.circular(3),
            child: LinearProgressIndicator(
              value: (pct / 100).clamp(0.0, 1.0),
              minHeight: 5,
              backgroundColor: AppColors.surface3Dark,
              valueColor: AlwaysStoppedAnimation(color),
            ),
          ),
        ],
      );
}

class _ShiftReportsCard extends StatelessWidget {
  final List<Map<String, dynamic>> reports;

  const _ShiftReportsCard({required this.reports});

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
            padding: EdgeInsets.fromLTRB(16, 14, 16, 10),
            child: Text('Recent Shift Reports',
                style: TextStyle(color: AppColors.textDark, fontSize: 13, fontWeight: FontWeight.w700)),
          ),
          const Divider(height: 1, color: AppColors.borderDark),
          ...reports.take(5).map((r) => _ShiftRow(report: r)),
        ],
      ),
    );
  }
}

class _ShiftRow extends StatelessWidget {
  final Map<String, dynamic> report;

  const _ShiftRow({required this.report});

  @override
  Widget build(BuildContext context) {
    final avail = (report['availability_pct'] as num?)?.toDouble() ?? 0;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: AppColors.borderDark)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('${(report['shift_type'] as String? ?? 'day').toUpperCase()} · ${report['shift_start'] ?? '--'}',
                    style: const TextStyle(color: AppColors.textDark, fontSize: 12, fontWeight: FontWeight.w600)),
                const SizedBox(height: 2),
                Text(report['timestamp'] as String? ?? '',
                    style: const TextStyle(color: AppColors.text3Dark, fontSize: 10)),
              ],
            ),
          ),
          Text('${avail.toStringAsFixed(1)}%',
              style: TextStyle(
                  color: avail >= 80 ? AppColors.green : AppColors.orange,
                  fontSize: 14, fontWeight: FontWeight.w700)),
          const SizedBox(width: 8),
          Text('${(report['tonnage_actual'] as num?)?.toStringAsFixed(1) ?? '0'} t',
              style: const TextStyle(color: AppColors.blue, fontSize: 12)),
        ],
      ),
    );
  }
}
