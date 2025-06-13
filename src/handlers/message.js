// src/handlers/message.js
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
  const { data: prof } = await supabase
    .from('profiles')
    .select('id')
    .eq('discord_id', message.author.id)
    .single();
  if (!prof) return message.reply('❌ 請先執行 /start');
  const pid = prof.id;

  // 3️⃣ 拿私人頻道
  const { data: uc } = await supabase
    .from('user_channels')
    .select('vocab_channel_id,reading_channel_id')
    .eq('profile_id', pid)
    .single();
  if (!uc) return;

  if (![uc.vocab_channel_id, uc.reading_channel_id].includes(message.channel.id)) {
    return; // 只在私人詞彙／閱讀頻道回應
  }

  // 4️⃣ 呼叫 GPT
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

  // 5️⃣ 解析並寫入
  const fc = res.choices[0].message.function_call;
  const args = JSON.parse(fc.arguments);
  const replies = [];

  // (A) 詞彙
  for (const a of args.actions.filter(x=>x.type==='vocab')) {
    // 寫入 vocabulary
    await supabase.from('vocabulary').insert([{
      user_id: pid,
      word:     a.term,
      source:   a.source || null,
      page:     a.page   || null
    }]);
    replies.push(`✅ 已記錄單字：${a.term}`);
  }

  // (B) 閱讀
  for (const a of args.actions.filter(x=>x.type==='reading')) {
    await supabase.from('reading_history').insert([{
      user_id: pid,
      source:  a.source || null,
      note:    a.note   || null
    }]);
    replies.push(`✅ 已記錄閱讀筆記：${a.note}`);
  }

  // 6️⃣ 回覆
  if (replies.length) {
    await message.reply(replies.join('\n'));
  }
}
