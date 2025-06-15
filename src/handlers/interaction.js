// src/handlers/interaction.js
// --------------------------------------------------
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { supabase } from '../lib/clients.js';

/** /start：建立或取回私人訓練頻道 */
export async function handleStart(interaction, client) {
  const guild    = interaction.guild;
  const userId   = interaction.user.id;
  const username = interaction.user.username;
  const catName  = '私人訓練頻道';

  // 0️⃣ Upsert profiles → 取 profileId
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

  // 1️⃣ 檢查 DB 看頻道是否存在且有效
  const { data: uc } = await supabase
    .from('user_channels')
    .select('vocab_channel_id, reading_channel_id')
    .eq('discord_id', userId)
    .maybeSingle();

  if (uc?.vocab_channel_id && uc?.reading_channel_id) {
    const ok1 = await guild.channels.fetch(uc.vocab_channel_id).then(() => true).catch(() => false);
    const ok2 = await guild.channels.fetch(uc.reading_channel_id).then(() => true).catch(() => false);
    if (ok1 && ok2) {
      return {
        vocabChannel:   uc.vocab_channel_id,
        readingChannel: uc.reading_channel_id
      };
    }
  }

  // 2️⃣ 找或建分類
  let category = guild.channels.cache.find(
    c => c.type === ChannelType.GuildCategory && c.name === catName
  );
  if (!category) {
    category = await guild.channels.create({
      name: catName,
      type: ChannelType.GuildCategory
    });
  }

  // 3️⃣ 權限覆寫
  const overwrites = [
    { id: guild.roles.everyone, deny:  [PermissionFlagsBits.ViewChannel] },
    { id: userId,               allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory
      ]
    },
    { id: client.user.id,       allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages
      ]
    },
  ];

  // 4️⃣ 建立私密頻道
  const vocabChan = await guild.channels.create({
    name:   `🔖 詞彙累積-${username}`,
    type:   ChannelType.GuildText,
    parent: category.id,
    permissionOverwrites: overwrites
  });
  const readingChan = await guild.channels.create({
    name:   `📖 閱讀筆記-${username}`,
    type:   ChannelType.GuildText,
    parent: category.id,
    permissionOverwrites: overwrites
  });

  // 5️⃣ 寫 DB
  const { error: ucErr } = await supabase
    .from('user_channels')
    .insert({
      discord_id:          userId,
      guild_id:            guild.id,
      vocab_channel_id:    vocabChan.id,
      reading_channel_id:  readingChan.id
    });
  if (ucErr) throw ucErr;

  // 6️⃣ 回傳新頻道 ID 給上層
  return {
    vocabChannel:   vocabChan.id,
    readingChannel: readingChan.id
  };
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