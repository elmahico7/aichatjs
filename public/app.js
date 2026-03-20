const form = document.getElementById("form");
const input = document.getElementById("input");
const messagesDiv = document.getElementById("messages");
const newChatBtn = document.getElementById("newChatBtn");
const chatHistory = document.getElementById("chatHistory");
const uploadBtn = document.getElementById("uploadBtn");
const pdfInput = document.getElementById("pdfInput");
const uploadStatus = document.getElementById("uploadStatus");

let chats = [];
let currentChatId = null;
let selectedFile = null;
let pdfContext = null; // Store extracted PDF text

// Load chats from localStorage; don't automatically create a chat when none exist
function loadChats() {
  const saved = localStorage.getItem("chats");
  if (saved) {
    chats = JSON.parse(saved);
  } else {
    chats = [];
  }

  // Normalize any default names (generate titles) but don't save yet if nothing changed
  let updatedNames = false;
  chats.forEach(chat => {
    if (!chat.name || chat.name === "New chat") {
      const gen = generateChatTitle(chat.messages);
      if (gen && gen !== "New chat") {
        chat.name = gen;
        updatedNames = true;
      }
    }
  });
  if (updatedNames) saveChats();

  // restore previously selected chat if it's still present
  const savedCurrentId = localStorage.getItem("currentChatId");
  if (savedCurrentId && chats.find(c => c.id === savedCurrentId)) {
    currentChatId = savedCurrentId;
  } else if (chats.length > 0) {
    currentChatId = chats[0].id;
  } else {
    // leave currentChatId null; user will create a chat manually or by sending a message
    currentChatId = null;
  }
}

// Save chats to localStorage
function saveChats() {
  localStorage.setItem("chats", JSON.stringify(chats));
  localStorage.setItem("currentChatId", currentChatId);
}

// Create a new chat (or reuse an existing empty one)
function createNewChat() {
  // if there is already a fresh empty chat, switch to it instead of duplicating
  const existing = chats.find(c => c.name === "New chat" && c.messages.length <= 1);
  if (existing) {
    currentChatId = existing.id;
    saveChats();
    renderChatHistory();
    loadCurrentChat();
    return;
  }

  const id = Date.now().toString();
  const newChat = {
    id,
    name: "New chat",
    messages: [
      {
        role: "system",
        content: "You are a helpful assistant."
      }
    ]
  };
  chats.unshift(newChat); // Add to beginning
  currentChatId = id;
  saveChats();
  renderChatHistory();
  loadCurrentChat();
}

// Generate a title from the first user message
function generateChatTitle(chatMessages) {
  if (!chatMessages || !chatMessages.length) return "New chat";

  // Prefer a substantial user message (>20 chars), otherwise first user or assistant message
  const userMsgs = chatMessages.filter(m => m.role === "user" && m.content && m.content.trim());
  let source = userMsgs.find(m => m.content.trim().length > 20) || userMsgs[0] || chatMessages.find(m => m.role === "assistant");
  if (!source || !source.content) return "New chat";

  // Clean and shorten text for a compact title
  let text = source.content.replace(/\s+/g, " ").trim();
  text = text.replace(/https?:\/\/\S+/g, "").trim(); // remove urls

  // Choose the first sentence or up to punctuation/newline
  const firstSentence = (text.split(/[\.\!\?\n]/)[0] || text).trim();
  let title = firstSentence.substring(0, 60).trim();
  if (firstSentence.length > 60 || text.length > 60) title += "...";

  // Fallbacks
  if (!title) return "New chat";
  return title;
}

// Remote title generation via server (Anthropic). Returns string or null on failure.
async function generateTitleRemote(messages) {
  try {
    const res = await fetch('/generate-title', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages })
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.title || null);
  } catch (err) {
    console.warn('Title generation failed:', err);
    return null;
  }
}

// Update chat title based on first user message
async function updateChatTitle(chat) {
  if (!chat) return;

  // Only update if name is missing or default
  if (chat.name && chat.name !== 'New chat') return;

  // Try remote generation first
  const remote = await generateTitleRemote(chat.messages || []);
  if (remote) {
    chat.name = remote;
    saveChats();
    renderChatHistory();
    return;
  }

  // Fallback to local heuristic
  const newTitle = generateChatTitle(chat.messages);
  if (newTitle && newTitle !== 'New chat') {
    chat.name = newTitle;
    saveChats();
    renderChatHistory();
  }
}

// Load current chat's messages
function loadCurrentChat() {
  const chat = chats.find(c => c.id === currentChatId);
  if (!chat) {
    messagesDiv.innerHTML = "";
    document.getElementById('title').textContent = "AI CHAT";
    return;
  }
  
  messagesDiv.innerHTML = "";
  const userMessages = chat.messages.filter(m => m.role !== "system");
  userMessages.forEach(msg => {
    renderMessage(msg.content, msg.role === "user" ? "user" : "ai");
  });
}

// Get current chat object
function getCurrentChat() {
  return chats.find(c => c.id === currentChatId);
}

// Render message to UI only (for loading existing messages)
function renderMessage(text, className) {
  const div = document.createElement("div");
  div.className = `message ${className}`;
  
  // Split text by double newlines to create paragraphs
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim());
  
  if (paragraphs.length > 1) {
    // Multiple paragraphs - use innerHTML with escaped text
    div.innerHTML = paragraphs
      .map(p => `<p>${escapeHtml(p.trim())}</p>`)
      .join("");
  } else {
    // Single paragraph or no line breaks - use textContent for safety
    div.textContent = text;
  }
  
  messagesDiv.appendChild(div);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Escape HTML special characters to prevent XSS
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Add message to UI and current chat (for new messages)
function addMessage(text, className) {
  renderMessage(text, className);
  
  // Update chat messages
  const chat = getCurrentChat();
  if (chat) {
    const role = className === "user" ? "user" : "assistant";
    chat.messages.push({ role, content: text });
    // Update title asynchronously (remote or fallback)
    updateChatTitle(chat);
    saveChats();
  }
}

// Render chat history in sidebar
function renderChatHistory() {
  chatHistory.innerHTML = "";

  // if there is only a single brand‑new chat (no user messages) hide it entirely
  const visibleChats = chats.filter(chat => {
    if (chats.length === 1 && chat.name === "New chat" && chat.messages.length <= 1) {
      return false;
    }
    return true;
  });

  visibleChats.forEach(chat => {
    const div = document.createElement("div");
    div.className = `chat-item ${chat.id === currentChatId ? "active" : ""}`;
    div.dataset.chatId = chat.id; // Store chat ID for easy access
    
    const textSpan = document.createElement("span");
    textSpan.className = "chat-item-text";
    textSpan.textContent = chat.name;
    
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "chat-item-delete";
    deleteBtn.textContent = "✕";
    deleteBtn.type = "button";
    
    div.appendChild(textSpan);
    div.appendChild(deleteBtn);
    chatHistory.appendChild(div);
  });
}

// Switch to a different chat
function switchChat(chatId) {
  currentChatId = chatId;
  saveChats();
  renderChatHistory();
  loadCurrentChat();
}

// Delete a chat
function deleteChat(chatId) {
  chats = chats.filter(c => c.id !== chatId);
  
  // If deleted chat was current, switch to another
  if (currentChatId === chatId) {
    if (chats.length > 0) {
      currentChatId = chats[0].id;
    } else {
      currentChatId = null;
      // clear UI when there are no chats left
      saveChats();
      renderChatHistory();
      loadCurrentChat();
      return;
    }
  }
  
  saveChats();
  renderChatHistory();
  loadCurrentChat();
}
// New chat button
newChatBtn.addEventListener("click", createNewChat);

// Form submission
form.addEventListener("submit", async e => {
  e.preventDefault();

  const text = input.value;
  input.value = "";

  let chat = getCurrentChat();
  if (!chat) {
    // first interaction – create a chat on demand
    createNewChat();
    chat = getCurrentChat();
  }

  addMessage(text, "user");

  // Build messages array with PDF context if available
  let contextMessages = [...chat.messages];
  if (pdfContext) {
    // Add PDF context to the last user message
    const lastMsg = contextMessages[contextMessages.length - 1];
    if (lastMsg.role === "user") {
      lastMsg.content += `\n\n[PDF Document: ${pdfContext.filename}]\n${pdfContext.text}`;
    }
  }

  const res = await fetch("/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: contextMessages })
  });

  const data = await res.json();

  if (!data.choices) {
    console.error("API error:", data);
    addMessage("Error: check console", "ai");
    return;
  }

  const reply = data.choices[0].message.content;
  addMessage(reply, "ai");
  
  // Clear PDF context after sending
  pdfContext = null;
});

// Submit form on Enter
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (typeof form.requestSubmit === "function") {
      form.requestSubmit();
    } else {
      form.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  }
});

// Event delegation for chat history (added once after functions defined)
chatHistory.addEventListener("click", (e) => {
  const chatItem = e.target.closest(".chat-item");
  if (!chatItem) return;
  
  const chatId = chatItem.dataset.chatId;
  
  if (e.target.classList.contains("chat-item-delete")) {
    e.stopPropagation();
    deleteChat(chatId);
  } else {
    switchChat(chatId);
  }
});

// Sidebar toggle
const sidebar = document.querySelector('.sidebar');
const sidebarToggle = document.getElementById('sidebarToggle');

function setSidebarCollapsed(collapsed) {
  if (collapsed) {
    sidebar.classList.add('collapsed');
    sidebarToggle.setAttribute('aria-label', 'Show sidebar');
    sidebarToggle.setAttribute('aria-expanded', 'false');
  } else {
    sidebar.classList.remove('collapsed');
    sidebarToggle.setAttribute('aria-label', 'Hide sidebar');
    sidebarToggle.setAttribute('aria-expanded', 'true');
  }
  localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0');
}

sidebarToggle.addEventListener('click', () => {
  const collapsed = sidebar.classList.contains('collapsed');
  setSidebarCollapsed(!collapsed);
});

// PDF Upload functionality
uploadBtn.addEventListener("click", () => {
  pdfInput.click();
});

pdfInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  
  // Validate file type
  if (file.type !== "application/pdf") {
    uploadStatus.textContent = "❌ Please select a valid PDF file";
    uploadStatus.className = "upload-status error";
    setTimeout(() => {
      uploadStatus.textContent = "";
      uploadStatus.className = "upload-status";
    }, 3000);
    return;
  }
  
  // Validate file size (max 10MB)
  const maxSize = 10 * 1024 * 1024;
  if (file.size > maxSize) {
    uploadStatus.textContent = "❌ File too large (max 10MB)";
    uploadStatus.className = "upload-status error";
    setTimeout(() => {
      uploadStatus.textContent = "";
      uploadStatus.className = "upload-status";
    }, 3000);
    return;
  }
  
  // Upload file to server
  uploadStatus.textContent = "⏳ Extracting PDF...";
  uploadStatus.className = "upload-status";
  
  try {
    const formData = new FormData();
    formData.append("pdf", file);
    
    const res = await fetch("/upload-pdf", {
      method: "POST",
      body: formData
    });
    
    const data = await res.json();
    
    if (!res.ok) {
      throw new Error(data.error || "Failed to extract PDF");
    }
    
    // Store PDF context
    pdfContext = {
      filename: data.filename,
      text: data.text,
      pageCount: data.pageCount
    };
    
    selectedFile = file;
    uploadStatus.textContent = `✓ PDF loaded: ${file.name} (${data.pageCount} pages)`;
    uploadStatus.className = "upload-status success";
    
    // Clear selection after 5 seconds
    setTimeout(() => {
      uploadStatus.textContent = "";
      uploadStatus.className = "upload-status";
      pdfInput.value = "";
    }, 5000);
  } catch (err) {
    console.error("PDF upload error:", err);
    uploadStatus.textContent = `❌ ${err.message}`;
    uploadStatus.className = "upload-status error";
    setTimeout(() => {
      uploadStatus.textContent = "";
      uploadStatus.className = "upload-status";
      pdfInput.value = "";
    }, 3000);
  }
});

// Initialize on page load and enrich missing titles
loadChats();
(async () => {
  if (chats.length) {
    // Enrich titles for chats that still have default names
    const toUpdate = chats.filter(c => !c.name || c.name === 'New chat');
    for (const c of toUpdate) {
      // await so we don't hammer the API if many chats exist
      // updateChatTitle will save/render as needed
      // eslint-disable-next-line no-await-in-loop
      await updateChatTitle(c);
    }
  }

  renderChatHistory();
  loadCurrentChat();
})();

// Restore sidebar state
const savedSidebar = localStorage.getItem('sidebarCollapsed');
if (savedSidebar === '1') setSidebarCollapsed(true);
