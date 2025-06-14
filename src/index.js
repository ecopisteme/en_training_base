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
import handleMessage from './handlers/message.js';


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

client.on('interactionCreate', async inter => {
  if (!inter.isCommand()) return;
  if (inter.commandName === 'start') {
    await handleStart(inter, client);
    // start 完成後，再把剛創建好的頻道更新到 Map  
    const profileId = await handleStart(inter, client);
// 再根據 profileId 從 user_channels 抓頻道 ID，塞給 channelMap

    const userId = inter.user.id;
    const uc     = await supabase
      .from('user_channels')
      .select('vocab_channel_id, reading_channel_id')
      .eq('profile_id', /* 先前 handleStart 得到的 profileId */)
      .single();
    channelMap.set(userId, {
      vocab:   uc.data.vocab_channel_id,
      reading: uc.data.reading_channel_id
    });
  }
});
//messageCreate
client.on('messageCreate', message => handleMessage(message, client, channelMap));


//interactionCreate
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;
  if (interaction.commandName === 'start') {
    return handleStart(interaction, client);
  }
  if (interaction.commandName === 'review') {
    return handleReview(interaction);
  }
  if (interaction.commandName === 'addnote') {
    return handleAddNote(interaction, client);
  }
});


client.login(process.env.DISCORD_TOKEN);
