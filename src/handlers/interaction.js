// src/index.js（或你主程式的檔案）
import { Client, IntentsBitField } from 'discord.js';
import dotenv from 'dotenv';

// 把所有 handler 都 import 進來
import prompts       from '../prompts.js';


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

// —— 1️⃣ 處理 Slash Commands —— 
client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  switch (interaction.commandName) {
    case 'start':
      // /start 要建立頻道、upsert profiles、存 user_channels
      return handleStart(interaction, client);

    case 'review':
      // /review 要讀取所有 vocabulary + reading_history
      return handleReview(interaction, client);

    case 'addnote':
      // /addnote source & note
      return handleAddNote(interaction, client);

    // 如果以後要新增 /addvocab、/plan、/quiz...，都可以在這裡接
    default:
      return;
  }
});

// —— 2️⃣ 處理文字訊息（私人頻道路由）—— 
client.on('messageCreate', async message => {
  // 全部都交給你的 message handler
  await handleMessage(message, client);
});

client.login(process.env.DISCORD_TOKEN);

/** 處理 /start 指令 */
export async function handleStart(interaction, client) {
  await interaction.deferReply({ ephemeral: true });
  try {
    // …你現有的 upsert profiles + 建頻道邏輯…
    return interaction.followUp({
      content: "✅ /start 完成！",
      ephemeral: true
    });
  } catch (e) {
    console.error("[handleStart]", e);
    return interaction.followUp({
      content: `❌ /start 失敗：${e.message}`,
      ephemeral: true
    });
  }
}


/**
 * 處理 /addnote 指令
 */
export async function handleAddNote(interaction, client) {
  await interaction.deferReply({ ephemeral: true });
  try {
    const source = interaction.options.getString('source');
    const note   = interaction.options.getString('note');
    // 1️⃣ 先拿 profileId
    const { data: prof, error: pe } = await supabase
      .from('profiles')
      .select('id')
      .eq('discord_id', interaction.user.id)
      .single();
    if (pe || !prof) throw new Error('請先 /start 註冊');
    const profileId = prof.id;
    // 2️⃣ 寫入 reading_history
    await supabase.from('reading_history').insert([{
      user_id: profileId,
      source,
      note
    }]);
    // 3️⃣ 回覆
    return interaction.followUp({
      content: `✍️ 已記錄閱讀筆記：\n> ${note}\n來源：${source}`,
      ephemeral: true
    });
  } catch (e) {
    console.error('[handleAddNote]', e);
    return interaction.followUp({
      content: `❌ /addnote 失敗：${e.message}`,
      ephemeral: true
    });
  }
}

/**
 * /review 指令
 */
export async function handleReview(interaction, client) {
  await interaction.deferReply({ ephemeral: true });
  // …你原本的 review_history 邏輯全搬過來…
  return interaction.followUp('📝 這裡是你的複習列表');
}
