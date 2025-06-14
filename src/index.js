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
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
import { handleStart, handleReview, handleAddNote } from './handlers/interaction.js';
import  { handleMessage } from './handlers/message.js';


const client = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.MessageContent,
  ]
});

const channelMap = new Map();   // <discord_id, { vocab: channelId, reading: channelId }>

client.once('ready', async () => {
  console.log(`已登入 ${client.user.tag}`);
  // （可選）啟動時把所有已註冊的使用者載入 Map
  const { data: list } = await supabase
    .from('user_channels')
    .select('profile_id, vocab_channel_id, reading_channel_id, profiles(discord_id)')
    .order('profile_id');
  for (const row of list) {
    channelMap.set(
      row.profiles.discord_id,
      { vocab: row.vocab_channel_id, reading: row.reading_channel_id }
    );
  }
});

//messageCreate
client.on('messageCreate', message => handleMessage(message, client, channelMap));


//interactionCreate
  // 只保留「一個」 InteractionCreate 監聽器
client.on('interactionCreate', async (interaction) => {
  // 只處理 Slash 指令
  if (!interaction.isChatInputCommand()) return;

  try {
    /* ❶ 3 秒內先 defer，一次就好 */
    await interaction.deferReply({ ephemeral: true });

    /* ❷ 根據指令名稱路由到對應 handler */
    switch (interaction.commandName) {
      case 'start':
        await handleStart(interaction, client);
        break;

      case 'review':
        await handleReview(interaction, client);
        break;

      case 'addnote':
        await handleAddNote(interaction, client);
        break;

      default:
        await interaction.editReply('⚠️ 未實作的指令');
    }

  } catch (err) {
    console.error('[InteractionCreate 錯誤]', err);

    // 已經 defer 過，安全地 editReply
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply('❌ 執行失敗，請稍後再試。');
    }
  }
});                  

client.login(process.env.DISCORD_TOKEN);
