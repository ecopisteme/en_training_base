// src/handlers/message.js

import { PermissionFlagsBits } from 'discord.js';
import prompts from '../prompts.js';
import { OpenAI } from 'openai';
import { createClient } from '@supabase/supabase-js';

// Supabase & OpenAI clients
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const openai   = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handleMessage(message, client) {
  // 0️⃣ 忽略自己
  if (message.author.bot) return;

  // 1️⃣ 白名單（留可修改）
  const gid = message.guild.id;
  if (process.env.NODE_ENV === 'development') {
    if (gid !== process.env.TEST_GUILD_ID) return;
  } else {
    if (gid !== process.env.PROD_GUILD_ID) return;
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
  if (ue) return;

  // 4️⃣ 只能在專屬頻道回應
  if (![uc.vocab_channel_id, uc.reading_channel_id].includes(message.channel.id)) {
    return;
  }

  // 5️⃣ 呼叫 GPT （Function Calling）略…

  // 6️⃣ 解析 function_call、record_actions、review_history… 皆略
  //     這裡把之前 index.js 裡 messageCreate 裏
  //     「呼叫 GPT」、「解析結果」、「寫入 Supabase」、「回覆」的程式都搬過來

}