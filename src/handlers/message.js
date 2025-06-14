/* ========= 既有 import、client 建立保持原樣 ========= */
// ︙你原本的 import / client 相關程式碼

/* ========= 新增：handler 匯入 ========= */
/* 若路徑不同，請自行調整 */
import {
  handleStart,
  handleReview,
  handleAddNote,
} from './handlers/interaction.js';

/* ========= 指令名稱 ➜ Handler Map ========= */
const handlers = new Map([
  ['start',   handleStart],
  ['review',  handleReview],
  ['addnote', handleAddNote],
]);

/* ========= 唯一的 interactionCreate 監聽器 ========= */
client.on('interactionCreate', async (interaction) => {
  /* 只處理 Slash 指令（ChatInputCommand） */
  if (!interaction.isChatInputCommand()) return;

  try {
    /* ❶ 3 秒內一次性 defer（私密訊息） */
    await interaction.deferReply({ ephemeral: true });

    /* ❷ 依指令名稱路由 */
    const fn = handlers.get(interaction.commandName);
    if (!fn) {
      await interaction.editReply('⚠️ 指令未實作');
      return;
    }

    /* ❸ 執行真正邏輯（可量測耗時） */
    console.time(`${interaction.commandName}-handler`);
    await fn(interaction, client);
    console.timeEnd(`${interaction.commandName}-handler`);

  } catch (err) {
    console.error('[InteractionCreate 錯誤]', err);
    /* 已 defer，安全 editReply 做保底訊息 */
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply('❌ 執行失敗，請稍後再試。');
    }
  }
});

/* ========= 其餘程式（登入、其他事件…）保持原樣 ========= */
// ︙你原本的 client.login(...)、ready 事件等
