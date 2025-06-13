// src/index.js

// 1️⃣ Discord.js 合併 import：只宣告一次 Client，並加入 ChannelType
import { Client, IntentsBitField, ChannelType } from 'discord.js';

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { OpenAI } from 'openai';
import prompts from './prompts.js';

dotenv.config();

// 2️⃣ 初始化 Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// 3️⃣ 初始化 OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 4️⃣ 建立 Discord Client
const client = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.MessageContent,
    IntentsBitField.Flags.GuildMembers
  ]
});

// 5️⃣ Ready 事件
client.once('ready', () => {
  console.log(`已登入 Discord：${client.user.tag}`);
});

// …下面接你原本的 interactionCreate 與 messageCreate 處理器，不需要再重複 import Client 或 ChannelType…


// ——————————————————————————
//  /start 指令：註冊、創建私密頻道，並寫入 user_channels
// ——————————————————————————

// … 其它 import 如 dotenv、supabase client 等 …

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand() || interaction.commandName !== 'start') return;
  await interaction.deferReply({ ephemeral: true });

  try {
    // 取得 Guild
    const guild = interaction.guild;

    // 0️⃣ Upsert 使用者到 profiles，並立即 select 出唯一的 id
    const { data: profile, error: pErr } = await supabase
      .from('profiles')
      .upsert(
        { discord_id: interaction.user.id, username: interaction.user.username },
        { onConflict: 'discord_id', returning: 'minimal' }
      )
      .select('id')
      .single();
    if (pErr || !profile) throw new Error('無法取得或寫入 profile');
    const profileId = profile.id;

    // 1️⃣ 檢查 user_channels 是否已有記錄，且兩個頻道仍存在
    const { data: uc } = await supabase
      .from('user_channels')
      .select('vocab_channel_id,reading_channel_id')
      .eq('profile_id', profileId)
      .single();

    if (uc?.vocab_channel_id && uc?.reading_channel_id) {
      const [vExist, rExist] = await Promise.all([
        guild.channels.fetch(uc.vocab_channel_id).then(() => true).catch(() => false),
        guild.channels.fetch(uc.reading_channel_id).then(() => true).catch(() => false)
      ]);
      if (vExist && rExist) {
        return interaction.followUp({
          content: `✅ 你已經有專屬頻道：\n• 詞彙查詢 → <#${uc.vocab_channel_id}>\n• 閱讀筆記 → <#${uc.reading_channel_id}>`,
          ephemeral: true
        });
      }
    }

    // 2️⃣ 取得或建立 Category
    let category = guild.channels.cache.find(c =>
      c.name === '學習私密頻道' && c.type === ChannelType.GuildCategory
    );
    if (!category) {
      category = await guild.channels.create({
        name: '學習私密頻道',
        type: ChannelType.GuildCategory
      });
    }

    // 3️⃣ 權限覆蓋：僅自己與 Bot（與管理員，可選）可見
    const overwrites = [
      { id: guild.roles.everyone, deny: ['ViewChannel'] },
      { id: interaction.user.id,   allow: ['ViewChannel','SendMessages','ReadMessageHistory'] },
      { id: client.user.id,        allow: ['ViewChannel','SendMessages'] },
      // 如需讓管理員也可見，取消下方註解並填入管理員 Role ID
      // { id: process.env.ADMIN_ROLE_ID, allow: ['ViewChannel','SendMessages'] },
    ];

    // 4️⃣ 建立私密文字頻道
    const vocabChan = await guild.channels.create({
      name: `vocab-${interaction.user.username}`,
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: overwrites
    });
    const readingChan = await guild.channels.create({
      name: `reading-${interaction.user.username}`,
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: overwrites
    });

    // 5️⃣ 將頻道 ID 寫入或更新 user_channels
    await supabase.from('user_channels').upsert(
      {
        profile_id:         profileId,
        vocab_channel_id:   vocabChan.id,
        reading_channel_id: readingChan.id
      },
      { onConflict: 'profile_id' }
    );

    // 6️⃣ 回覆使用者
    await interaction.followUp({
      content:
        `✅ 已為你創建私密學習頻道：\n` +
        `• 詞彙查詢 → ${vocabChan}\n` +
        `• 閱讀筆記 → ${readingChan}`,
      ephemeral: true
    });

  } catch (err) {
    console.error('[ /start 處理失敗 ]', err);
    await interaction.followUp({
      content: `❌ 註冊或頻道建立失敗：${err.message}`,
      ephemeral: true
    });
  }
});




// ——————————————————————————
//  messageCreate：根據頻道路由到對應邏輯
// ——————————————————————————
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  const userDiscordId = message.author.id;
  const text = message.content.trim();

  // 快捷「複習」指令
  if (/複[習習]/.test(text)) {
    const { data: profile, error: pe } = await supabase
      .from("profiles")
      .select("id")
      .eq("discord_id", userDiscordId)
      .single();
    if (pe || !profile) {
      return message.reply("❌ 系統錯誤：請先使用 /start 註冊");
    }
    const profileId = profile.id;

    const { data: vocs } = await supabase
      .from("vocabulary")
      .select("word,source,page")
      .eq("user_id", profileId)
      .order("created_at");
    const { data: reads } = await supabase
      .from("reading_history")
      .select("source,note")
      .eq("user_id", profileId)
      .order("created_at");

    let out = "";
    if (vocs.length) {
      out += "📚 **詞彙列表**\n" +
        vocs.map((v,i) => `${i+1}. ${v.word} (${v.source}${v.page? ` 第${v.page}頁` : ""})`).join("\n");
    }
    if (reads.length) {
      out += (out? "\n\n" : "") + "✍️ **閱讀筆記**\n" +
        reads.map((r,i) => `${i+1}. ${r.source}：${r.note}`).join("\n");
    }
    if (!vocs.length && !reads.length) {
      out = "目前尚無任何學習紀錄。";
    }
    return message.reply(out);
  }

  // 呼叫 GPT，啟用 Function Calling
  let resp;
  try {
    resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `你是學習記錄助手。
只要偵測到「讀」「書」「第…頁」等閱讀提示，且抓到英文單字，就：
1. 產出 type="vocab"，填 term、source、page。
2. 產出 type="reading"，note 一定填「冒號後的完整句子」。
若僅抓到單字，則只產出 vocab。
若使用者說「複習」則呼叫 review_history()。
回傳時僅輸出 function_call，勿其他文字。`
        },
        { role: "user", content: text }
      ],
      functions,
      function_call: "auto",
      temperature: 0
    });
  } catch (err) {
    console.error("[呼叫 GPT 失敗]", err);
    return;
  }

  const msg = resp.choices[0].message;
  const callName = msg.function_call?.name || msg.tool_calls?.[0]?.name;
  const callArgs = msg.function_call?.arguments || msg.tool_calls?.[0]?.arguments;

  // 取得 profileId
  const { data: profile2, error: pe2 } = await supabase
    .from("profiles")
    .select("id")
    .eq("discord_id", userDiscordId)
    .single();
  if (pe2 || !profile2) {
    console.error("[取得 UUID 失敗]", pe2);
    return message.reply("❌ 系統錯誤：請先使用 /start 註冊");
  }
  const profileId = profile2.id;

  // 處理 record_actions
  if (callName === "record_actions") {
    const acts = JSON.parse(callArgs || "{}").actions || [];
    console.log("👉 record_actions 收到的 acts：", acts);

    const replies = [];

    // 處理 vocab
    for (const a of acts.filter(i => i.type === "vocab")) {
      const term = a.term;
      const src  = a.source || "unknown";
      const pg   = a.page   || "unknown";

      let fullDef = "";
      try {
        const vRes = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: prompts.VOCAB },
            { role: "user",   content: `Word: ${term}\nContext: ${src}, page ${pg}` }
          ],
          temperature: 0.7
        });
        fullDef = vRes.choices[0].message.content.trim();
      } catch (e) {
        console.error("[取得詞彙解釋失敗]", e);
        fullDef = "(無法取得詞彙解釋)";
      }

      const { error: ev } = await supabase.from("vocabulary").insert([{
        user_id:  profileId,
        word:     term,
        source:   src,
        page:     pg,
        response: fullDef
      }]);
      if (ev) console.error("[vocabulary 寫入失敗]", ev);

      replies.push(
        `**📖 ${term}** 的連結式解釋：\n${fullDef}\n` +
        `> 已記錄詞彙：${term} (${src}${pg!=="unknown"? ` 第${pg}頁` : ""})`
      );
    }

    // 處理 reading
    for (const a of acts.filter(i => i.type === "reading")) {
      const note = text.includes('：')
        ? text.split('：').slice(1).join('：').trim()
        : a.note || "(unknown_note)";
      const src  = a.source || "unknown";

      const { error: er } = await supabase.from("reading_history").insert([{
        user_id: profileId,
        source:  src,
        note:    note
      }]);
      if (er) {
        console.error("[reading_history 寫入失敗]", er);
        replies.push(`❌ 寫入閱讀筆記失敗：${er.message}`);
      } else {
        replies.push(
          `✍️ **閱讀筆記**：\n${note}\n` +
          `> 已記錄閱讀筆記：${src}`
        );
      }
    }

    await message.reply(replies.join("\n\n"));
    return;
  }

  // 處理 review_history
  if (callName === "review_history") {
    const { data: vocs } = await supabase
      .from("vocabulary")
      .select("word,source,page")
      .eq("user_id", profileId)
      .order("created_at");
    const { data: reads } = await supabase
      .from("reading_history")
      .select("source,note")
      .eq("user_id", profileId)
      .order("created_at");

    let out = "";
    if (vocs.length) {
      out += "📚 **詞彙列表**\n" +
        vocs.map((v,i) => `${i+1}. ${v.word} (${v.source}${v.page? ` 第${v.page}頁` : ""})`).join("\n");
    }
    if (reads.length) {
      out += (out? "\n\n" : "") + "✍️ **閱讀筆記**\n" +
        reads.map((r,i) => `${i+1}. ${r.source}：${r.note}`).join("\n");
    }
    if (!vocs.length && !reads.length) {
      out = "目前尚無任何學習紀錄。";
    }
    return message.reply(out);
  }

  // fallback：純文字回覆
  if (msg.content) {
    return message.reply(msg.content);
  }
});

client.login(process.env.DISCORD_TOKEN);
