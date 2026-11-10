import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/crusher_state.dart';
import '../providers/crusher_provider.dart';
import '../theme/app_theme.dart';

class AlertsScreen extends StatefulWidget {
  const AlertsScreen({super.key});

  @override
  State<AlertsScreen> createState() => _AlertsScreenState();
}

class _AlertsScreenState extends State<AlertsScreen> {
  String _filter = 'all';
  final _acked = <String>{};

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<CrusherProvider>().loadAlertHistory();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Column(
        children: [
          _AlertsHero(filter: _filter, onFilter: (f) => setState(() => _filter = f)),
          Expanded(child: _AlertsBody(filter: _filter, acked: _acked, onAck: (id) => setState(() => _acked.add(id)))),
        ],
      ),
    );
  }
}

class _AlertsHero extends StatelessWidget {
  final String filter;
  final ValueChanged<String> onFilter;

  const _AlertsHero({required this.filter, required this.onFilter});

  @override
  Widget build(BuildContext context) {
    final alertCount = context.select<CrusherProvider, int>((p) => p.state.alertCount);

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
          const Text('Alerts',
              style: TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w700, letterSpacing: 0.5)),
          const SizedBox(height: 2),
          Text('$alertCount active alert${alertCount != 1 ? 's' : ''}',
              style: const TextStyle(color: Colors.white45, fontSize: 12)),
          const SizedBox(height: 14),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                _Tab(label: 'All', value: 'all', current: filter, onTap: onFilter),
                const SizedBox(width: 8),
                _Tab(label: 'Critical', value: 'critical', current: filter, onTap: onFilter),
                const SizedBox(width: 8),
                _Tab(label: 'Warning', value: 'warning', current: filter, onTap: onFilter),
                const SizedBox(width: 8),
                _Tab(label: 'Info', value: 'info', current: filter, onTap: onFilter),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Tab extends StatelessWidget {
  final String label;
  final String value;
  final String current;
  final ValueChanged<String> onTap;

  const _Tab({required this.label, required this.value, required this.current, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final active = current == value;
    return GestureDetector(
      onTap: () => onTap(value),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
        decoration: BoxDecoration(
          color: active ? AppColors.amber : Colors.transparent,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
              color: active ? AppColors.amber : Colors.white.withOpacity(0.15)),
        ),
        child: Text(label,
            style: TextStyle(
                color: active ? Colors.black : Colors.white54,
                fontSize: 11, fontWeight: FontWeight.w500)),
      ),
    );
  }
}

class _AlertsBody extends StatelessWidget {
  final String filter;
  final Set<String> acked;
  final ValueChanged<String> onAck;

  const _AlertsBody({required this.filter, required this.acked, required this.onAck});

  @override
  Widget build(BuildContext context) {
    return Consumer<CrusherProvider>(
      builder: (_, provider, __) {
        // Combine live active alerts + DB history
        final live = provider.state.activeAlerts;
        final history = provider.alertHistory;

        // Build unified list from live alerts
        final liveItems = live.map((a) => _AlertItem(
              id: a.id,
              title: _titleFor(a.level),
              desc: a.message,
              level: a.level,
              timestamp: a.timestamp,
              isLive: true,
            ));

        // DB history items
        final historyItems = history.map((h) => _AlertItem(
              id: h['alert_id']?.toString() ?? '',
              title: _titleFor(h['level']?.toString() ?? 'info'),
              desc: h['message']?.toString() ?? '',
              level: h['level']?.toString() ?? 'info',
              timestamp: h['timestamp']?.toString() ?? '',
              isLive: false,
            ));

        var items = [...liveItems, ...historyItems];

        if (filter != 'all') {
          items = items.where((i) => i.level == filter).toList();
        }

        if (items.isEmpty) {
          return Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.notifications_off_rounded, color: AppColors.text3Dark, size: 48),
                const SizedBox(height: 12),
                Text('No ${filter == 'all' ? '' : filter} alerts',
                    style: const TextStyle(color: AppColors.text3Dark, fontSize: 13)),
              ],
            ),
          );
        }

        return ListView.separated(
          padding: const EdgeInsets.fromLTRB(18, 14, 18, 90),
          itemCount: items.length,
          separatorBuilder: (_, __) => const SizedBox(height: 10),
          itemBuilder: (_, i) {
            final item = items[i];
            final isAcked = acked.contains(item.id);
            return _AlertCard(item: item, isAcked: isAcked, onAck: () => onAck(item.id));
          },
        );
      },
    );
  }

  String _titleFor(String level) => switch (level) {
        'critical' => 'Critical Alert',
        'warning' => 'Warning',
        _ => 'Information',
      };
}

class _AlertItem {
  final String id;
  final String title;
  final String desc;
  final String level;
  final String timestamp;
  final bool isLive;

  const _AlertItem({
    required this.id,
    required this.title,
    required this.desc,
    required this.level,
    required this.timestamp,
    required this.isLive,
  });
}

class _AlertCard extends StatelessWidget {
  final _AlertItem item;
  final bool isAcked;
  final VoidCallback onAck;

  const _AlertCard({required this.item, required this.isAcked, required this.onAck});

  @override
  Widget build(BuildContext context) {
    final (iconColor, bgColor) = switch (item.level) {
      'critical' => (AppColors.red, const Color(0x26E03A3A)),
      'warning' => (AppColors.orange, const Color(0x26F07C20)),
      _ => (AppColors.green, const Color(0x261DB97A)),
    };

    return Opacity(
      opacity: isAcked ? 0.55 : 1.0,
      child: Container(
        padding: const EdgeInsets.all(13),
        decoration: BoxDecoration(
          color: AppColors.surfaceDark,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.borderDark),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 34, height: 34,
              decoration: BoxDecoration(color: bgColor, borderRadius: BorderRadius.circular(10)),
              child: Icon(
                item.level == 'critical' ? Icons.warning_rounded : item.level == 'warning' ? Icons.info_rounded : Icons.check_circle_rounded,
                color: iconColor, size: 18),
            ),
            const SizedBox(width: 11),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(item.title,
                            style: const TextStyle(
                                color: AppColors.textDark, fontSize: 13, fontWeight: FontWeight.w700)),
                      ),
                      if (item.isLive)
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: AppColors.red.withOpacity(0.15),
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: const Text('LIVE', style: TextStyle(color: AppColors.red, fontSize: 8, fontWeight: FontWeight.w700)),
                        ),
                    ],
                  ),
                  const SizedBox(height: 2),
                  Text(item.desc,
                      style: const TextStyle(color: AppColors.text2Dark, fontSize: 11, height: 1.4)),
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      Text(item.timestamp,
                          style: const TextStyle(color: AppColors.text3Dark, fontSize: 10, fontFamily: 'monospace')),
                      const SizedBox(width: 8),
                      _SevChip(level: item.level),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            GestureDetector(
              onTap: isAcked ? null : onAck,
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 200),
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                decoration: BoxDecoration(
                  color: isAcked
                      ? AppColors.green.withOpacity(0.1)
                      : AppColors.surface2Dark,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(
                    color: isAcked ? AppColors.green.withOpacity(0.2) : AppColors.borderDark),
                ),
                child: Text(
                  isAcked ? '✓ Acked' : 'ACK',
                  style: TextStyle(
                      color: isAcked ? AppColors.green : AppColors.text2Dark,
                      fontSize: 10, fontWeight: FontWeight.w600)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SevChip extends StatelessWidget {
  final String level;
  const _SevChip({required this.level});

  @override
  Widget build(BuildContext context) {
    final (color, label) = switch (level) {
      'critical' => (AppColors.red, 'Critical'),
      'warning' => (AppColors.orange, 'Warning'),
      _ => (AppColors.green, 'Info'),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: color.withOpacity(0.15),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(label, style: TextStyle(color: color, fontSize: 9, fontWeight: FontWeight.w700, letterSpacing: 0.5)),
    );
  }
}
