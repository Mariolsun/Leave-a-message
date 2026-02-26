# Leave-a-message

A matrix/terminal-styled front-end app for creating and deciphering one-time-pad-like messages.

## Features

- Leave message with:
  - `id` (unique lookup key)
  - open text (stored as plain text)
  - encrypted text (stored as hex string)
- Find a message by `id`
- Decipher locally in the browser with a key (keys are never stored)
- Random key generator with a warning to save the key
- Front-end-only persistence via `localStorage`, seeded from `messages.json`

## Run

Open `index.html` directly, or serve the project:

```bash
python3 -m http.server 4173
```

Then visit `http://localhost:4173`.
