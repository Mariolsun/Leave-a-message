const STORAGE_KEY = "otpMessagesDB";

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

let messages = [];
let selectedMessage = null;

init();

async function init() {
  messages = await loadMessages();
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
  const secretText = createForm.secretText.value;
  if (!secretText.length) {
    setStatus(createStatus, "Write text to encrypt first.", true);
    return;
  }

  createForm.key.value = generateRandomKey(secretText.length);
  keyWarning.hidden = false;
  setStatus(createStatus, `Random key generated (${secretText.length} chars).`);
});

createForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const id = createForm.id.value.trim();
  const openText = createForm.openText.value;
  const secretText = createForm.secretText.value;
  const key = createForm.key.value;

  if (!id || !openText || !secretText || !key) {
    setStatus(createStatus, "All fields are required.", true);
    return;
  }

  if (messages.some((message) => message.id === id)) {
    setStatus(createStatus, "ID already exists. Use a unique id.", true);
    return;
  }

  if (key.length !== secretText.length) {
    setStatus(createStatus, "Key length must exactly match text-to-encrypt length.", true);
    return;
  }

  const encryptedText = encrypt(secretText, key);

  messages.push({
    id,
    openText,
    encryptedText,
    encryptedLength: secretText.length,
    createdAt: new Date().toISOString(),
  });

  saveMessages(messages);
  createForm.reset();
  keyWarning.hidden = true;
  setStatus(createStatus, `Message '${id}' encrypted and saved locally.`);
});

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const id = searchForm.searchId.value.trim();

  const found = messages.find((message) => message.id === id);
  selectedMessage = found || null;

  if (!found) {
    resultCard.hidden = true;
    setStatus(searchStatus, "No message found for this id.", true);
    return;
  }

  resultId.textContent = found.id;
  resultOpen.textContent = found.openText;
  resultEncrypted.textContent = found.encryptedText;
  resultDeciphered.textContent = "—";
  decipherForm.reset();
  resultCard.hidden = false;
  setStatus(searchStatus, "Message loaded. Enter key to decipher.");
  setStatus(decipherStatus, "");
});

decipherForm.addEventListener("submit", (event) => {
  event.preventDefault();

  if (!selectedMessage) {
    setStatus(decipherStatus, "Find a message first.", true);
    return;
  }

  const key = decipherForm.decipherKey.value;
  if (key.length !== selectedMessage.encryptedLength) {
    setStatus(decipherStatus, "Key length mismatch.", true);
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

  const blocks = cipherHex.match(/.{1,4}/g) || [];
  if (blocks.length !== key.length) {
    throw new Error("Key length mismatch");
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

async function loadMessages() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  try {
    const response = await fetch("messages.json");
    if (!response.ok) {
      return [];
    }

    const initial = await response.json();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
    return initial;
  } catch {
    return [];
  }
}

function saveMessages(nextMessages) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(nextMessages));
}

function setStatus(target, message, isError = false) {
  target.textContent = message;
  target.classList.toggle("error", isError);
}
