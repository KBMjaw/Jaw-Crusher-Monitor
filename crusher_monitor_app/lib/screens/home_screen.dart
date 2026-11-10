import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/crusher_provider.dart';
import '../theme/app_theme.dart';
import 'dashboard_screen.dart';
import 'machine_detail_screen.dart';
import 'camera_screen.dart';
import 'alerts_screen.dart';
import 'analytics_screen.dart';
import 'settings_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _idx = 0;

  static const _screens = [
    DashboardScreen(),
    MachineDetailScreen(),
    CameraScreen(),
    AlertsScreen(),
    AnalyticsScreen(),
  ];

  @override
  void initState() {
    super.initState();
    // Start WebSocket connection
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<CrusherProvider>().start();
    });
  }

  @override
  Widget build(BuildContext context) {
    final alertCount = context.select<CrusherProvider, int>((p) => p.state.alertCount);

    return Scaffold(
      body: IndexedStack(index: _idx, children: _screens),
      bottomNavigationBar: _BottomNav(
        current: _idx,
        alertCount: alertCount,
        onTap: (i) => setState(() => _idx = i),
        onSettings: () => Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => const SettingsScreen())),
      ),
    );
  }
}

class _BottomNav extends StatelessWidget {
  final int current;
  final int alertCount;
  final ValueChanged<int> onTap;
  final VoidCallback onSettings;

  const _BottomNav({
    required this.current,
    required this.alertCount,
    required this.onTap,
    required this.onSettings,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 72 + MediaQuery.of(context).padding.bottom,
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).padding.bottom),
      decoration: const BoxDecoration(
        color: AppColors.bgDark,
        border: Border(top: BorderSide(color: AppColors.borderDark)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: [
          _NavItem(icon: Icons.dashboard_rounded, label: 'Dashboard', idx: 0, current: current, onTap: onTap),
          _NavItem(icon: Icons.precision_manufacturing_rounded, label: 'Machine', idx: 1, current: current, onTap: onTap),
          _NavItem(icon: Icons.videocam_rounded, label: 'Camera', idx: 2, current: current, onTap: onTap),
          _NavItemBadge(
              icon: Icons.notifications_rounded,
              label: 'Alerts',
              idx: 3,
              current: current,
              badge: alertCount,
              onTap: onTap),
          _NavItem(icon: Icons.bar_chart_rounded, label: 'Analytics', idx: 4, current: current, onTap: onTap),
          _NavItemAction(icon: Icons.settings_rounded, label: 'Settings', onTap: onSettings),
        ],
      ),
    );
  }
}

class _NavItem extends StatelessWidget {
  final IconData icon;
  final String label;
  final int idx;
  final int current;
  final ValueChanged<int> onTap;

  const _NavItem({required this.icon, required this.label, required this.idx, required this.current, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final active = current == idx;
    return GestureDetector(
      onTap: () => onTap(idx),
      behavior: HitTestBehavior.opaque,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, color: active ? AppColors.amber : AppColors.text3Dark, size: 22),
          const SizedBox(height: 3),
          Text(label,
              style: TextStyle(
                  color: active ? AppColors.amber : AppColors.text3Dark,
                  fontSize: 10, fontWeight: FontWeight.w500)),
        ],
      ),
    );
  }
}

class _NavItemBadge extends StatelessWidget {
  final IconData icon;
  final String label;
  final int idx;
  final int current;
  final int badge;
  final ValueChanged<int> onTap;

  const _NavItemBadge({required this.icon, required this.label, required this.idx, required this.current, required this.badge, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final active = current == idx;
    return GestureDetector(
      onTap: () => onTap(idx),
      behavior: HitTestBehavior.opaque,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Stack(
            children: [
              Icon(icon, color: active ? AppColors.amber : AppColors.text3Dark, size: 22),
              if (badge > 0)
                Positioned(
                  top: 0, right: 0,
                  child: Container(
                    padding: const EdgeInsets.all(2),
                    decoration: const BoxDecoration(color: AppColors.red, shape: BoxShape.circle),
                    child: Text(badge > 9 ? '9+' : '$badge',
                        style: const TextStyle(color: Colors.white, fontSize: 8, fontWeight: FontWeight.w700)),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 3),
          Text(label,
              style: TextStyle(
                  color: active ? AppColors.amber : AppColors.text3Dark,
                  fontSize: 10, fontWeight: FontWeight.w500)),
        ],
      ),
    );
  }
}

class _NavItemAction extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  const _NavItemAction({required this.icon, required this.label, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, color: AppColors.text3Dark, size: 22),
          const SizedBox(height: 3),
          Text(label,
              style: const TextStyle(color: AppColors.text3Dark, fontSize: 10, fontWeight: FontWeight.w500)),
        ],
      ),
    );
  }
}
