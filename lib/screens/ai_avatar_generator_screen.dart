import 'package:flutter/material.dart';

class AIAvatarGeneratorScreen extends StatelessWidget {
  const AIAvatarGeneratorScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('AI Avatar Generator'),
      ),
      body: const Center(
        child: Text('Generate AI avatars for your customers.'),
      ),
    );
  }
}
