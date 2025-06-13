// src/index.js

// 讓 Render 正常啟動（若不需要 HTTP 回應，可改成 background worker）
import http from 'http';
const port = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('OK');
}).listen(port, () => {
  console.log(`Listening on port ${port}`);
});

// Discord.js + handler imports
import { Client, IntentsBitField } from 'discord.js';
import { handleStart, handleReview, handleAddNote } from './handlers/interaction.js';
import handleMessage from './handlers/message.js';

import dotenv from 'dotenv';
dotenv.config();

const client = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.MessageContent,
  ]
});

client.once('ready', () => {
  console.log(`Bot 已上線：${client.user.tag}`);
});

// Slash commands 回覆
client.on('interactionCreate', async inter => {
  if (!inter.isCommand()) return;

  switch (inter.commandName) {
    case 'start':
      return handleStart(inter, client);
    case 'review':
      return handleReview(inter);
    case 'addnote':
      return handleAddNote(inter);
    default:
      return;
  }
});

// 文字訊息事件
client.on('messageCreate', message => {
  handleMessage(message, client);
});

client.login(process.env.DISCORD_TOKEN);
