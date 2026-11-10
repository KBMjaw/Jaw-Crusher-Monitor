import 'package:flutter/material.dart';
import '../services/auth_service.dart';
import '../theme/app_theme.dart';
import 'home_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _userCtrl = TextEditingController();
  final _passCtrl = TextEditingController();
  bool _obscure = true;
  bool _remember = false;
  bool _loading = false;
  String? _errorMsg;

  @override
  void initState() {
    super.initState();
    _prefillRemembered();
  }

  Future<void> _prefillRemembered() async {
    final user = await AuthService.rememberedUser();
    if (user != null && mounted) {
      setState(() {
        _userCtrl.text = user;
        _remember = true;
      });
    }
  }

  Future<void> _handleLogin() async {
    final user = _userCtrl.text.trim();
    final pass = _passCtrl.text;

    if (user.isEmpty || pass.isEmpty) {
      setState(() => _errorMsg = 'Username and password are required');
      return;
    }

    setState(() { _loading = true; _errorMsg = null; });

    await Future.delayed(const Duration(milliseconds: 400));
    final ok = await AuthService.login(user, pass, remember: _remember);

    if (!mounted) return;
    if (ok) {
      Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => const HomeScreen()));
    } else {
      setState(() {
        _loading = false;
        _errorMsg = 'Invalid username or password';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF070A10),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 28),
          child: Column(
            children: [
              const Spacer(flex: 2),
              // Logo
              Container(
                width: 64, height: 64,
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                      colors: [AppColors.amber, AppColors.amberDark],
                      begin: Alignment.topLeft, end: Alignment.bottomRight),
                  borderRadius: BorderRadius.circular(20),
                  boxShadow: const [BoxShadow(color: Color(0x66F5A623), blurRadius: 32)],
                ),
                child: const Icon(Icons.factory_rounded, color: Colors.white, size: 32),
              ),
              const SizedBox(height: 16),
              const Text('Crusher Monitor',
                  style: TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w700)),
              const SizedBox(height: 4),
              const Text('Kannan Blue Metals · Chennimalai, Erode',
                  style: TextStyle(color: AppColors.amber, fontSize: 11)),
              const Spacer(flex: 3),

              // Card
              Container(
                padding: const EdgeInsets.all(22),
                decoration: BoxDecoration(
                  color: const Color(0xF2161A22),
                  borderRadius: BorderRadius.circular(24),
                  border: Border.all(color: Colors.white.withOpacity(0.08)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Welcome back',
                        style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w700)),
                    const SizedBox(height: 2),
                    const Text('Sign in to your plant account',
                        style: TextStyle(color: AppColors.text2Dark, fontSize: 12)),
                    const SizedBox(height: 22),

                    // Username
                    const Text('USERNAME',
                        style: TextStyle(color: AppColors.text3Dark, fontSize: 10, letterSpacing: 0.8, fontWeight: FontWeight.w600)),
                    const SizedBox(height: 6),
                    TextField(
                      controller: _userCtrl,
                      style: const TextStyle(color: Colors.white, fontSize: 14),
                      decoration: InputDecoration(
                        hintText: 'Enter username',
                        suffixIcon: const Icon(Icons.person_outline, color: AppColors.text3Dark, size: 18),
                        errorText: null,
                      ),
                      textInputAction: TextInputAction.next,
                    ),
                    const SizedBox(height: 14),

                    // Password
                    const Text('PASSWORD',
                        style: TextStyle(color: AppColors.text3Dark, fontSize: 10, letterSpacing: 0.8, fontWeight: FontWeight.w600)),
                    const SizedBox(height: 6),
                    TextField(
                      controller: _passCtrl,
                      obscureText: _obscure,
                      style: const TextStyle(color: Colors.white, fontSize: 14),
                      decoration: InputDecoration(
                        hintText: 'Enter password',
                        suffixIcon: GestureDetector(
                          onTap: () => setState(() => _obscure = !_obscure),
                          child: Icon(
                            _obscure ? Icons.visibility_off_outlined : Icons.visibility_outlined,
                            color: AppColors.text3Dark, size: 18),
                        ),
                      ),
                      onSubmitted: (_) => _handleLogin(),
                    ),
                    const SizedBox(height: 14),

                    // Options row
                    Row(
                      children: [
                        GestureDetector(
                          onTap: () => setState(() => _remember = !_remember),
                          child: Row(
                            children: [
                              AnimatedContainer(
                                duration: const Duration(milliseconds: 200),
                                width: 18, height: 18,
                                decoration: BoxDecoration(
                                  color: _remember ? AppColors.amber : Colors.transparent,
                                  borderRadius: BorderRadius.circular(5),
                                  border: Border.all(
                                      color: _remember ? AppColors.amber : Colors.white30),
                                ),
                                child: _remember
                                    ? const Icon(Icons.check, size: 12, color: Colors.white)
                                    : null,
                              ),
                              const SizedBox(width: 8),
                              const Text('Remember me',
                                  style: TextStyle(color: Colors.white54, fontSize: 12)),
                            ],
                          ),
                        ),
                        const Spacer(),
                        GestureDetector(
                          onTap: () {},
                          child: const Text('Forgot password?',
                              style: TextStyle(color: AppColors.amber, fontSize: 12)),
                        ),
                      ],
                    ),

                    if (_errorMsg != null) ...[
                      const SizedBox(height: 10),
                      Text(_errorMsg!,
                          style: const TextStyle(color: AppColors.red, fontSize: 11)),
                    ],
                    const SizedBox(height: 20),

                    // Login button
                    ElevatedButton(
                      onPressed: _loading ? null : _handleLogin,
                      child: _loading
                          ? const SizedBox(
                              height: 18, width: 18,
                              child: CircularProgressIndicator(
                                  strokeWidth: 2, color: Colors.white))
                          : const Text('Sign In'),
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 20),
              Text('v1.0.0 · Kannan Blue Metals',
                  style: TextStyle(color: Colors.white.withOpacity(0.2), fontSize: 10)),
              const SizedBox(height: 24),
            ],
          ),
        ),
      ),
    );
  }

  @override
  void dispose() {
    _userCtrl.dispose();
    _passCtrl.dispose();
    super.dispose();
  }
}
