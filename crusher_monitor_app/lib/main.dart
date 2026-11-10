import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import 'config/app_config.dart';
import 'providers/crusher_provider.dart';
import 'screens/login_screen.dart';
import 'screens/home_screen.dart';
import 'services/auth_service.dart';
import 'theme/app_theme.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Lock to portrait
  await SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);

  // Set status bar style
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: Colors.transparent,
    statusBarIconBrightness: Brightness.light,
  ));

  await AppConfig.init();

  runApp(const CrusherApp());
}

class CrusherApp extends StatelessWidget {
  const CrusherApp({super.key});

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider(
      create: (_) => CrusherProvider(),
      child: MaterialApp(
        title: 'Crusher Monitor',
        debugShowCheckedModeBanner: false,
        theme: buildDarkTheme(),
        home: const _Splash(),
      ),
    );
  }
}

class _Splash extends StatefulWidget {
  const _Splash();

  @override
  State<_Splash> createState() => _SplashState();
}

class _SplashState extends State<_Splash> {
  @override
  void initState() {
    super.initState();
    _check();
  }

  Future<void> _check() async {
    await Future.delayed(const Duration(milliseconds: 600));
    if (!mounted) return;
    final loggedIn = await AuthService.isLoggedIn();
    if (!mounted) return;
    Navigator.of(context).pushReplacement(MaterialPageRoute(
      builder: (_) => loggedIn ? const HomeScreen() : const LoginScreen(),
    ));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bgDark,
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 80, height: 80,
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                    colors: [AppColors.amber, AppColors.amberDark],
                    begin: Alignment.topLeft, end: Alignment.bottomRight),
                borderRadius: BorderRadius.circular(24),
                boxShadow: const [BoxShadow(color: Color(0x66F5A623), blurRadius: 40)],
              ),
              child: const Icon(Icons.factory_rounded, color: Colors.white, size: 40),
            ),
            const SizedBox(height: 20),
            const Text('Crusher Monitor',
                style: TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            const Text('Kannan Blue Metals',
                style: TextStyle(color: AppColors.amber, fontSize: 13)),
            const SizedBox(height: 40),
            const CircularProgressIndicator(color: AppColors.amber, strokeWidth: 2),
          ],
        ),
      ),
    );
  }
}
