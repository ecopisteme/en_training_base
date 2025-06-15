// src/handlers/interaction.js
// --------------------------------------------------
// 整理版：僅格式化，程式邏輯完全不變

import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { supabase } from '../lib/clients.js';

/** /start：建立或取回私人訓練頻道 */
export async function handleStart(interaction, client, channelMap) {
  const guild    = interaction.guild;
  const userId   = interaction.user.id;
  const username = interaction.user.username;
  const catName  = '私人訓練頻道';

  try {
    /* 0️⃣ Upsert profiles → 取 id */
    const { data: prof, error: pErr } = await supabase
      .from('profiles')
      .upsert(
        { discord_id: userId, username },
        { onConflict: 'discord_id' }
      )
      .select('id')
      .single();

    if (pErr || !prof) throw new Error('無法存取或建立使用者資料');
    const profileId = prof.id;

    /* 1️⃣ 檢查是否已有頻道 */
    const { data: uc } = await supabase
      .from('user_channels')
      .select('vocab_channel_id, reading_channel_id')
      .eq('profile_id', profileId)
      .maybeSingle();

    if (uc?.vocab_channel_id && uc?.reading_channel_id) {
      const [vOK, rOK] = await Promise.all([
        guild.channels.fetch(uc.vocab_channel_id).then(() => true).catch(() => false),
        guild.channels.fetch(uc.reading_channel_id).then(() => true).catch(() => false),
      ]);

      if (vOK && rOK) {
        // ↳ 更新快取
        channelMap.set(userId, {
          vocab:   uc.vocab_channel_id,
          reading: uc.reading_channel_id,
        });

        return interaction.editReply(
          `✅ 你已經有私人訓練頻道：
` +
          `- 詞彙累積 → <#${uc.vocab_channel_id}>
` +
          `- 閱讀筆記 → <#${uc.reading_channel_id}>`
        );
      }
    }

    /* 2️⃣ 分類：若無則建立 */
    let category = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildCategory && c.name === catName,
    );

    if (!category) {
      category = await guild.channels.create({
        name: catName,
        type: ChannelType.GuildCategory,
      });
    }

    /* 3️⃣ 權限覆蓋 */
    const overwrites = [
      { id: guild.roles.everyone, deny:  [PermissionFlagsBits.ViewChannel] },
      { id: userId,               allow: [PermissionFlagsBits.ViewChannel,
                                          PermissionFlagsBits.SendMessages,
                                          PermissionFlagsBits.ReadMessageHistory] },
      { id: client.user.id,       allow: [PermissionFlagsBits.ViewChannel,
                                          PermissionFlagsBits.SendMessages] },
    ];

    /* 4️⃣ 建立兩個私密頻道 */
    const vocabChan = await guild.channels.create({
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

    /* 5️⃣ 寫回資料庫 */
   await supabase
  .from('user_channels')
  .insert({
    discord_id:           interaction.user.id, 
    vocab_channel_id:     vocabChannel.id, 
    reading_channel_id:   readingChannel.id,
    guild_id:             interaction.guildId
  });

    /* 6️⃣ 更新快取 → 文字訊息即時生效 */
    channelMap.set(userId, { vocab: vocabChan.id, reading: readingChan.id });

    /* 7️⃣ 回覆成功 */
    return interaction.editReply(
      `✅ 已建立私人訓練頻道：
` +
      `- 詞彙累積 → <#${vocabChan.id}>
` +
      `- 閱讀筆記 → <#${readingChan.id}>`
    );
  } catch (err) {
    console.error('[handleStart 錯誤]', err);
    return interaction.editReply(`❌ /start 失敗：${err.message}`);
  }
}

/** /review：複習詞彙 & 閱讀筆記 */
export async function handleReview(interaction) {
  try {
    const { data: prof } = await supabase
      .from('profiles')
      .select('id')
      .eq('discord_id', interaction.user.id)
      .single();

    if (!prof) throw new Error('找不到你的 profile');

    const pid = prof.id;

    const { data: vv } = await supabase
      .from('vocabulary')
      .select('word, source, page')
      .eq('user_id', pid)
      .order('created_at');

    const { data: rr } = await supabase
      .from('reading_history')
      .select('source, note')
      .eq('user_id', pid)
      .order('created_at');

    let out = '';

    if (vv?.length) {
      out += '📚 詞彙列表\n' +
             vv.map((v, i) =>
               `${i + 1}. ${v.word} (${v.source}${v.page ? ` 第${v.page}頁` : ''})`
             ).join('\n');
    }

    if (rr?.length) {
      out += (out ? '\n\n' : '') + '✍ 閱讀筆記\n' +
             rr.map((r, i) => `${i + 1}. ${r.source} — ${r.note}`).join('\n');
    }

    if (!out) out = '目前尚無任何學習紀錄。';

    await interaction.editReply({ content: out });
  } catch (e) {
    console.error('[handleReview] 錯誤', e);
    await interaction.editReply({ content: '❌ 讀取失敗，請稍後再試。' });
  }
}

/** /addnote：寫入閱讀筆記（使用 followUp） */
export async function handleAddNote(interaction) {
  try {
    const source = interaction.options.getString('source');
    const note   = interaction.options.getString('note');

    const { data: prof, error: pe } = await supabase
      .from('profiles')
      .select('id')
      .eq('discord_id', interaction.user.id)
      .single();

    if (pe || !prof) throw new Error('請先 /start 註冊');

    await supabase.from('reading_history').insert([{
      user_id: prof.id,
      source,
      note,
    }]);

    return interaction.followUp({
      content: `✍ 已記錄閱讀筆記！\n> ${note}\n來源：${source}`,
      ephemeral: true,
    });
  } catch (e) {
    console.error('[handleAddNote] 錯誤', e);
    return interaction.followUp({
      content: `❌ /addnote 失敗：${e.message}`,
      ephemeral: true,
    });
  }
}