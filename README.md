# Leave-a-message

A matrix/terminal-styled app for creating and deciphering one-time-pad-like messages, now backed by Firebase Firestore for shared cross-device storage.

## Features

- Leave message with:
  - `id` (unique lookup key)
  - open text (stored as plain text)
  - encrypted text (stored as hex string)
- Find a message by `id` from a shared Firestore collection
- Decipher locally in the browser with a key (keys are never stored)
- Random key generator with a warning to save the key
- Front-end hosted statically (GitHub Pages compatible), data stored in Firestore

## Firebase setup

1. Create a Firebase project in the Firebase Console.
2. Enable **Firestore Database**.
3. Add a **Web App** and copy its config values.
4. Copy the template file and fill your values:

```bash
cp firebase-config.example.js firebase-config.js
```

5. Edit `firebase-config.js` and paste your config object.

### Suggested Firestore rules

Use rules that allow read + create, and block edits/deletes:

```txt
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /messages/{id} {
      allow read: if true;

      allow create: if
        request.resource.data.keys().hasOnly([
          'id', 'openText', 'encryptedText', 'encryptedLength', 'createdAt'
        ]) &&
        request.resource.data.id == id &&
        request.resource.data.id is string &&
        request.resource.data.openText is string &&
        request.resource.data.encryptedText is string &&
        request.resource.data.encryptedLength is int;

      allow update, delete: if false;
    }
  }
}
```

## Run locally

```bash
python3 -m http.server 4173
```

Then visit `http://localhost:4173`.

## Deploy to GitHub Pages

1. Push repository to GitHub.
2. In **Settings → Pages**, choose branch + root folder.
3. Make sure `firebase-config.js` is present in the deployed site (commit it if this is a public demo project, or inject it in your deploy pipeline).
