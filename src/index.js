// src/index.js

// ------ keep Render happy ------
import http from 'http';
const port = process.env.PORT || 3000;      // Render 會給 PORT
http.createServer((_, res) => res.end('ok')).listen(port);
// --------------------------------

import { Client, GatewayIntentBits, Events } from 'discord.js';
import * as dotenv from 'dotenv';
dotenv.config();

import { supabase } from './lib/clients.js';

/* ---------- 建立 Discord Client ---------- */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ]
});

/* ---------- 快取：userId ➜ { vocab, reading } ---------- */
const channelMap = new Map();

/* ---------- 匯入 Slash 指令 Handler ---------- */
import { handleStart, handleAddNote } from './handlers/interaction.js';
import { handleReview }  from './handlers/review.js';
import { handleVocab }   from './handlers/vocab.js';
import { handleReading } from './handlers/reading.js';

/* ---------- 匯入文字訊息 Handler ---------- */
import { handleMessage } from './handlers/message.js';

/* ---------- 指令名稱 ➜ Handler Map ---------- */
const handlers = new Map([
  ['addnote', handleAddNote],
  ['review',  handleReview],
]);

/* ---------- Bot 上線時先載入舊的 channelMap ---------- */
client.once(Events.ClientReady, async () => {
  console.log(`🤖 ${client.user.tag} 已上線`);
  try {
    const { data, error } = await supabase
      .from('user_channels')
      .select('discord_id, vocab_channel, reading_channel');

    if (error) throw error;

    for (const row of data) {
      channelMap.set(row.discord_id, {
        vocab:   row.vocab_channel,
        reading: row.reading_channel,
      });
    }
    console.log(`[preload] 已載入 ${channelMap.size} 位用戶的私人頻道對映`);
  } catch (e) {
    console.error('[preload channelMap 失敗]', e);
  }
});

/* ---------- 唯一的 interactionCreate 監聽器 ---------- */
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    // ❶ 全部指令都 defer
    await interaction.deferReply({ ephemeral: true });

    const cmd = interaction.commandName;

    if (cmd === 'start') {
      // /start 特殊：建立頻道、寫 DB、更新快取、回覆
      const { vocabChannel, readingChannel } = await handleStart(interaction, client);

      // upsert 到 Supabase
      await supabase
        .from('user_channels')
        .upsert({
          discord_id:      interaction.user.id,
          vocab_channel:   vocabChannel,
          reading_channel: readingChannel,
        });

      // 更新快取
      channelMap.set(interaction.user.id, {
        vocab:   vocabChannel,
        reading: readingChannel,
      });

      await interaction.editReply(
        `✅ 已建立私人訓練頻道：\n` +
        `- 詞彙累積 → <#${vocabChannel}>\n` +
        `- 閱讀筆記 → <#${readingChannel}>`
      );
      return;
    }

    // 其它 Slash Command
    const handler = handlers.get(cmd);
    if (!handler) {
      await interaction.editReply('⚠️ 指令未實作');
      return;
    }
    await handler(interaction, client, channelMap);

  } catch (err) {
    console.error('[InteractionCreate 錯誤]', err);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply('❌ 執行失敗，請稍後再試。');
    }
  }
});

/* ---------- 文字訊息監聽器 ---------- */
client.on(Events.MessageCreate, msg => handleMessage(msg, client, channelMap));

/* ---------- 登入 ---------- */
client.login(process.env.DISCORD_TOKEN);
