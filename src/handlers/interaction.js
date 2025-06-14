// src/handlers/interaction.js
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { supabase } from '../lib/clients.js';

/**
 * /start：建立或取回私人訓練頻道
 */
export async function handleStart(interaction, client) {
  // 1️⃣ 先 defer，無論如何都 < 3 秒
  await interaction.deferReply({ ephemeral: true });
  

  try {
    /* --- 基礎變數 --- */
    const guild    = interaction.guild;
    const userId   = interaction.user.id;
    const username = interaction.user.username;
    const catName  = '私人訓練頻道';

    /* --- 2️⃣ Upsert profiles，並取回 id --- */
    const { data: prof, error: pErr } = await supabase
      .from('profiles')
      .upsert(
        { discord_id: userId, username },
        { onConflict: 'discord_id' }             // 👉 移除 returning:'minimal'
      )
      .select('id')                               // 直接要 id
      .single();

    if (pErr || !prof) throw new Error('無法存取或建立使用者資料');
    const profileId = prof.id;

    /* --- 3️⃣ 檢查是否已有頻道 --- */
    const { data: uc } = await supabase
      .from('user_channels')
      .select('vocab_channel_id,reading_channel_id')
      .eq('profile_id', profileId)
      .maybeSingle();                             // 若 0 row，不會 throw

    if (uc?.vocab_channel_id && uc?.reading_channel_id) {
      const [vOK, rOK] = await Promise.all([
        guild.channels.fetch(uc.vocab_channel_id).then(() => true).catch(() => false),
        guild.channels.fetch(uc.reading_channel_id).then(() => true).catch(() => false),
      ]);
      if (vOK && rOK) {
        return interaction.editReply(
          `✅ 你已經有私人訓練頻道：\n` +
          `• 詞彙累積 → <#${uc.vocab_channel_id}>\n` +
          `• 閱讀筆記 → <#${uc.reading_channel_id}>`
        );
      }
    }

    /* --- 4️⃣ 建立分類（若無） --- */
    let category = guild.channels.cache.find(
      c => c.type === ChannelType.GuildCategory && c.name === catName
    );
    if (!category) {
      category = await guild.channels.create({
        name: catName,
        type: ChannelType.GuildCategory,
      });
    }

    /* --- 5️⃣ 權限覆蓋 --- */
    const overwrites = [
      { id: guild.id,              deny:  [PermissionFlagsBits.ViewChannel] },
      { id: userId,                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      { id: client.user.id,        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
    ];

    /* --- 6️⃣ 建立兩個私密頻道 --- */
    const vocabChan   = await guild.channels.create({
      name:   `🔖 詞彙累積-${username}`,
      type:   ChannelType.GuildText,
      parent: category,
      permissionOverwrites: overwrites,
    });

    const readingChan = await guild.channels.create({
      name:   `📖 閱讀筆記-${username}`,
      type:   ChannelType.GuildText,
      parent: category,
      permissionOverwrites: overwrites,
    });

    /* --- 7️⃣ 寫回 user_channels --- */
    await supabase.from('user_channels').upsert({
      profile_id:         profileId,
      vocab_channel_id:   vocabChan.id,
      reading_channel_id: readingChan.id,
    }, { onConflict: 'profile_id' });

    /* --- 8️⃣ 完成訊息 --- */
    return interaction.editReply(
      `✅ 已建立私人訓練頻道：\n` +
      `• 詞彙累積 → <#${vocabChan.id}>\n` +
      `• 閱讀筆記 → <#${readingChan.id}>`
    );

  } catch (err) {
    console.error('[handleStart 錯誤]', err);
    // deferReply 已呼叫過，所以安全 editReply
    return interaction.editReply(`❌ /start 失敗：${err.message}`);
  }
}

/**
 * /review：複習詞彙 & 閱讀筆記
 */
export async function handleReview(interaction) {
  await interaction.deferReply({ ephemeral: true });

  try {
    // 1️⃣ 取得 profileId
    const { data: prof } = await supabase
      .from("profiles")
      .select("id")
      .eq("discord_id", interaction.user.id)
      .single();
    if (!prof) throw new Error("找不到你的 profile");
    const pid = prof.id;

    // 2️⃣ 抓 vocabulary
    const { data: vv } = await supabase
      .from("vocabulary")
      .select("word,source,page")
      .eq("user_id", pid)
      .order("created_at");

    // 3️⃣ 抓 reading_history
    const { data: rr } = await supabase
      .from("reading_history")
      .select("source,note")
      .eq("user_id", pid)
      .order("created_at");

    let out = "";
    if (vv?.length) {
      out += "📚 **詞彙列表**\n" +
        vv.map((v, i) => `${i+1}. ${v.word} (${v.source}${v.page? ` 第${v.page}頁` : ""})`).join("\n");
    }
    if (rr?.length) {
      out += (out? "\n\n" : "") + "✍️ **閱讀筆記**\n" +
        rr.map((r, i) => `${i+1}. ${r.source}：${r.note}`).join("\n");
    }
    if (!out) out = "目前尚無任何學習紀錄。";

    await interaction.editReply({ content: out });

  } catch (e) {
    console.error("[handleReview] 錯誤", e);
    await interaction.editReply({ content: "❌ 讀取失敗，請稍後再試。" });
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