import 'package:flutter/material.dart';

class NFTReceiptManagerScreen extends StatelessWidget {
  const NFTReceiptManagerScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('NFT Receipt Manager'),
      ),
      body: const Center(
        child: Text('Manage your NFT receipts here.'),
      ),
    );
  }
}
