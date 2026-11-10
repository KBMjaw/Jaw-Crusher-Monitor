import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../config/app_config.dart';
import '../providers/crusher_provider.dart';
import '../services/auth_service.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import 'login_screen.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  late final TextEditingController _ipCtrl;

  @override
  void initState() {
    super.initState();
    _ipCtrl = TextEditingController(text: AppConfig.piBase);
  }

  @override
  void dispose() { _ipCtrl.dispose(); super.dispose(); }

  Future<void> _saveIp() async {
    await AppConfig.setPiBase(_ipCtrl.text.trim());
    if (!mounted) return;
    context.read<CrusherProvider>().reconnect();
    ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Pi address saved. Reconnecting...')));
  }

  Future<void> _logout() async {
    await AuthService.logout();
    if (!mounted) return;
    Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => const LoginScreen()), (_) => false);
  }

  Future<void> _resetShift() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: AppColors.surfaceDark,
        title: const Text('Reset Shift?', style: TextStyle(color: Colors.white)),
        content: const Text('This will save the current shift report and reset all timers and tonnage.',
            style: TextStyle(color: AppColors.text2Dark)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          ElevatedButton(onPressed: () => Navigator.pop(context, true), child: const Text('Reset')),
        ],
      ),
    );
    if (confirmed == true) {
      await ApiService.resetShift();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Shift reset and report saved')));
    }
  }

  Future<void> _addTonnage() async {
    double? tonnes;
    await showDialog(
      context: context,
      builder: (_) {
        final ctrl = TextEditingController();
        return AlertDialog(
          backgroundColor: AppColors.surfaceDark,
          title: const Text('Add Tonnage', style: TextStyle(color: Colors.white)),
          content: TextField(
            controller: ctrl,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            style: const TextStyle(color: Colors.white),
            decoration: const InputDecoration(
              hintText: 'Enter tonnes (e.g. 5.5)',
              suffixText: 't',
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
            ElevatedButton(
              onPressed: () {
                tonnes = double.tryParse(ctrl.text);
                Navigator.pop(context);
              },
              child: const Text('Add'),
            ),
          ],
        );
      },
    );
    if (tonnes != null && tonnes! > 0) {
      await ApiService.addTonnage(tonnes!);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Added ${tonnes!.toStringAsFixed(2)} t')));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Column(
        children: [
          _SettingsHero(onLogout: _logout),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(18, 16, 18, 90),
              children: [
                // Profile card
                _ProfileCard(onLogout: _logout),
                const SizedBox(height: 20),

                // Connection
                _SectionLabel(label: 'Connection'),
                _SettingsGroup(children: [
                  _SettingItem(
                    icon: Icons.router_rounded,
                    iconBg: const Color(0x202F7DEB),
                    iconColor: AppColors.blue,
                    title: 'Pi IP Address',
                    sub: AppConfig.piBase,
                    onTap: () => _showIpDialog(),
                  ),
                  _SettingItem(
                    icon: Icons.refresh_rounded,
                    iconBg: const Color(0x201DB97A),
                    iconColor: AppColors.green,
                    title: 'Reconnect WebSocket',
                    sub: 'Force reconnect to Pi',
                    onTap: () {
                      context.read<CrusherProvider>().reconnect();
                      ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('Reconnecting...')));
                    },
                  ),
                ]),
                const SizedBox(height: 20),

                // Camera
                _SectionLabel(label: 'Camera'),
                _SettingsGroup(children: [
                  _SettingItem(
                    icon: Icons.videocam_rounded,
                    iconBg: const Color(0x20F5A623),
                    iconColor: AppColors.amber,
                    title: 'Restart Camera',
                    sub: 'Reinitialize RTSP connection',
                    onTap: () async {
                      await ApiService.restartCamera();
                      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('Camera restart initiated')));
                    },
                  ),
                ]),
                const SizedBox(height: 20),

                // Operations
                _SectionLabel(label: 'Operations'),
                _SettingsGroup(children: [
                  _SettingItem(
                    icon: Icons.add_chart_rounded,
                    iconBg: const Color(0x202F7DEB),
                    iconColor: AppColors.blue,
                    title: 'Add Tonnage',
                    sub: 'Log additional tonnage manually',
                    onTap: _addTonnage,
                  ),
                  _SettingItem(
                    icon: Icons.restart_alt_rounded,
                    iconBg: const Color(0x20F07C20),
                    iconColor: AppColors.orange,
                    title: 'Reset Shift',
                    sub: 'Save report and reset all shift timers',
                    onTap: _resetShift,
                  ),
                ]),
                const SizedBox(height: 20),

                // About
                _SectionLabel(label: 'About'),
                _SettingsGroup(children: [
                  _SettingItem(
                    icon: Icons.info_rounded,
                    iconBg: const Color(0x207C3AED),
                    iconColor: AppColors.purple,
                    title: 'Version',
                    sub: 'v1.0.0 · Build 2025',
                    value: 'v1.0.0',
                  ),
                  _SettingItem(
                    icon: Icons.factory_rounded,
                    iconBg: const Color(0x20F5A623),
                    iconColor: AppColors.amber,
                    title: 'Plant',
                    sub: 'Kannan Blue Metals · Chennimalai, Erode',
                  ),
                ]),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _showIpDialog() async {
    await showDialog(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: AppColors.surfaceDark,
        title: const Text('Pi IP Address', style: TextStyle(color: Colors.white)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: _ipCtrl,
              style: const TextStyle(color: Colors.white, fontFamily: 'monospace', fontSize: 13),
              decoration: const InputDecoration(hintText: 'http://192.168.0.124:8000'),
            ),
            const SizedBox(height: 8),
            const Text('Include http:// and port number',
                style: TextStyle(color: AppColors.text3Dark, fontSize: 11)),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () async { await _saveIp(); if (context.mounted) Navigator.pop(context); },
            child: const Text('Save'),
          ),
        ],
      ),
    );
    setState(() {}); // refresh sub text
  }
}

class _SettingsHero extends StatelessWidget {
  final VoidCallback onLogout;

  const _SettingsHero({required this.onLogout});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          colors: [Color(0xFF0D1635), Color(0xFF1A1E28)],
          begin: Alignment.topLeft, end: Alignment.bottomRight,
        ),
      ),
      padding: EdgeInsets.only(
        top: MediaQuery.of(context).padding.top + 16,
        left: 20, right: 20, bottom: 20,
      ),
      child: Row(
        children: [
          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Settings', style: TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w700)),
                Text('App configuration & controls', style: TextStyle(color: Colors.white45, fontSize: 12)),
              ],
            ),
          ),
          IconButton(
            icon: const Icon(Icons.close_rounded, color: Colors.white54),
            onPressed: () => Navigator.of(context).pop(),
          ),
        ],
      ),
    );
  }
}

class _ProfileCard extends StatelessWidget {
  final VoidCallback onLogout;

  const _ProfileCard({required this.onLogout});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: const LinearGradient(colors: [AppColors.navy, AppColors.navyLight]),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white.withOpacity(0.08)),
      ),
      child: Row(
        children: [
          Container(
            width: 52, height: 52,
            decoration: BoxDecoration(color: AppColors.amber, borderRadius: BorderRadius.circular(16)),
            child: const Center(child: Text('KM', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w700))),
          ),
          const SizedBox(width: 14),
          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Plant Manager', style: TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.w700)),
                Text('Kannan Blue Metals', style: TextStyle(color: Colors.white54, fontSize: 11)),
                Text('Chennimalai, Erode', style: TextStyle(color: AppColors.amberLight, fontSize: 11)),
              ],
            ),
          ),
          GestureDetector(
            onTap: onLogout,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
              decoration: BoxDecoration(
                color: AppColors.red.withOpacity(0.15),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: AppColors.red.withOpacity(0.25)),
              ),
              child: const Text('Logout',
                  style: TextStyle(color: AppColors.red, fontSize: 11, fontWeight: FontWeight.w600)),
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  final String label;
  const _SectionLabel({required this.label});

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 8, left: 4),
        child: Text(label.toUpperCase(),
            style: const TextStyle(color: AppColors.text3Dark, fontSize: 10, fontWeight: FontWeight.w700, letterSpacing: 1)),
      );
}

class _SettingsGroup extends StatelessWidget {
  final List<Widget> children;
  const _SettingsGroup({required this.children});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surfaceDark,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.borderDark),
      ),
      child: Column(children: children),
    );
  }
}

class _SettingItem extends StatelessWidget {
  final IconData icon;
  final Color iconBg;
  final Color iconColor;
  final String title;
  final String sub;
  final String? value;
  final VoidCallback? onTap;

  const _SettingItem({
    required this.icon,
    required this.iconBg,
    required this.iconColor,
    required this.title,
    required this.sub,
    this.value,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 13),
        decoration: const BoxDecoration(
          border: Border(bottom: BorderSide(color: AppColors.borderDark)),
        ),
        child: Row(
          children: [
            Container(
              width: 34, height: 34,
              decoration: BoxDecoration(color: iconBg, borderRadius: BorderRadius.circular(10)),
              child: Icon(icon, color: iconColor, size: 17),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: const TextStyle(color: AppColors.textDark, fontSize: 13)),
                  Text(sub, style: const TextStyle(color: AppColors.text3Dark, fontSize: 11)),
                ],
              ),
            ),
            if (value != null)
              Text(value!, style: const TextStyle(color: AppColors.amber, fontSize: 12, fontWeight: FontWeight.w700, fontFamily: 'monospace'))
            else if (onTap != null)
              const Icon(Icons.chevron_right_rounded, color: AppColors.text3Dark, size: 18),
          ],
        ),
      ),
    );
  }
}
