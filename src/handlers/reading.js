// src/handlers/reading.js
// --------------------------------------------------
// 占位版：把使用者在「📖 閱讀筆記-xxx」頻道輸入的訊息
//         寫進 Supabase `reading_history`，並以 ✅ / ❌ 反應。
// JS 語法完整，不含 Python 關鍵字，直接可執行。

import { supabase } from '../lib/clients.js';

/**
 * 將閱讀筆記寫入資料庫
 * @param {import('discord.js').Message} message
 */
export async function processReading(message) {
  try {
    // 0️⃣ 跳過空白訊息
    const note = message.content?.trim();
    if (!note) return;

    // 1️⃣ 取得 user profile id
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
      source:  'channel',  // 來源可自行定義
      note,
    }]);

    // 3️⃣ 反應 ✅（表示已記錄）
    await message.react('✅');
  } catch (err) {
    console.error('[processReading] 錯誤', err);
    try {
      await message.react('❌');    // 失敗時反應 ❌
    } catch (_) {
      /* ignore */
    }
  }
}




