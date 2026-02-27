import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  collection,
  doc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
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
const resultListCard = document.getElementById("search-results");
const resultList = document.getElementById("result-list");
const resultCard = document.getElementById("result");
const resultOpen = document.getElementById("result-open");
const resultEncrypted = document.getElementById("result-encrypted");

const decipherForm = document.getElementById("decipher-form");
const decipherStatus = document.getElementById("decipher-status");
const resultDeciphered = document.getElementById("result-deciphered");

let selectedMessage = null;
let foundMessages = [];
const MAX_MESSAGE_LENGTH = 5000;
const INBOX_PATTERN = /^[a-zA-Z0-9._-]{1,80}$/;

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

  const inboxField = createForm.elements.namedItem("inbox");
  const openTextField = createForm.elements.namedItem("openText");
  const secretTextField = createForm.elements.namedItem("secretText");
  const keyField = createForm.elements.namedItem("key");

  const inbox = inboxField?.value.trim() ?? "";
  const openText = openTextField?.value ?? "";
  const secretText = secretTextField?.value ?? "";
  const key = keyField?.value ?? "";

  if (!inbox || !secretText || !key) {
    setStatus(createStatus, "Inbox, text-to-encrypt, and key are required.", true);
    return;
  }

  if (!INBOX_PATTERN.test(inbox)) {
    setStatus(
      createStatus,
      "Inbox must be 1-80 chars using letters, numbers, dot, underscore, or dash.",
      true
    );
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
    const counterRef = doc(db, "inboxCounters", inbox);
    const messageRef = doc(collection(db, "messages"));

    const assignedMessageNumber = await runTransaction(db, async (transaction) => {
      const counterSnapshot = await transaction.get(counterRef);
      const nextInternalId = sanitizeNextInternalId(counterSnapshot.data()?.nextInternalId);

      transaction.set(counterRef, { nextInternalId: nextInternalId + 1 }, { merge: true });
      transaction.set(messageRef, {
        inbox,
        internalId: nextInternalId,
        openText,
        encryptedText,
        encryptedLength: secretText.length,
        createdAt: serverTimestamp(),
      });

      return nextInternalId;
    });

    createForm.reset();
    keyWarning.hidden = true;
    setStatus(createStatus, `Message saved to inbox '${inbox}' as entry ${assignedMessageNumber}.`);
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

  const inbox = searchForm.searchInbox.value.trim();
  if (!INBOX_PATTERN.test(inbox)) {
    resetSearchState();
    setStatus(searchStatus, "Invalid inbox format.", true);
    return;
  }

  try {
    const messagesQuery = query(
      collection(db, "messages"),
      where("inbox", "==", inbox),
      orderBy("internalId", "asc")
    );
    const snapshot = await getDocs(messagesQuery);

    foundMessages = snapshot.docs
      .map((entry) => ({ docId: entry.id, ...entry.data() }))
      .filter(isValidStoredMessage);

    selectedMessage = null;
    resultCard.hidden = true;
    resultDeciphered.textContent = "—";
    decipherForm.reset();
    setStatus(decipherStatus, "");

    if (!foundMessages.length) {
      resultListCard.hidden = true;
      setStatus(searchStatus, "No messages found for this inbox.", true);
      return;
    }

    renderFoundMessages();
    resultListCard.hidden = false;
    setStatus(searchStatus, `Inbox '${inbox}' loaded (${foundMessages.length} messages).`);
  } catch (error) {
    resetSearchState();
    setStatus(searchStatus, `Lookup failed: ${error.message}`, true);
  }
});

resultList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-message-index]");
  if (!button) {
    return;
  }

  const index = Number.parseInt(button.dataset.messageIndex ?? "", 10);
  if (!Number.isInteger(index) || index < 0 || index >= foundMessages.length) {
    setStatus(searchStatus, "Could not open selected message.", true);
    return;
  }

  selectedMessage = foundMessages[index];
  resultOpen.textContent = selectedMessage.openText;
  resultEncrypted.textContent = selectedMessage.encryptedText;
  resultDeciphered.textContent = "—";
  decipherForm.reset();
  resultCard.hidden = false;
  setStatus(searchStatus, "Message selected. Enter key to decipher.");
  setStatus(decipherStatus, "");
});

decipherForm.addEventListener("submit", (event) => {
  event.preventDefault();

  if (!selectedMessage) {
    setStatus(decipherStatus, "Select a message from inbox first.", true);
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

function renderFoundMessages() {
  resultList.innerHTML = "";

  foundMessages.forEach((message, index) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.messageIndex = String(index);
    button.textContent = buildMessageLabel(message, index);
    item.appendChild(button);
    resultList.appendChild(item);
  });
}

function buildMessageLabel(message, index) {
  const preview = message.openText.trim() || "[No open text]";
  const shortened = preview.length > 60 ? `${preview.slice(0, 60)}…` : preview;
  return `Message ${index + 1}: ${shortened}`;
}

function resetSearchState() {
  foundMessages = [];
  selectedMessage = null;
  resultList.innerHTML = "";
  resultListCard.hidden = true;
  resultCard.hidden = true;
  resultDeciphered.textContent = "—";
  decipherForm.reset();
  setStatus(decipherStatus, "");
}

function sanitizeNextInternalId(value) {
  return Number.isInteger(value) && value > 0 ? value : 1;
}

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
    typeof data.inbox === "string" &&
    INBOX_PATTERN.test(data.inbox) &&
    Number.isInteger(data.internalId) &&
    data.internalId > 0 &&
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
