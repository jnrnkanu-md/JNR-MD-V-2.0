const settings = {
  prefix: ".", // 👈 This stays as a property inside the object
  packname: 'JNR-MD',
  author: '‎',
  botName: "🫧 JNR-MD V-2.0🔥",
  botOwner: 'JNR NKANU™',
  ownerNumber: '2349137495210',
  giphyApiKey: 'qnl7ssQChTdPjsKta2Ax2LMaGXz303tq',
  commandMode: "public",
  maxMessageAgeSeconds: 90, // messages older than this are ignored (stops old commands running again after a restart)
  maxStoreMessages: 20, 
  storeWriteInterval: 30000,
  description: "This is a bot for managing group commands and automating tasks.",
  version: "V-2.0",
  updateZipUrl: "https://github.com/jnrnkanu-md/JNR-MD-V-2.0/archive/refs/heads/main.zip",
};

// 👇 ADD THIS LINE HERE (Outside the curly braces)
global.prefix = settings.prefix; 

module.exports = settings;
