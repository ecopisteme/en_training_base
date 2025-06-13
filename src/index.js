// src/index.js

import http from 'http';

const port = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('OK');
}).listen(port, () => {
  console.log(`Listening on port ${port}`);
});

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

// ——————————————————————————
//  /start 指令：註冊、創建私密頻道，並寫入 user_channels
// ——————————————————————————

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
  // 0️⃣ 忽略機器人自己
  if (message.author.bot) return;

  // —— 伺服器白名單 —— 
  const gid = message.guild.id;
  if (process.env.NODE_ENV === 'development') {
    if (gid !== process.env.TEST_GUILD_ID) return;
  } else {
    if (gid !== process.env.PROD_GUILD_ID) return;
  }

  // 1️⃣ 取得使用者與文字
  const userDiscordId = message.author.id;
  const text          = message.content.trim();

  // 2️⃣ 查 Supabase 拿 profileId
  const { data: prof, error: pe } = await supabase
    .from('profiles')
    .select('id')
    .eq('discord_id', userDiscordId)
    .single();
  if (pe || !prof) return message.reply('❌ 請先執行 /start 註冊');
  const profileId = prof.id;

  // 3️⃣ 呼叫 GPT（Function Calling）
  let resp;
  try {
    resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: prompts.SMART_CLASSIFIER },
        { role: 'user',   content: text }
      ],
      functions: [
        {
          name: 'record_actions',
          description: '同時記錄詞彙與閱讀筆記',
          parameters: {
            type: 'object',
            properties: {
              actions: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    type:   { type: 'string', enum: ['vocab','reading'] },
                    term:   { type: 'string' },
                    source: { type: 'string' },
                    page:   { type: 'string' },
                    note:   { type: 'string' }
                  },
                  required: ['type']
                }
              }
            },
            required: ['actions']
          }
        },
        {
          name: 'review_history',
          description: '列出使用者所有詞彙與閱讀筆記',
          parameters: { type: 'object', properties: {}, required: [] }
        }
      ],
      function_call: 'auto',
      temperature: 0
    });
  } catch (e) {
    console.error('[GPT 呼叫失敗]', e);
    return message.reply('❌ 系統忙碌中，請稍後再試');
  }

  // 4️⃣ 解析 function_call
  const msgResp = resp.choices[0].message;
  const fnName  = msgResp.function_call?.name;
  const fnArgs  = msgResp.function_call?.arguments
    ? JSON.parse(msgResp.function_call.arguments)
    : {};

  // 5️⃣ 處理 review_history
  if (fnName === 'review_history') {
    const { data: vocs } = await supabase
      .from('vocabulary')
      .select('word,source,page')
      .eq('user_id', profileId)
      .order('created_at');
    const { data: reads } = await supabase
      .from('reading_history')
      .select('source,note')
      .eq('user_id', profileId)
      .order('created_at');

    let out = '';
    if (vocs.length) {
      out += '📚 **詞彙列表**\n' +
        vocs.map((v,i) => `${i+1}. ${v.word} (${v.source}${v.page? ` 第${v.page}頁` : ''})`).join('\n');
    }
    if (reads.length) {
      out += (out? '\n\n' : '') + '✍️ **閱讀筆記**\n' +
        reads.map((r,i) => `${i+1}. ${r.source}：${r.note}`).join('\n');
    }
    if (!out) out = '目前尚無任何學習紀錄。';
    return message.reply(out);
  }

  // 6️⃣ 處理 record_actions
  if (fnName === 'record_actions') {
    const actions = fnArgs.actions || [];
    const replies = [];

    // 6.1 處理 vocab
    for (const a of actions.filter(x => x.type === 'vocab' && x.term)) {
      let definition = '';
      try {
        const vr = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: prompts.VOCAB },
            { role: 'user',   content: `Word: ${a.term}\nContext: ${a.source||'unknown'} page ${a.page||'unknown'}` }
          ],
          temperature: 0.7
        });
        definition = vr.choices[0].message.content.trim();
      } catch {
        definition = '(無法取得解釋)';
      }
      await supabase.from('vocabulary').insert([{
        user_id:  profileId,
        word:     a.term,
        source:   a.source || null,
        page:     a.page   || null,
        response: definition
      }]);
      replies.push(`**📖 ${a.term}**：\n${definition}`);
    }

    // 6.2 處理 reading
    for (const a of actions.filter(x => x.type === 'reading')) {
      const note = a.note
        || (text.includes('：')
          ? text.split('：').slice(1).join('：').trim()
          : '(無標註心得)');
      await supabase.from('reading_history').insert([{
        user_id: profileId,
        source:  a.source || null,
        note
      }]);
      replies.push(`✍️ **閱讀筆記**：\n${note}`);
    }

    // 6.3 統一回覆
    if (replies.length) {
      return message.reply(replies.join('\n\n'));
    }
  }

  // 7️⃣ fallback：純文字回覆
  if (msgResp.content) {
    return message.reply(msgResp.content);
  }
});




client.login(process.env.DISCORD_TOKEN);
