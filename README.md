# Merchant NFT Receipt Flutter App

This Flutter app is a Merchant NFT Receipt system featuring:
- NFT receipt management
- AI avatar generation
- Dynamic NFT evolution
- Wallet connection (web3dart, etc.)
- Firebase integration
- IPFS/web3.storage support
- Material Design UI

## Main Screens
- Dashboard
- NFT Receipt Manager
- AI Avatar Generator
- Dynamic NFT Evolution
- Wallet Connect

## Getting Started

### Prerequisites
- Flutter SDK (https://flutter.dev/docs/get-started/install)
- Dart SDK (included with Flutter)
- Firebase project (for integration)
- VSCode with recommended extensions (see `.vscode/extensions.json`)

### Install Dependencies
```sh
flutter pub get
```

### Run the App
```sh
flutter run
```

## Project Structure
- `lib/screens/` — Main feature screens
- `lib/widgets/` — Reusable widgets
- `lib/services/` — Service classes (blockchain, Firebase, IPFS, etc.)
- `lib/models/` — Data models
- `lib/state/` — State management (Provider/Riverpod/Bloc)

## State Management
- Uses Provider by default (see `pubspec.yaml`).
- You can switch to Riverpod or Bloc as needed.

## Integrations
- **Blockchain:** web3dart
- **Firebase:** firebase_core, cloud_firestore, firebase_auth, firebase_storage
- **IPFS:** dio (for web3.storage API)
- **AI Avatar:** image_picker (for image selection)

## VSCode Extensions
See `.vscode/extensions.json` for recommended extensions.

## Next Steps
- Implement feature logic in each screen
- Set up Firebase and web3dart configuration
- Add models, services, and state management
- Connect UI to backend services

---

For more details, see the code and comments in each file.
