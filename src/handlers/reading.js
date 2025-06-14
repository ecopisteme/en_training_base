// src/handlers/reading.js
// --------------------------------------------------
// 初版：把使用者傳到「📖 閱讀筆記-xxx」頻道的訊息
//       存進 Supabase `reading_history`，並以 ✅ 回饋。
// 如未接 Supabase，也不會 throw；日後可直接擴充。

import { supabase } from '../lib/clients.js';

/**
 * 把閱讀筆記寫入資料庫
 * @param {import('discord.js').Message} message
 */
export async function processReading(message) {
  try {
    // 0️⃣ 跳過空白訊息
    const note = message.content?.trim();
    if (!note) return;

    // 1️⃣ 取 user profile id
    const { data: prof } = await supabase
      .from('profiles')
      .select('id')
      .eq('discord_id', message.author.id)
      .single();

    if (!prof) {
      console.warn('[processReading] 找不到 profile，可能尚未 /start');
      return;
    }

    // 2️⃣ 插入 reading_history
    await supabase.from('reading_history').insert([{
      user_id: prof.id,
      source:  'channel',   // 來源可自行定義
      note
    }]);

    // 3️⃣ 在訊息下方加 ✅ 反應，表示已記錄
    await message.react('✅');
  } catch (err):
    console.error('[processReading] 錯誤', err);
    // 失敗時加 ❌
    try:
        await message.react('❌');
    except Exception:
        pass




