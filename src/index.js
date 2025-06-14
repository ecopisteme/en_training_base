// ------ keep Render happy ------
import http from 'http';
const port = process.env.PORT || 3000;      // Render 會給 PORT
http.createServer((_, res) => res.end('ok')).listen(port);
// --------------------------------

/* ---------- 既有第三方 import，保留你原本的 ---------- */
import { Client, GatewayIntentBits, Events } from 'discord.js';
import * as dotenv from 'dotenv';
dotenv.config();

/* ---------- 建立 Discord Client ---------- */
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

/* ---------- 快取：userId ➜ { vocab, reading } ---------- */
const channelMap = new Map();

/* ---------- 匯入 Slash 指令 Handler ---------- */
import {
  handleStart,
  handleAddNote,          // 如果 interaction.js 有這支指令
} from './handlers/interaction.js';

import { handleReview }  from './handlers/review.js';
import { handleVocab }   from './handlers/vocab.js';
import { handleReading } from './handlers/reading.js';

/* ---------- 匯入文字訊息 Handler ---------- */
import { handleMessage } from './handlers/message.js';

/* ---------- 指令名稱 ➜ Handler Map ---------- */
const handlers = new Map([
  ['start',   handleStart],
  ['addnote', handleAddNote],
  ['review',  handleReview],
]);

/* ---------- Bot 上線時先載入舊的 channelMap ---------- */
client.once(Events.ClientReady, async () => {
  console.log(`🤖 ${client.user.tag} 已上線`);
  // TODO: 若需要，從資料庫 preload userId ➜ vocab/reading channelId
});

/* ---------- 唯一的 interactionCreate 監聽器 ---------- */
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    // ❶ 3 秒內私密 defer
    await interaction.deferReply({ ephemeral: true });

    // ❷ 依指令路由
    const fn = handlers.get(interaction.commandName);
    if (!fn) {
      await interaction.editReply('⚠️ 指令未實作');
      return;
    }

    // ❸ 執行 handler（把 channelMap 傳進去）
    await fn(interaction, client, channelMap);

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
