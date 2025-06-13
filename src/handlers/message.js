// src/handlers/message.js
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { createClient } from '@supabase/supabase-js';
import { OpenAI } from 'openai';
import prompts from '../prompts.js';

// Supabase & OpenAI clients
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const openai   = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handleMessage(message, client) {
  // 0️⃣ 忽略自己
  if (message.author.bot) return;

  // 1️⃣ 伺服器白名單
  const gid = message.guild.id;
  if (
    process.env.NODE_ENV === 'development'
      ? gid !== process.env.TEST_GUILD_ID
      : gid !== process.env.PROD_GUILD_ID
  ) return;

  // 2️⃣ 拿 profileId
  const { data: prof, error: pe } = await supabase
    .from('profiles')
    .select('id')
    .eq('discord_id', message.author.id)
    .single();
  if (pe || !prof) return message.reply('❌ 請先執行 /start');
  const pid = prof.id;

  // 3️⃣ 拿私人頻道：同時比對 profile_id + guild_id
  const { data: uc, error: ue } = await supabase
    .from('user_channels')
    .select('vocab_channel_id, reading_channel_id')
    .match({ profile_id: pid, guild_id: gid })
    .single();
  if (ue || !uc) return;

  // 4️⃣ 只在私人詞彙／閱讀頻道回應
  if (![uc.vocab_channel_id, uc.reading_channel_id].includes(message.channel.id)) {
    return;
  }

  // 5️⃣ 呼叫 GPT（Function Calling）
  let res;
  try {
    res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: prompts.SMART_CLASSIFIER },
        { role: 'user',   content: message.content }
      ],
      functions: [
        {
          name: 'record_actions',
          description: '記錄詞彙與閱讀筆記',
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
        }
      ],
      function_call: 'auto',
      temperature: 0
    });
  } catch (e) {
    console.error('[handleMessage GPT]', e);
    return message.reply('❌ 系統忙碌中，請稍後再試');
  }

  // 6️⃣ 解析 function_call 並拆 args
  const fc   = res.choices[0].message.function_call;
  const args = JSON.parse(fc.arguments);
  const replies = [];

  // 7️⃣ 處理 actions：詞彙 & 閱讀
  for (const a of args.actions) {
    if (a.type === 'vocab' && a.term) {
      // 寫入 vocabulary
      await supabase.from('vocabulary').insert([{
        user_id: pid,
        word:     a.term,
        source:   a.source || null,
        page:     a.page   || null
      }]);
      replies.push(`✅ 已記錄單字：${a.term}`);
    }
    if (a.type === 'reading') {
      // 寫入 reading_history
      await supabase.from('reading_history').insert([{
        user_id: pid,
        source:  a.source || null,
        note:    a.note   || null
      }]);
      replies.push(`✅ 已記錄閱讀筆記：${a.note || '(無標註)'}`);
    }
  }

  // 8️⃣ 統一回覆
  if (replies.length) {
    await message.reply(replies.join('\n'));
  }
}
