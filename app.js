import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const FIREBASE_CONFIG = globalThis.FIREBASE_CONFIG;
const db = FIREBASE_CONFIG ? getFirestore(initializeApp(FIREBASE_CONFIG)) : null;

const tabs = document.querySelectorAll(".tab");
const panels = {
  create: document.getElementById("panel-create"),
  find: document.getElementById("panel-find"),
};

const createForm = document.getElementById("create-form");
const createStatus = document.getElementById("create-status");
const keyWarning = document.getElementById("key-warning");
const generateKeyBtn = document.getElementById("generate-key");

const searchForm = document.getElementById("search-form");
const searchStatus = document.getElementById("search-status");
const resultCard = document.getElementById("result");
const resultId = document.getElementById("result-id");
const resultOpen = document.getElementById("result-open");
const resultEncrypted = document.getElementById("result-encrypted");

const decipherForm = document.getElementById("decipher-form");
const decipherStatus = document.getElementById("decipher-status");
const resultDeciphered = document.getElementById("result-deciphered");

let selectedMessage = null;
const MAX_MESSAGE_LENGTH = 5000;
const ID_PATTERN = /^[a-zA-Z0-9._-]{1,80}$/;

init();

function init() {
  if (!db) {
    const message =
      "Firebase is not configured. Copy firebase-config.example.js to firebase-config.js and fill values.";
    setStatus(createStatus, message, true);
    setStatus(searchStatus, message, true);
    createForm.querySelector("button[type='submit']").disabled = true;
    searchForm.querySelector("button[type='submit']").disabled = true;
  }
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((button) => button.classList.remove("is-active"));
    Object.values(panels).forEach((panel) => panel.classList.remove("is-active"));

    tab.classList.add("is-active");
    panels[tab.dataset.tab].classList.add("is-active");
  });
});

generateKeyBtn.addEventListener("click", () => {
  const secretTextField = createForm.elements.namedItem("secretText");
  const secretText = secretTextField?.value ?? "";
  if (!secretText.length) {
    setStatus(createStatus, "Write text to encrypt first.", true);
    return;
  }

  createForm.key.value = generateRandomKey(secretText.length);
  keyWarning.hidden = false;
  setStatus(createStatus, `Random key generated (${secretText.length} chars).`);
});

createForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!db) {
    setStatus(createStatus, "Firebase is not configured.", true);
    return;
  }

  const idField = createForm.elements.namedItem("id");
  const openTextField = createForm.elements.namedItem("openText");
  const secretTextField = createForm.elements.namedItem("secretText");
  const keyField = createForm.elements.namedItem("key");

  const id = idField?.value.trim() ?? "";
  const openText = openTextField?.value ?? "";
  const secretText = secretTextField?.value ?? "";
  const key = keyField?.value ?? "";

  if (!id || !secretText || !key) {
    setStatus(createStatus, "All fields are required.", true);
    return;
  }

  if (!ID_PATTERN.test(id)) {
    setStatus(createStatus, "ID must be 1-80 chars using letters, numbers, dot, underscore, or dash.", true);
    return;
  }

  if (secretText.length > MAX_MESSAGE_LENGTH || openText.length > MAX_MESSAGE_LENGTH) {
    setStatus(createStatus, `Messages are limited to ${MAX_MESSAGE_LENGTH} characters.`, true);
    return;
  }

  if (key.length < secretText.length) {
    setStatus(createStatus, "Key must be at least as long as text-to-encrypt.", true);
    return;
  }

  const encryptedText = encrypt(secretText, key);

  try {
    const messageRef = doc(db, "messages", id);
    const existing = await getDoc(messageRef);
    if (existing.exists()) {
      setStatus(createStatus, "ID already exists. Use a unique id.", true);
      return;
    }

    await setDoc(messageRef, {
      id,
      openText,
      encryptedText,
      encryptedLength: secretText.length,
      createdAt: serverTimestamp(),
    });

    createForm.reset();
    keyWarning.hidden = true;
    setStatus(createStatus, `Message '${id}' encrypted and saved to Firestore.`);
  } catch (error) {
    setStatus(createStatus, `Could not save message: ${error.message}`, true);
  }
});

searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!db) {
    setStatus(searchStatus, "Firebase is not configured.", true);
    return;
  }

  const id = searchForm.searchId.value.trim();
  if (!ID_PATTERN.test(id)) {
    selectedMessage = null;
    resultCard.hidden = true;
    setStatus(searchStatus, "Invalid ID format.", true);
    return;
  }

  const messageRef = doc(db, "messages", id);

  try {
    const snapshot = await getDoc(messageRef);

    if (!snapshot.exists()) {
      selectedMessage = null;
      resultCard.hidden = true;
      setStatus(searchStatus, "No message found for this id.", true);
      return;
    }

    const found = snapshot.data();
    if (!isValidStoredMessage(found)) {
      selectedMessage = null;
      resultCard.hidden = true;
      setStatus(searchStatus, "Stored message data is invalid.", true);
      return;
    }

    selectedMessage = found;

    resultId.textContent = found.id;
    resultOpen.textContent = found.openText;
    resultEncrypted.textContent = found.encryptedText;
    resultDeciphered.textContent = "—";
    decipherForm.reset();
    resultCard.hidden = false;
    setStatus(searchStatus, "Message loaded. Enter key to decipher.");
    setStatus(decipherStatus, "");
  } catch (error) {
    selectedMessage = null;
    resultCard.hidden = true;
    setStatus(searchStatus, `Lookup failed: ${error.message}`, true);
  }
});

decipherForm.addEventListener("submit", (event) => {
  event.preventDefault();

  if (!selectedMessage) {
    setStatus(decipherStatus, "Find a message first.", true);
    return;
  }

  const key = decipherForm.decipherKey.value;
  if (key.length < selectedMessage.encryptedLength) {
    setStatus(decipherStatus, "Key is too short for this encrypted message.", true);
    return;
  }

  try {
    const deciphered = decrypt(selectedMessage.encryptedText, key);
    resultDeciphered.textContent = deciphered;
    setStatus(decipherStatus, "Deciphered locally. Key was not saved.");
  } catch {
    setStatus(decipherStatus, "Could not decipher with the provided key.", true);
  }
});

function encrypt(text, key) {
  return text
    .split("")
    .map((char, index) => (char.charCodeAt(0) ^ key.charCodeAt(index)).toString(16).padStart(4, "0"))
    .join("");
}

function decrypt(cipherHex, key) {
  if (cipherHex.length % 4 !== 0) {
    throw new Error("Invalid cipher format");
  }

  if (!/^[0-9a-f]+$/i.test(cipherHex)) {
    throw new Error("Invalid cipher characters");
  }

  const blocks = cipherHex.match(/.{1,4}/g) || [];
  if (blocks.length > key.length) {
    throw new Error("Key too short");
  }

  return blocks
    .map((hex, index) => String.fromCharCode(parseInt(hex, 16) ^ key.charCodeAt(index)))
    .join("");
}

function generateRandomKey(length) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+[]{}|;:,.<>?/";
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => chars[value % chars.length]).join("");
}

function setStatus(target, message, isError = false) {
  target.textContent = message;
  target.classList.toggle("error", isError);
}

function isValidStoredMessage(data) {
  return (
    data &&
    typeof data.id === "string" &&
    ID_PATTERN.test(data.id) &&
    typeof data.openText === "string" &&
    data.openText.length <= MAX_MESSAGE_LENGTH &&
    typeof data.encryptedText === "string" &&
    /^[0-9a-f]+$/i.test(data.encryptedText) &&
    data.encryptedText.length % 4 === 0 &&
    Number.isInteger(data.encryptedLength) &&
    data.encryptedLength > 0 &&
    data.encryptedLength <= MAX_MESSAGE_LENGTH &&
    data.encryptedText.length === data.encryptedLength * 4
  );
}
