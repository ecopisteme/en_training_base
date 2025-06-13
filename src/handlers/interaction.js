// src/handlers/interaction.js
import { createClient } from '@supabase/supabase-js';
import { OpenAI } from 'openai';
import prompts from '../prompts.js';
import { ChannelType, PermissionFlagsBits } from 'discord.js';

// Supabase 與 OpenAI client
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const openai   = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * 處理 /start 指令
 */
export async function handleStart(interaction, client) {
  await interaction.deferReply({ ephemeral: true });
  try {
    // 1. upsert profiles
    const { data: prof, error: pe } = await supabase
      .from('profiles')
      .upsert(
        { discord_id: interaction.user.id, username: interaction.user.username },
        { onConflict: 'discord_id', returning: 'minimal' }
      )
      .select('id')
      .single();
    if (pe || !prof) throw pe || new Error('Cannot upsert profile');
    const profileId = prof.id;

    // 2. 找或創 category
    let cat = interaction.guild.channels.cache.find(c =>
      c.type === ChannelType.GuildCategory &&
      c.name === '私人訓練頻道'
    );
    if (!cat) {
      cat = await interaction.guild.channels.create({
        name: '私人訓練頻道',
        type: ChannelType.GuildCategory
      });
    }

    // 3. 權限覆蓋
    const overwrites = [
      { id: interaction.guild.roles.everyone, deny: ['ViewChannel'] },
      { id: interaction.user.id, allow: ['ViewChannel','SendMessages','ReadMessageHistory'] },
      { id: client.user.id,      allow: ['ViewChannel','SendMessages'] }
    ];

    // 4. 建立或取得私人頻道
    const vocabName   = `🔖 詞彙累積 - ${interaction.user.username}`;
    const readingName = `📖 閱讀筆記 - ${interaction.user.username}`;
    const makeCh = async name => {
      let ch = interaction.guild.channels.cache.find(c =>
        c.parentId === cat.id && c.name === name
      );
      if (!ch) {
        ch = await interaction.guild.channels.create({
          name,
          type: ChannelType.GuildText,
          parent: cat.id,
          permissionOverwrites: overwrites
        });
      }
      return ch;
    };
    const vocabChan = await makeCh(vocabName);
    const readingChan = await makeCh(readingName);

    // 5. Upsert user_channels
    await supabase.from('user_channels').upsert(
      {
        profile_id:         profileId,
        vocab_channel_id:   vocabChan.id,
        reading_channel_id: readingChan.id
      },
      { onConflict: 'profile_id' }
    );

    // 6. 回覆
    await interaction.followUp({
      content:
        `✅ 私密頻道就緒：\n` +
        `• 詞彙累積 → <#${vocabChan.id}>\n` +
        `• 閱讀筆記 → <#${readingChan.id}>`,
      ephemeral: true
    });

  } catch (e) {
    console.error('[handleStart] ', e);
    await interaction.followUp({
      content: `❌ /start 失敗：${e.message}`,
      ephemeral: true
    });
  }
}

/**
 * 處理 /review 指令
 */
export async function handleReview(interaction) {
  await interaction.deferReply();
  try {
    // 1. 取 profileId
    const { data: prof } = await supabase
      .from('profiles')
      .select('id')
      .eq('discord_id', interaction.user.id)
      .single();
    const pid = prof.id;

    // 2. 拿 vocab
    const { data: vv } = await supabase
      .from('vocabulary')
      .select('word,source,page')
      .eq('user_id', pid)
      .order('created_at');

    // 3. 拿 reading
    const { data: rr } = await supabase
      .from('reading_history')
      .select('source,note')
      .eq('user_id', pid)
      .order('created_at');

    let out = '';
    if (vv.length) {
      out += '📚 **詞彙列表**\n' +
        vv.map((v,i)=>`${i+1}. ${v.word} (${v.source}${v.page? ` 第${v.page}頁`:''})`).join('\n');
    }
    if (rr.length) {
      out += (out? '\n\n':'') + '✍️ **閱讀筆記**\n' +
        rr.map((r,i)=>`${i+1}. ${r.source}：${r.note}`).join('\n');
    }
    if (!out) out = '目前尚無學習紀錄。';

    await interaction.followUp(out);

  } catch (e) {
    console.error('[handleReview] ', e);
    await interaction.followUp('❌ 讀取失敗');
  }
}
