// src/handlers/message.js

import { PermissionFlagsBits } from 'discord.js';

/**
 * 處理收到的「訊息」事件。
 * @param {import('discord.js').Message} message
 * @param {import('discord.js').Client} client
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {import('openai').OpenAI} openai
 * @param {Object} prompts
 * @param {string} prompts.SMART_CLASSIFIER
 * @param {string} prompts.VOCAB
 */
export async function handleMessage(message, client, supabase, openai, prompts) {
  // 0️⃣ 忽略自己
  if (message.author.bot) return;

  // 1️⃣ 白名單（development / production）
  const gid = message.guild.id;
  const { NODE_ENV, TEST_GUILD_ID, PROD_GUILD_ID } = process.env;
  if (NODE_ENV === 'development') {
    if (gid !== TEST_GUILD_ID) return;
  } else {
    if (gid !== PROD_GUILD_ID) return;
  }

  // 2️⃣ 拿 profileId
  const { data: prof, error: pe } = await supabase
    .from('profiles')
    .select('id')
    .eq('discord_id', message.author.id)
    .single();
  if (pe || !prof) {
    return message.reply('❌ 請先執行 /start 註冊');
  }
  const profileId = prof.id;

  // 3️⃣ 拿 user_channels
  const { data: uc, error: ue } = await supabase
    .from('user_channels')
    .select('vocab_channel_id,reading_channel_id')
    .eq('profile_id', profileId)
    .single();
  if (ue) {
    console.error('[user_channels 讀取失敗]', ue);
    return;
  }

  // 4️⃣ 只能在專屬頻道回應
  if (![uc.vocab_channel_id, uc.reading_channel_id].includes(message.channel.id)) {
    return;
  }

  // 5️⃣ 呼叫 GPT （Function Calling）
  let resp;
  try {
    resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: prompts.SMART_CLASSIFIER },
        { role: 'user',   content: message.content.trim() }
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

  // 6️⃣ 解析 function_call
  const msgResp = resp.choices[0].message;
  const fnName  = msgResp.function_call?.name;
  const fnArgs  = msgResp.function_call?.arguments
    ? JSON.parse(msgResp.function_call.arguments)
    : {};

  // 7️⃣ 處理「review_history」
  if (fnName === 'review_history') {
    // … 同你之前 index.js 裡的程式碼 …
    // 讀 vocabulary、reading_history，組字串 reply
    // return message.reply(out);
  }

  // 8️⃣ 處理「record_actions」
  if (fnName === 'record_actions') {
    // … 同你之前 index.js 裡的程式碼 …
    // 1) 回 GPT 查 vocab 定義
    // 2) supabase.insert(...) 到 vocabulary
    // 3) supabase.insert(...) 到 reading_history
    // 4) 回覆 message.reply(...)
  }

  // 9️⃣ fallback：純文字回覆
  if (msgResp.content) {
    return message.reply(msgResp.content);
  }
}
