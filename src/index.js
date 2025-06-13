// src/index.js
import dotenv from "dotenv";
dotenv.config();

// ———————— Health Check 服务器 ————————
// 只有在部署环境 (Render 等) 有 PORT 时才启动；本地开发跳过，避免端口冲突

// 1. 在文件顶部引入 http
import http from 'http';

// 2. 只有在部署环境（有 PORT）时才启动 Health Check
if (process.env.PORT) {
  const port = Number(process.env.PORT);

  const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('OK');
  });

  server.listen(port);
  server.on('listening', () => {
    console.log(`🩺 Health server listening on port ${port}`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`⚠️  Port ${port} in use, skipping health server`);
    } else {
      throw err;
    }
  });
}

// Discord.js + handler imports
import { Client, IntentsBitField } from 'discord.js';
import { handleStart, handleReview, handleAddNote } from './handlers/interaction.js';
import handleMessage from './handlers/message.js';


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
