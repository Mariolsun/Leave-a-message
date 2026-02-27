import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  collection,
  doc,
  getDocs,
  getFirestore,
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
const loadKeyFileCreateBtn = document.getElementById("load-key-file-create");
const discardKeyFileCreateBtn = document.getElementById("discard-key-file-create");
const keyFileCreateInput = document.getElementById("key-file-create");
const dropZoneCreate = document.getElementById("drop-zone-create");
const startKeyWrapperCreate = document.getElementById("start-key-wrapper-create");
const startKeyCreateSelect = document.getElementById("start-key-create");

const searchForm = document.getElementById("search-form");
const searchStatus = document.getElementById("search-status");
const resultListCard = document.getElementById("search-results");
const resultList = document.getElementById("result-list");
const resultCard = document.getElementById("result");
const resultOpen = document.getElementById("result-open");
const resultEncrypted = document.getElementById("result-encrypted");
const resultTextLabel = document.getElementById("result-text-label");
const resultDate = document.getElementById("result-date");

const decipherForm = document.getElementById("decipher-form");
const decipherStatus = document.getElementById("decipher-status");
const loadKeyFileDecipherBtn = document.getElementById("load-key-file-decipher");
const discardKeyFileDecipherBtn = document.getElementById("discard-key-file-decipher");
const keyFileDecipherInput = document.getElementById("key-file-decipher");
const dropZoneDecipher = document.getElementById("drop-zone-decipher");
const startKeyWrapperDecipher = document.getElementById("start-key-wrapper-decipher");
const startKeyDecipherSelect = document.getElementById("start-key-decipher");

let selectedMessage = null;
let foundMessages = [];
const MAX_MESSAGE_LENGTH = 5000;
const INBOX_PATTERN = /^[a-zA-Z0-9._-]{1,80}$/;
const FILE_KEY_LINE_PATTERN = /^\s*(\d+)\.(.+)$/;

const loadedCreateKeys = [];
const loadedDecipherKeys = [];

const KEY_MASK_DELAY_MS = 1000;
const keyMaskStates = new WeakMap();
const createKeyField = createForm.elements.namedItem("key");
const decipherKeyField = decipherForm.elements.namedItem("decipherKey");


function openNativeFilePicker(input) {
  if (!input) {
    return;
  }

  if (typeof input.showPicker === "function") {
    input.showPicker();
    return;
  }

  input.click();
}

init();

function init() {
  startKeyWrapperCreate.hidden = loadedCreateKeys.length === 0;
  startKeyWrapperDecipher.hidden = loadedDecipherKeys.length === 0;
  syncKeyFieldMode("create");
  syncKeyFieldMode("decipher");
  syncDiscardKeyButton("create");
  syncDiscardKeyButton("decipher");

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



loadKeyFileCreateBtn.addEventListener("click", () => openNativeFilePicker(keyFileCreateInput));
loadKeyFileDecipherBtn.addEventListener("click", () => openNativeFilePicker(keyFileDecipherInput));
discardKeyFileCreateBtn.addEventListener("click", () => discardLoadedKeys("create"));
discardKeyFileDecipherBtn.addEventListener("click", () => discardLoadedKeys("decipher"));

keyFileCreateInput.addEventListener("change", async (event) => {
  const [file] = event.target.files ?? [];
  await handleKeyFileLoad(file, "create");
  keyFileCreateInput.value = "";
});

keyFileDecipherInput.addEventListener("change", async (event) => {
  const [file] = event.target.files ?? [];
  await handleKeyFileLoad(file, "decipher");
  keyFileDecipherInput.value = "";
});

setupDropZone(dropZoneCreate, "create");
setupDropZone(dropZoneDecipher, "decipher");
setupDelayedKeyMask(createKeyField);
setupDelayedKeyMask(decipherKeyField);

createKeyField?.addEventListener("input", () => {
  if (!getKeyFieldValue(createKeyField).length) {
    keyWarning.hidden = true;
  }
});

["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
  document.addEventListener(eventName, (event) => {
    event.preventDefault();
  });
});

generateKeyBtn.addEventListener("click", () => {
  const secretTextField = createForm.elements.namedItem("secretText");
  const secretText = secretTextField?.value ?? "";
  if (!secretText.length) {
    setStatus(createStatus, "Write text to encrypt first.", true);
    return;
  }

  setKeyFieldValue(createKeyField, generateRandomKey(secretText.length));
  syncKeyFieldMode("create", false);
  keyWarning.hidden = false;
  setStatus(createStatus, `Random key generated (${secretText.length} chars).`);
});

createForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  startKeyWrapperCreate.hidden = loadedCreateKeys.length === 0;
  startKeyWrapperDecipher.hidden = loadedDecipherKeys.length === 0;

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
  let key = "";

  if (!inbox || !secretText) {
    setStatus(createStatus, "Inbox and text-to-encrypt are required.", true);
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

  if (loadedCreateKeys.length > 0) {
    const computedKey = buildKeyFromLoadedKeys(
      loadedCreateKeys,
      Number.parseInt(startKeyCreateSelect.value, 10),
      secretText.length
    );

    if (!computedKey.ok) {
      setStatus(createStatus, computedKey.message, true);
      return;
    }

    key = computedKey.key;
    setKeyFieldValue(keyField, key);
  } else {
    key = getKeyFieldValue(keyField);
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
    setKeyFieldValue(keyField, "", false);
    syncKeyFieldMode("create");
    syncDiscardKeyButton("create");
    keyWarning.hidden = true;
    startKeyWrapperCreate.hidden = loadedCreateKeys.length === 0;
    setStatus(createStatus, `Message saved to inbox '${inbox}' as entry ${assignedMessageNumber}.`);
  } catch (error) {
    setStatus(createStatus, `Could not save message: ${error.message}`, true);
  }
});

searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  startKeyWrapperCreate.hidden = loadedCreateKeys.length === 0;
  startKeyWrapperDecipher.hidden = loadedDecipherKeys.length === 0;

  if (!db) {
    setStatus(searchStatus, "Firebase is not configured.", true);
    return;
  }

  const inboxField = searchForm.elements.namedItem("searchInbox");
  const inbox = inboxField?.value.trim() ?? "";
  if (!INBOX_PATTERN.test(inbox)) {
    resetSearchState();
    setStatus(searchStatus, "Invalid inbox format.", true);
    return;
  }

  try {
    const messagesQuery = query(collection(db, "messages"), where("inbox", "==", inbox));
    const snapshot = await getDocs(messagesQuery);

    foundMessages = snapshot.docs
      .map((entry) => ({ docId: entry.id, ...entry.data() }))
      .filter(isValidStoredMessage)
      .sort((a, b) => a.internalId - b.internalId);

    selectedMessage = null;
    resultCard.hidden = true;
    resetResultDisplay();
    decipherForm.reset();
    setKeyFieldValue(decipherKeyField, "", false);
    syncKeyFieldMode("decipher");
    syncDiscardKeyButton("decipher");
    startKeyWrapperDecipher.hidden = loadedDecipherKeys.length === 0;
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
  resultDate.textContent = formatSelectedMessageTimestamp(selectedMessage.createdAt);
  showEncryptedText(selectedMessage.encryptedText);
  decipherForm.reset();
  setKeyFieldValue(decipherKeyField, "", false);
  syncKeyFieldMode("decipher");
  startKeyWrapperDecipher.hidden = loadedDecipherKeys.length === 0;
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

  let key = "";

  if (loadedDecipherKeys.length > 0) {
    const computedKey = buildKeyFromLoadedKeys(
      loadedDecipherKeys,
      Number.parseInt(startKeyDecipherSelect.value, 10),
      selectedMessage.encryptedLength
    );

    if (!computedKey.ok) {
      setStatus(decipherStatus, computedKey.message, true);
      return;
    }

    key = computedKey.key;
    setKeyFieldValue(decipherKeyField, key);
  } else {
    key = getKeyFieldValue(decipherKeyField);
  }

  if (key.length < selectedMessage.encryptedLength) {
    setStatus(decipherStatus, "Key is too short for this encrypted message.", true);
    return;
  }

  try {
    const deciphered = decrypt(selectedMessage.encryptedText, key);
    showDecryptedText(deciphered);
    setStatus(decipherStatus, "Deciphered locally. Key was not saved.");
  } catch {
    setStatus(decipherStatus, "Could not decipher with the provided key.", true);
  }
});


function resetResultDisplay() {
  resultTextLabel.textContent = "Encrypted Text:";
  resultEncrypted.textContent = selectedMessage?.encryptedText ?? "";
}

function showEncryptedText(encryptedText) {
  resultTextLabel.textContent = "Encrypted Text:";
  resultEncrypted.textContent = encryptedText;
}

function showDecryptedText(text) {
  resultTextLabel.textContent = "Decrypted Text:";
  resultEncrypted.textContent = "";

  for (const [index, char] of Array.from(text).entries()) {
    const span = document.createElement("span");
    span.className = "decrypted-char";
    span.style.setProperty("--char-index", String(index));
    span.textContent = char;
    resultEncrypted.appendChild(span);
  }
}

function renderFoundMessages() {
  resultList.innerHTML = "";

  foundMessages.forEach((message, index) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.messageIndex = String(index);
    button.innerHTML = buildMessageLabel(message, index);
    item.appendChild(button);
    resultList.appendChild(item);
  });
}

function buildMessageLabel(message, index) {
  const preview = message.openText.trim() || "[No open text]";
  const shortened = preview.length > 60 ? `${preview.slice(0, 60)}…` : preview;
  const leftDate = formatListDate(message.createdAt);
  return `
    <span class="message-list__preview">Message ${index + 1}: ${escapeHtml(shortened)}</span>
    <span class="message-list__date">${leftDate}</span>
  `;
}

function formatListDate(createdAt) {
  const date = parseTimestamp(createdAt);
  if (!date) {
    return "Left --.--.--";
  }

  return `Left ${formatDate(date)}`;
}

function formatSelectedMessageTimestamp(createdAt) {
  const date = parseTimestamp(createdAt);
  if (!date) {
    return "Left --.--.-- at --:--:--";
  }

  return `Left ${formatDate(date)} at ${formatTime(date)}`;
}

function parseTimestamp(createdAt) {
  if (!createdAt) {
    return null;
  }

  if (typeof createdAt.toDate === "function") {
    return createdAt.toDate();
  }

  if (typeof createdAt.seconds === "number") {
    return new Date(createdAt.seconds * 1000);
  }

  if (createdAt instanceof Date) {
    return createdAt;
  }

  return null;
}

function formatDate(date) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear()).slice(-2);
  return `${day}.${month}.${year}`;
}

function formatTime(date) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function escapeHtml(value) {
  const node = document.createElement("div");
  node.textContent = value;
  return node.innerHTML;
}

function resetSearchState() {
  foundMessages = [];
  selectedMessage = null;
  resultList.innerHTML = "";
  resultListCard.hidden = true;
  resultCard.hidden = true;
  resultDate.textContent = "";
  resetResultDisplay();
  decipherForm.reset();
  setKeyFieldValue(decipherKeyField, "", false);
  syncKeyFieldMode("decipher");
  startKeyWrapperDecipher.hidden = loadedDecipherKeys.length === 0;
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

function setupDelayedKeyMask(field) {
  if (!field) {
    return;
  }

  const state = { rawValue: "", timerId: null, isMasked: false };
  keyMaskStates.set(field, state);

  field.addEventListener("input", () => {
    state.rawValue = field.value;
    state.isMasked = false;
    scheduleKeyMask(field, state);
  });

  field.addEventListener("focus", () => {
    revealKeyField(field, state);
  });

  field.addEventListener("blur", () => {
    scheduleKeyMask(field, state);
  });
}

function scheduleKeyMask(field, state) {
  if (state.timerId) {
    clearTimeout(state.timerId);
    state.timerId = null;
  }

  if (!state.rawValue.length) {
    field.value = "";
    state.isMasked = false;
    return;
  }

  state.timerId = setTimeout(() => {
    field.value = "*".repeat(state.rawValue.length);
    state.isMasked = true;
    state.timerId = null;
  }, KEY_MASK_DELAY_MS);
}

function revealKeyField(field, state) {
  if (state.timerId) {
    clearTimeout(state.timerId);
    state.timerId = null;
  }

  if (state.isMasked) {
    field.value = state.rawValue;
    state.isMasked = false;
  }
}

function setKeyFieldValue(field, value, maskAfterDelay = true) {
  if (!field) {
    return;
  }

  const state = keyMaskStates.get(field);
  if (!state) {
    field.value = value;
    return;
  }

  if (state.timerId) {
    clearTimeout(state.timerId);
    state.timerId = null;
  }

  state.rawValue = value;
  state.isMasked = false;
  field.value = value;

  if (maskAfterDelay) {
    scheduleKeyMask(field, state);
  }
}

function getKeyFieldValue(field) {
  if (!field) {
    return "";
  }

  const state = keyMaskStates.get(field);
  if (!state) {
    return field.value ?? "";
  }

  return state.rawValue;
}

function setupDropZone(dropZone, mode) {
  if (!dropZone) {
    return;
  }

  const input = mode === "create" ? keyFileCreateInput : keyFileDecipherInput;

  dropZone.addEventListener("click", () => openNativeFilePicker(input));
  dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openNativeFilePicker(input);
    }
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
      dropZone.classList.add("is-dragging");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();
      dropZone.classList.remove("is-dragging");
    });
  });

  dropZone.addEventListener("drop", async (event) => {
    const [file] = event.dataTransfer?.files ?? [];
    await handleKeyFileLoad(file, mode);
  });
}

async function handleKeyFileLoad(file, mode) {
  const statusTarget = mode === "create" ? createStatus : decipherStatus;
  if (!file) {
    return;
  }

  if (!file.name.toLowerCase().endsWith(".txt")) {
    setStatus(statusTarget, "Key file must have a .txt extension.", true);
    return;
  }

  let content = "";
  try {
    content = await file.text();
  } catch {
    setStatus(statusTarget, "Could not read key file.", true);
    return;
  }

  const parsed = parseKeysFromFile(content);
  if (!parsed.length) {
    setStatus(
      statusTarget,
      "No valid keys found. Use lines like '1.yourKey', separated by empty lines.",
      true
    );
    return;
  }

  const targetKeys = mode === "create" ? loadedCreateKeys : loadedDecipherKeys;
  targetKeys.splice(0, targetKeys.length, ...parsed);

  const select = mode === "create" ? startKeyCreateSelect : startKeyDecipherSelect;
  const wrapper = mode === "create" ? startKeyWrapperCreate : startKeyWrapperDecipher;
  const keyField = mode === "create" ? createKeyField : decipherKeyField;

  setKeyFieldValue(keyField, "", false);
  if (mode === "create") {
    keyWarning.hidden = true;
  }
  populateStartKeySelect(select, targetKeys);
  syncKeyFieldMode(mode, true);
  syncDiscardKeyButton(mode);
  wrapper.hidden = false;

  setStatus(statusTarget, `Loaded ${parsed.length} keys from ${file.name}.`);
}

function syncKeyFieldMode(mode, useLoadedKeys = null) {
  const keyField = mode === "create" ? createKeyField : decipherKeyField;
  const loadedKeys = mode === "create" ? loadedCreateKeys : loadedDecipherKeys;
  const shouldUseLoadedKeys = useLoadedKeys ?? loadedKeys.length > 0;

  if (!keyField) {
    return;
  }

  keyField.disabled = shouldUseLoadedKeys;
}


function discardLoadedKeys(mode) {
  const targetKeys = mode === "create" ? loadedCreateKeys : loadedDecipherKeys;
  const keyField = mode === "create" ? createKeyField : decipherKeyField;
  const wrapper = mode === "create" ? startKeyWrapperCreate : startKeyWrapperDecipher;
  const statusTarget = mode === "create" ? createStatus : decipherStatus;

  targetKeys.splice(0, targetKeys.length);
  wrapper.hidden = true;
  setKeyFieldValue(keyField, "", false);
  syncKeyFieldMode(mode, false);
  syncDiscardKeyButton(mode);
  setStatus(statusTarget, "Loaded key file discarded. You can enter key manually or load another file.");
}

function syncDiscardKeyButton(mode) {
  const button = mode === "create" ? discardKeyFileCreateBtn : discardKeyFileDecipherBtn;
  const loadedKeys = mode === "create" ? loadedCreateKeys : loadedDecipherKeys;

  if (!button) {
    return;
  }

  button.hidden = loadedKeys.length === 0;
}

function parseKeysFromFile(text) {
  return text
    .split(/\n\s*\n+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const match = chunk.match(FILE_KEY_LINE_PATTERN);
      if (!match) {
        return null;
      }

      const key = match[2].trim();
      return key.length ? key : null;
    })
    .filter(Boolean);
}

function populateStartKeySelect(select, keys) {
  select.innerHTML = "";

  keys.forEach((_, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `#${index + 1}`;
    select.appendChild(option);
  });

  select.value = "0";
}

function buildKeyFromLoadedKeys(keys, startIndex, requiredLength) {
  if (!keys.length) {
    return { ok: false, message: "Provide a key manually or load a key file first." };
  }

  if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= keys.length) {
    return { ok: false, message: "Select a valid starting key from the loaded file." };
  }

  let combined = "";
  for (let index = startIndex; index < keys.length && combined.length < requiredLength; index += 1) {
    combined += keys[index];
  }

  if (combined.length < requiredLength) {
    return {
      ok: false,
      message: "Not enough keys from the selected starting key to process this text.",
    };
  }

  return { ok: true, key: combined.slice(0, requiredLength) };
}
