<div align="center">

<img src="assets/bot_image.jpg" alt="JNR-MD V-2.0" width="320"/>

# 🫧 JNR-MD V-2.0 🔥

### Multi-Device WhatsApp Bot · Group Management · AI · Downloads · Business Assistant

<a href="https://github.com/jnrnkanu-md/JNR-MD/fork"><img src="https://img.shields.io/badge/Fork-Repository-6c3fc4?style=for-the-badge&logo=github" alt="Fork"/></a>
<a href="https://whatsapp.com/channel/0029VbCxwJeEgGfFhMx4zg3q"><img src="https://img.shields.io/badge/Join-WhatsApp%20Channel-25D366?style=for-the-badge&logo=whatsapp&logoColor=white" alt="Join the channel"/></a>

<img src="https://img.shields.io/badge/version-V--2.0-6c3fc4?style=flat-square" alt="Version"/>
<img src="https://img.shields.io/badge/node-%E2%89%A5%2018-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node"/>
<img src="https://img.shields.io/badge/library-Baileys-0b5fff?style=flat-square" alt="Baileys"/>
<img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License"/>
<img src="https://img.shields.io/github/stars/jnrnkanu-md/JNR-MD?style=flat-square&label=stars" alt="Stars"/>
<img src="https://img.shields.io/github/forks/jnrnkanu-md/JNR-MD?style=flat-square&label=forks" alt="Forks"/>

**Made by Jnr Nkanu Concepts**

</div>

---

## 📑 Contents

[✨ What's new in V-2.0](#-whats-new-in-v-20) · [🚀 Quick start](#-quick-start) · [⚙️ Configuration](#️-configuration) · [📚 Commands](#-commands) · [🧠 AI, agent & away mode](#-ai-chat-agent--away-mode) · [🛡️ Group tools](#️-group-tools) · [📥 Downloads](#-downloads) · [🗂️ Project structure](#️-project-structure) · [🛠️ Troubleshooting](#️-troubleshooting) · [📄 License & legal](#-license--legal)

---

## ✨ What's new in V-2.0

| | Feature | What it does |
|---|---|---|
| 🗂️ | **Two-level menu** | `.menu` shows the menu list, then `.group menu`, `.ai menu`, `.download menu`… show each menu's commands. `.allmenu` shows everything |
| 🔐 | **Group verification** | Only verified members can post. Unverified messages are deleted and the member is tagged to get verified |
| 👋 | **Picture welcome** | New members get their profile picture, a tag and your own customizable message |
| 🧑‍💼 | **Chat agent** | A business assistant you teach about your brand, so it talks to customers privately and properly |
| 🌙 | **Away mode** | Replies to private messages in your own writing style while you are away |
| 🤖 | **Groq AI** | `.ai`, `.gemini`, `.gpt`… and `.chatbot` all run on your own free Groq key |
| 📇 | **Group `.vcf`** | A contact file with only that group's members |
| 📣 | **`.tagall` for everyone** | Works for non-admins, and the bot does not need to be admin |
| 📲 | **`.tostatus`** | Post an image, video or text to your status by replying to it |
| 📥 | **Stronger downloaders** | YouTube, TikTok and Facebook each try several servers automatically |
| 🎨 | **New look** | Clear bold fonts, redesigned `.ping`, a welcoming connected message and a footer on every response |

---

## 🚀 Quick start

### Requirements
- Node.js 18 or newer
- A WhatsApp number to link (pair code or QR code)

### Install and run

```bash
git clone https://github.com/jnrnkanu-md/JNR-MD.git
cd JNR-MD
npm install
npm start
```

On the first start the bot shows a **pair code** (or QR code). In WhatsApp go to **Linked devices → Link a device** and enter it. When it connects, the bot sends a **"Bot connected successfully"** message to its own chat.

### Deploy on a panel or VPS

<div align="center">

<a href="https://dashboard.katabump.com/auth/login#d6b7d6"><img src="https://img.shields.io/badge/Katabump-D6B7D6?style=for-the-badge&logo=server&logoColor=black" alt="Katabump"/></a>
<a href="https://bot-hosting.net/?aff=1068419752923508776"><img src="https://img.shields.io/badge/Bot%20Hosting-28a745?style=for-the-badge" alt="Bot hosting"/></a>
<a href="https://client.petrosky.io/aff.php?aff=394"><img src="https://img.shields.io/badge/Petrosky%20VPS-0078E7?style=for-the-badge" alt="Petrosky VPS"/></a>

</div>

On a panel, upload the files, run `npm install`, and set the start command to `npm start`. **Keep the `data` and `session` folders between restarts**, because they hold your settings and your WhatsApp login.

---

## ⚙️ Configuration

**1. `.env` (AI key)**

Open the `.env` file in the main folder and paste your free key from [console.groq.com/keys](https://console.groq.com/keys) after the `=`:

```env
GROQ_API_KEY=
FAL_KEY=
```

Restart the bot. The Groq key powers `.ai`, `.chatbot`, `.agent`, voice notes to text and away mode. For `.sora` (text to video) also paste your key from [fal.ai](https://fal.ai) after `FAL_KEY=`.

**2. `settings.js` (your identity)**

Set your owner number (digits only, with country code), owner name, bot name and prefix. The default prefix is `.`.

---

## 📚 Commands

Send **`.menu`** in WhatsApp. It sends a welcome card and the list of menus:

| Menu | Opens with | Inside |
|---|---|---|
| General | `.general menu` | ping, alive, tts, weather, news, lyrics, jokes… |
| Group | `.group menu` | ban, kick, warn, tagall, welcome, verification… |
| Admin (owner) | `.admin menu` | mode, settings, away mode, tostatus… |
| AI | `.ai menu` | AI chat, image prompts, chat agent |
| Download | `.download menu` | YouTube, TikTok, Facebook, Instagram, Spotify |
| Sticker | `.sticker menu` | stickers, crop, blur, remove background |
| Text | `.text menu` | text effects |
| Game | `.game menu` | tic-tac-toe, hangman, trivia |
| Fun | `.fun menu` | photo effects, social fun, pies |
| Anime | `.anime menu` | anime pictures and quotes |
| Adult | `.adult menu` | 18+ only |

`.allmenu` lists every menu and command in one go.

---

## 🧠 AI, chat agent & away mode

**AI:** `.ai` `.ask` `.gpt` `.chatgpt` `.gemini` `.llama` `.groq` followed by your question. If a model is not available for your key, the bot switches to one that is.

**Voice notes to text:** reply to a voice note with `.stt` (add a language like `.stt yo`, or `.stt translate` for English). When you use it inside a private chat, the text goes to your own chat so the other person sees nothing. `.stt auto on` (owner) turns every voice note people send you privately into text automatically.

**Chat agent (business assistant, owner):** teach it your business and it talks to customers like a trained team member.

```text
.agent business Jnr Nkanu Concepts
.agent tone Friendly, professional, short replies
.agent teach Bot activation costs NGN 3,000
.agent faq How long is delivery? | Same day after payment.
.agent greeting Hello {name}! How can we help you today?
.agent all on
```

It answers only from what you taught it. When it cannot help, or a customer asks for you, it tells them your team will follow up and sends you a private alert. Send `.agent` for the full guide, `.agent show` to see what it knows.

**Away mode (owner):** `.away on [message]` turns it on and `.away off` turns it off. It replies to private messages in your writing style, learned from your own messages (`.mystyle show`, `.mystyle clear`). It pauses in a chat when you write there yourself, never promises anything and avoids money topics. Limit it to chosen people with `.away allow <number>`.

---

## 🛡️ Group tools

| Command | What it does |
|---|---|
| `.safety on/off` | Strong scan of links, scam messages, files, pictures, stickers and videos. Dangerous ones are removed in groups, and you are warned in private chats. `.safety status` shows what your Groq key can do, `.safety level strict/normal` sets how strict it is, `.scan` checks something on demand |
| `.verification on/off` | Only verified members can post (admins are never checked) |
| `.verify +2349137495210` · `.unverify <number>` · `.verified` | Verify, remove and list members |
| `.welcome on/off/set/reset/preview` | Picture welcome. Variables: `{user}` `{group}` `{description}` `{count}` `{verify}` |
| `.tagall` | Tags everyone. Members wait 60 seconds between uses |
| `.vcf` (admins) | Contact file with only this group's members, each name tagged 🫧ᴶᴺᴿ⁻ᴹᴰ🔥 |
| `.antilink` `.antibadword` `.antitag` | Group protection |
| `.ban` `.kick` `.warn` `.mute` `.promote` `.demote` | Member management |
| `.adminalert on/off` | Promote and demote announcements (off by default) |
| `.tostatus` | Reply to an image, video or text to post it to your status (owner) |

The bot needs to be a group **admin** to delete messages, remove members or change group settings.

---

## 📥 Downloads

| Command | Source |
|---|---|
| `.yt` `.video` `.ytmp4` `<name or link>` | YouTube video |
| `.play` `.song` `.mp3` `<name>` | YouTube audio |
| `.tiktok` / `.tt` `<link>` | TikTok |
| `.fb` / `.facebook` `<link>` | Facebook video |
| `.x` / `.twitter` `<link>` | X (Twitter) videos, GIFs and photos |
| `.instagram` / `.ig` `<link>` | Instagram |
| `.spotify` `<query>` | Spotify |

The downloaders use free public servers and try several of them in turn. If one fails, the console lists the reason for each server.

---

## 🗂️ Project structure

```text
JNR-MD/
├── index.js        # start file: connects to WhatsApp
├── main.js         # reads every message and runs commands
├── settings.js     # owner, bot name, prefix, version
├── .env            # your Groq key (never share it)
├── commands/       # one file per command or feature
├── lib/            # shared helpers (AI, styling, names, menus)
├── assets/         # bot image and media
└── data/           # saved settings (keep it between restarts)
```

---

## 🛠️ Troubleshooting

| Problem | Fix |
|---|---|
| `.ai` says it is not set up | Paste your key after `GROQ_API_KEY=` in `.env`, then restart |
| AI says no model is available | In the Groq console, make sure your project can use a chat model |
| Verification or delete features do nothing | Make the bot a group admin |
| A download fails | Try again in a few minutes. Read the console lines for the reason of each server |
| Settings reset after a restart | Your host is not keeping the `data` folder |
| The bot logged out | Delete the `session` folder, restart and link again |

---

## ☕ Support

<div align="center">

<a href="https://buymeacoffee.com/bigbosssunzy" target="_blank"><img src="https://img.shields.io/badge/Buy%20Me%20a%20Coffee-Support%20Developer-FF813F?style=for-the-badge&logo=buy-me-a-coffee&logoColor=white" alt="Buy me a coffee"/></a>

</div>

If this project helps you, give it a ⭐ on [GitHub](https://github.com/jnrnkanu-md/JNR-MD). Ideas and bug reports are welcome on the [issues page](https://github.com/jnrnkanu-md/JNR-MD/issues).

**Developer:** Nkanu Onnoghen Nkanu · Instagram: Jnr Nkanu Concepts

---

## 📄 License & legal

Released under the [MIT License](https://opensource.org/licenses/MIT). Keep the original license and copyright notices and credit the original authors.

- This is an independent, unofficial project. It is **not** affiliated with, authorized, maintained, sponsored or endorsed by WhatsApp or any of its affiliates.
- Using a bot on WhatsApp can lead to your number being banned. Use it at your own risk.
- Do not use it to spam, send bulk messages or for anything illegal. The developers are not responsible for misuse or damage.
- Built on [Baileys](https://github.com/WhiskeySockets/Baileys) (MIT) and the libraries listed in `package.json`.

<div align="center">

**© Jnr Nkanu Concepts 2026**

</div>
